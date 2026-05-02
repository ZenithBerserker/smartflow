// pages/api/smartmoney.js
// Real smart money data from Coinglass (free, no key needed for basic endpoints)
// Falls back to Binance long/short ratio if Coinglass fails

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    let longRatio = null, shortRatio = null, source = "unknown";

    // Try Coinglass top trader long/short ratio (free endpoint)
    try {
      const cgRes = await fetch(
        "https://open-api.coinglass.com/public/v2/indicator/top_long_short_position_ratio?symbol=BTC&interval=1d&limit=1",
        { headers: { "User-Agent": "BlackCat/1.0", "Accept": "application/json" }, signal: AbortSignal.timeout(6000) }
      );
      if (cgRes.ok) {
        const cgData = await cgRes.json();
        const latest = cgData?.data?.[0];
        if (latest) {
          longRatio = parseFloat(latest.longRatio || latest.longAccount) * 100;
          shortRatio = 100 - longRatio;
          source = "coinglass_top_traders";
        }
      }
    } catch {}

    // Try Binance futures long/short ratio as fallback (free, no key)
    if (!longRatio) {
      try {
        const bnRes = await fetch(
          "https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1d&limit=1",
          { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(6000) }
        );
        if (bnRes.ok) {
          const bnData = await bnRes.json();
          const latest = bnData?.[0];
          if (latest) {
            longRatio = parseFloat(latest.longAccount) * 100;
            shortRatio = parseFloat(latest.shortAccount) * 100;
            source = "binance_top_traders";
          }
        }
      } catch {}
    }

    // Try global long/short ratio from Binance (retail proxy)
    let globalLong = null, globalShort = null;
    try {
      const glRes = await fetch(
        "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1",
        { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(6000) }
      );
      if (glRes.ok) {
        const glData = await glRes.json();
        const latest = glData?.[0];
        if (latest) {
          globalLong = parseFloat(latest.longAccount) * 100;
          globalShort = parseFloat(latest.shortAccount) * 100;
        }
      }
    } catch {}

    // Fetch fear & greed for sentiment
    let fearGreed = 50, fearGreedLabel = "Neutral";
    try {
      const fgRes = await fetch("https://api.alternative.me/fng/?limit=1", { signal: AbortSignal.timeout(5000) });
      const fgData = await fgRes.json();
      fearGreed = parseInt(fgData?.data?.[0]?.value || 50);
      fearGreedLabel = fgData?.data?.[0]?.value_classification || "Neutral";
    } catch {}

    // If all failed, use neutral defaults
    if (!longRatio) {
      longRatio = 52; shortRatio = 48; source = "mock_neutral";
    }

    // Compute Battle Score from top trader vs retail divergence
    // Top traders long% minus 50 = directional lean
    // If top traders are more long than retail = stronger signal
    const topTraderBias = longRatio - 50; // positive = long bias
    const retailBias = globalLong ? (globalLong - 50) : 0;
    const divergence = topTraderBias - retailBias; // positive = smart money MORE bullish than retail

    // Battle score: weighted combination
    const battleScore = Math.round(
      topTraderBias * 1.5 +          // top trader direction
      divergence * 0.5 +              // divergence from retail
      (fearGreed - 50) * 0.3          // fear/greed contribution
    );
    const clampedScore = Math.max(-100, Math.min(100, battleScore));

    // Conviction based on how extreme the reading is
    const conviction = Math.min(95, Math.round(Math.abs(clampedScore) * 0.6 + 40 + Math.random() * 5));

    let status, statusColor;
    if (clampedScore > 50)       { status = "STRONG LONG";  statusColor = "#00ff88"; }
    else if (clampedScore > 20)  { status = "LONG";         statusColor = "#00cfff"; }
    else if (clampedScore > -20) { status = "NEUTRAL";      statusColor = "#ffaa00"; }
    else if (clampedScore > -50) { status = "SHORT";        statusColor = "#ff8844"; }
    else                         { status = "STRONG SHORT"; statusColor = "#ff4466"; }

    return res.status(200).json({
      longBias: Math.round(longRatio),
      shortBias: Math.round(shortRatio),
      globalLong: globalLong ? Math.round(globalLong) : null,
      globalShort: globalShort ? Math.round(globalShort) : null,
      battleScore: clampedScore,
      conviction,
      status, statusColor,
      fearGreed, fearGreedLabel,
      source,
      timestamp: Date.now(),
    });

  } catch (e) {
    console.error("[smartmoney] error:", e.message);
    return res.status(200).json({
      longBias: 52, shortBias: 48, battleScore: 18, conviction: 55,
      status: "NEUTRAL", statusColor: "#ffaa00",
      fearGreed: 50, fearGreedLabel: "Neutral",
      source: "mock", error: e.message, timestamp: Date.now(),
    });
  }
}
