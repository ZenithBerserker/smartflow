// pages/api/fibonacci.js
// Real Fibonacci levels computed from actual BTC swing highs/lows
// Uses Binance weekly + daily candles — free, no key needed

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // Fetch weekly candles (last 52 weeks = 1 year)
    const weeklyRes = await fetch(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=52",
      { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    const weeklyRaw = await weeklyRes.json();
    const weekly = weeklyRaw.map(c => ({
      open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), time: c[0],
    }));

    // Fetch daily candles (last 90 days)
    const dailyRes = await fetch(
      "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90",
      { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    const dailyRaw = await dailyRes.json();
    const daily = dailyRaw.map(c => ({
      open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), time: c[0],
    }));

    const currentPrice = daily[daily.length - 1].close;

    // Find HTF swing high and low from weekly data
    const weeklyHighs = weekly.map(c => c.high);
    const weeklyLows = weekly.map(c => c.low);
    const htfHigh = Math.max(...weeklyHighs);
    const htfLow = Math.min(...weeklyLows);
    const htfHighIdx = weeklyHighs.indexOf(htfHigh);
    const htfLowIdx = weeklyLows.indexOf(htfLow);

    // Determine trend direction
    const isBullTrend = htfLowIdx < htfHighIdx; // low came before high = uptrend
    const htfRange = htfHigh - htfLow;

    // Compute HTF Fibonacci levels (retracement from high in uptrend)
    const htfLevels = {};
    const fibRatios = [0.236, 0.382, 0.500, 0.618, 0.705, 0.786];
    for (const ratio of fibRatios) {
      htfLevels[ratio.toFixed(3)] = isBullTrend
        ? htfHigh - ratio * htfRange
        : htfLow + ratio * htfRange;
    }

    // Find LTF swing from daily (last 90 days)
    const dailyHighs = daily.map(c => c.high);
    const dailyLows = daily.map(c => c.low);
    const ltfHigh = Math.max(...dailyHighs);
    const ltfLow = Math.min(...dailyLows);
    const ltfHighIdx = dailyHighs.indexOf(ltfHigh);
    const ltfLowIdx = dailyLows.indexOf(ltfLow);
    const isLtfBull = ltfLowIdx < ltfHighIdx;
    const ltfRange = ltfHigh - ltfLow;

    const ltfLevels = {};
    for (const ratio of fibRatios) {
      ltfLevels[ratio.toFixed(3)] = isLtfBull
        ? ltfHigh - ratio * ltfRange
        : ltfLow + ratio * ltfRange;
    }

    // Find confluence zones — HTF and LTF within 3% of each other
    const confluenceZones = [];
    for (const [htfKey, htfVal] of Object.entries(htfLevels)) {
      for (const [ltfKey, ltfVal] of Object.entries(ltfLevels)) {
        if (htfKey === ltfKey) {
          const pctDiff = Math.abs(htfVal - ltfVal) / htfVal * 100;
          if (pctDiff < 4) {
            const avgPrice = (htfVal + ltfVal) / 2;
            const isOTE = ["0.618","0.705","0.786"].includes(htfKey);
            confluenceZones.push({
              level: htfKey,
              price: Math.round(avgPrice),
              htfPrice: Math.round(htfVal),
              ltfPrice: Math.round(ltfVal),
              isOTE,
              pctFromCurrent: Math.round((avgPrice - currentPrice) / currentPrice * 1000) / 10,
              pctDiff: Math.round(pctDiff * 10) / 10,
            });
          }
        }
      }
    }

    // Sort by proximity to current price
    confluenceZones.sort((a, b) => Math.abs(a.pctFromCurrent) - Math.abs(b.pctFromCurrent));
    const nearestZone = confluenceZones[0] || null;

    // Is price currently in OTE zone?
    const oteZones = confluenceZones.filter(z => z.isOTE);
    const inOTE = oteZones.some(z => Math.abs(z.pctFromCurrent) < 3);
    const confluenceScore = confluenceZones.length >= 3 ? 2 : confluenceZones.length >= 1 ? 1 : 0;

    let entryQuality;
    if (inOTE) entryQuality = "OPTIMAL";
    else if (nearestZone && Math.abs(nearestZone.pctFromCurrent) < 8) entryQuality = "APPROACHING";
    else entryQuality = "OUT OF ZONE";

    // Format levels for response
    const formatLevels = (levels) => Object.fromEntries(
      Object.entries(levels).map(([k, v]) => [k, Math.round(v)])
    );

    return res.status(200).json({
      currentPrice: Math.round(currentPrice),
      htfHigh: Math.round(htfHigh),
      htfLow: Math.round(htfLow),
      ltfHigh: Math.round(ltfHigh),
      ltfLow: Math.round(ltfLow),
      htfLevels: formatLevels(htfLevels),
      ltfLevels: formatLevels(ltfLevels),
      confluenceZones,
      nearestZone,
      inOTE,
      confluenceScore,
      entryQuality,
      isBullTrend,
      isLtfBull,
      source: "binance_public",
      timestamp: Date.now(),
    });

  } catch (e) {
    console.error("[fibonacci] error:", e.message);
    // Return mock fallback
    const p = 96400;
    return res.status(200).json({
      currentPrice: p,
      htfHigh: 108353, htfLow: 15479,
      ltfHigh: 109356, ltfLow: 74508,
      htfLevels: { "0.236": 99624, "0.382": 94920, "0.500": 61916, "0.618": 54879, "0.705": 49712, "0.786": 46095 },
      ltfLevels: { "0.236": 101134, "0.382": 95699, "0.500": 91932, "0.618": 88165, "0.705": 85736, "0.786": 83729 },
      confluenceZones: [{ level: "0.618", price: 88165, isOTE: true, pctFromCurrent: -8.6 }],
      nearestZone: { level: "0.618", price: 88165, isOTE: true, pctFromCurrent: -8.6 },
      inOTE: false, confluenceScore: 1, entryQuality: "APPROACHING",
      source: "mock", error: e.message, timestamp: Date.now(),
    });
  }
}
