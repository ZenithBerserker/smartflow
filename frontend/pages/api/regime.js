// pages/api/regime.js
// Real BTC macro regime from Binance public API — no key needed
// Fetches monthly candles, computes RSI(14), consecutive red months

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // Fetch 24 monthly BTC candles from Binance (free, no key)
    const r = await fetch(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=24",
      { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    const candles = await r.json();
    // Format: [openTime, open, high, low, close, volume, ...]
    const monthly = candles.map(c => ({
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      time: c[0],
      isGreen: parseFloat(c[4]) > parseFloat(c[1]),
    }));

    // Count consecutive red months from most recent
    let consecutiveRed = 0;
    for (let i = monthly.length - 2; i >= 0; i--) {
      if (!monthly[i].isGreen) consecutiveRed++;
      else break;
    }

    // Compute RSI(14) on monthly closes
    const closes = monthly.map(c => c.close);
    const rsi = computeRSI(closes, 14);
    const currentRSI = rsi[rsi.length - 1];

    // Monthly structure — last 3 months direction
    const last3 = monthly.slice(-3);
    const bullMonths = last3.filter(c => c.isGreen).length;

    // Regime classification
    let state, label, color, valid, risk, trend;
    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2];
    const priceChange = (currentPrice - prevPrice) / prevPrice * 100;

    if (consecutiveRed >= 5 || currentRSI < 30) {
      state = "CAPITULATION_RECOVERY"; label = "Capitulation Recovery";
      color = "#00cfff"; valid = true; risk = "LOW"; trend = "RECOVERING";
    } else if (consecutiveRed >= 3 || (currentRSI < 40 && bullMonths < 1)) {
      state = "BEAR_EXPANSION"; label = "Bear Expansion";
      color = "#ff4466"; valid = false; risk = "EXTREME"; trend = "STRONG DOWN";
    } else if (currentRSI > 75) {
      state = "DISTRIBUTION"; label = "Distribution";
      color = "#ff4466"; valid = false; risk = "HIGH"; trend = "TOPPING";
    } else if (currentRSI > 55 && bullMonths >= 2) {
      state = "BULLISH_EXPANSION"; label = "Bullish Expansion";
      color = "#00ff88"; valid = true; risk = "MODERATE"; trend = "STRONG UP";
    } else {
      state = "EQUILIBRIUM_ACCUMULATION"; label = "Equilibrium Accumulation";
      color = "#ffaa00"; valid = true; risk = "LOW-MEDIUM"; trend = "SIDEWAYS";
    }

    // Fetch MVRV Z-score approximation from alternative.me fear/greed
    let fearGreed = null;
    try {
      const fgRes = await fetch("https://api.alternative.me/fng/?limit=1", {
        signal: AbortSignal.timeout(5000)
      });
      const fgData = await fgRes.json();
      fearGreed = parseInt(fgData?.data?.[0]?.value || 50);
    } catch {}

    // MVRV approximation (0-4 scale based on RSI and price structure)
    const mvrvApprox = currentRSI > 70 ? 2.8 + (currentRSI - 70) * 0.06
      : currentRSI < 35 ? 0.2 + (currentRSI - 20) * 0.05
      : 0.8 + (currentRSI - 35) * 0.03;

    return res.status(200).json({
      state, label, color, valid, risk, trend,
      rsi: Math.round(currentRSI * 10) / 10,
      mvrv: Math.round(mvrvApprox * 100) / 100,
      consecutive_red: consecutiveRed,
      current_price: currentPrice,
      price_change_monthly: Math.round(priceChange * 100) / 100,
      bull_months_last3: bullMonths,
      fear_greed: fearGreed,
      candles_used: monthly.length,
      source: "binance_public",
      timestamp: Date.now(),
    });

  } catch (e) {
    console.error("[regime] error:", e.message);
    return res.status(200).json({
      state: "EQUILIBRIUM_ACCUMULATION", label: "Equilibrium Accumulation",
      color: "#ffaa00", valid: true, risk: "LOW-MEDIUM", trend: "SIDEWAYS",
      rsi: 48.5, mvrv: 1.2, consecutive_red: 0, source: "mock",
      error: e.message, timestamp: Date.now(),
    });
  }
}

function computeRSI(closes, period = 14) {
  const rsi = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi.push(100 - 100 / (1 + (avgLoss === 0 ? 999 : avgGain / avgLoss)));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi.push(100 - 100 / (1 + (avgLoss === 0 ? 999 : avgGain / avgLoss)));
  }
  return rsi;
}
