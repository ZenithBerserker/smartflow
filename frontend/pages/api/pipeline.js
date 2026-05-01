import { getZscoreForTicker } from "../../lib/server/zscores";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = (req.query.ticker || "PEPE").toUpperCase();

  // ── Step 1: Social momentum ───────────────────────────────────────────────
  const social = await getZscoreForTicker(ticker);
  const zscore = social.zscore;
  const mentions = social.mentions_1h;
  const step1 = {
    step: 1, name: "social_momentum",
    zscore, mentions_1h: mentions,
    threshold: 2.0,
    passed: zscore > 2.0,
    sources: ["4chan_biz", "reddit", "telegram"],
    source: social.source,
    reason: social.reason,
  };

  if (!step1.passed) {
    const s4 = buildSignal(ticker, step1, null, null);
    return res.status(200).json({ ticker, steps: [step1, s4], signal: s4 });
  }

  // ── Step 2: Technical confluence ─────────────────────────────────────────
  let priceData = null;
  try {
    const host = req.headers.host;
    const protocol = host?.includes("localhost") ? "http" : "https";
    const priceRes = await fetch(
      `${protocol}://${host}/api/price?ticker=${ticker}&tf=24h`,
      { signal: AbortSignal.timeout(12000) }
    );
    priceData = await priceRes.json();
  } catch (e) {
    console.error("[pipeline] Price fetch failed:", e.message);
  }

  const rsi = priceData?.technicals?.rsi ?? 50;
  const obvSignal = priceData?.technicals?.obv_signal || "flat";
  const priceChange1h = priceData?.price_change?.h1 ?? 0;
  const priceChange24h = priceData?.price_change?.h24 ?? 0;
  const step2 = {
    step: 2, name: "technical_confluence",
    rsi: Math.round(rsi * 10) / 10,
    obv_signal: obvSignal,
    obv_change_pct: priceData?.technicals?.obv?.change_pct ?? 0,
    buy_ratio: priceData?.technicals?.buy_ratio ?? 0.5,
    adx: null,
    price_change_1h: Math.round(priceChange1h * 100) / 100,
    price_change_24h: Math.round(priceChange24h * 100) / 100,
    volume_24h_usd: Math.round(priceData?.volume_24h || 0),
    price_usd: priceData?.price_usd || 0,
    source: priceData?.dex || priceData?.candle_source || "unavailable",
    passed: rsi > 40 && rsi < 75 && obvSignal === "rising" && priceChange1h > 0,
  };

  if (!step2.passed) {
    const s4 = buildSignal(ticker, step1, step2, null);
    return res.status(200).json({ ticker, steps: [step1, step2, s4], signal: s4 });
  }

  // ── Step 3: Long/short sentiment ─────────────────────────────────────────
  let longShortData;
  try {
    const host = req.headers.host;
    const protocol = host?.includes("localhost") ? "http" : "https";
    const longShortRes = await fetch(
      `${protocol}://${host}/api/longshort?ticker=${ticker}`,
      { signal: AbortSignal.timeout(12000) }
    );
    longShortData = await longShortRes.json();
  } catch (e) {
    console.error("[pipeline] Long/short fetch failed:", e.message);
    longShortData = { available: false, source: "unavailable", reason: e.message };
  }

  const step3 = {
    step: 3, name: "long_short_sentiment",
    signal: longShortData.signal || "UNAVAILABLE",
    bias_score: longShortData.bias_score || 0,
    account_long_pct: longShortData.account_long_pct,
    account_short_pct: longShortData.account_short_pct,
    top_position_long_pct: longShortData.top_position_long_pct,
    funding_rate_pct: longShortData.funding_rate_pct,
    funding_bias_pct: longShortData.funding_bias_pct,
    next_funding_time: longShortData.next_funding_time,
    account_trend_pct: longShortData.account_trend_pct || 0,
    source: longShortData.source || "unknown",
    reason: longShortData.reason,
    passed: longShortData.available && longShortData.signal === "BULLISH" && (longShortData.bias_score || 0) >= 55,
  };

  const step4 = buildSignal(ticker, step1, step2, step3);

  return res.status(200).json({
    ticker,
    steps: [step1, step2, step3, step4],
    signal: step4,
    long_short: longShortData,
    timestamp: Date.now(),
  });
}

function buildSignal(ticker, s1, s2, s3) {
  const allPass = s1?.passed && s2?.passed && s3?.passed;

  if (allPass) {
    const confidence = Math.min(97, Math.round(
      (s1.zscore / 4.0) * 40 +
      Math.min(25, ((s3.bias_score || 50) - 50) * 2.5) +
      (s2.rsi < 70 ? 15 : 5) +
      (s2.obv_signal === "rising" ? 10 : 0)
    ));
    return {
      step: 4, name: "signal_generation",
      signal: confidence > 65 ? "HIGH_CONVICTION_BUY" : "BUY",
      confidence,
      reason: `Z=${s1.zscore.toFixed(2)} spike confirmed. RSI=${s2.rsi?.toFixed(0)}, OBV ${s2.obv_signal}. Long/short bias is ${s3.signal} at ${s3.bias_score}%.`,
      passed: true,
    };
  }

  const failed = [];
  if (!s1?.passed) failed.push(`Z-score ${s1?.zscore?.toFixed(2)} < 2.0`);
  if (s1?.passed && !s2?.passed) failed.push(`technical divergence (OBV: ${s2?.obv_signal})`);
  if (s2?.passed && !s3?.passed) failed.push(`long/short bias ${s3?.signal || "unavailable"} at ${s3?.bias_score || 0}%`);

  return {
    step: 4, name: "signal_generation",
    signal: "NO_SIGNAL", confidence: 0,
    reason: "Failed: " + failed.join("; "),
    passed: false,
  };
}
