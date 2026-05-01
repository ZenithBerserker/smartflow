// pages/api/pipeline.js — updated to use real wallet analysis from /api/wallets
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
    source: priceData?.mock ? "mock" : "dexscreener",
    passed: rsi > 40 && rsi < 75 && obvSignal === "rising" && priceChange1h > 0,
  };

  if (!step2.passed) {
    const s4 = buildSignal(ticker, step1, step2, null);
    return res.status(200).json({ ticker, steps: [step1, step2, s4], signal: s4 });
  }

  // ── Step 3: Real wallet analysis via /api/wallets ─────────────────────────
  let walletData;
  try {
    // Call our own wallets endpoint (works on Vercel, uses Birdeye + Gemini)
    const host = req.headers.host;
    const protocol = host?.includes("localhost") ? "http" : "https";
    const walletsRes = await fetch(
      `${protocol}://${host}/api/wallets?ticker=${ticker}`,
      { signal: AbortSignal.timeout(25000) }
    );
    walletData = await walletsRes.json();
  } catch (e) {
    console.error("[pipeline] Wallet fetch failed:", e.message);
    walletData = { wallets: getMockWallets(), smart_count: 4, smart_ratio: 0.67, source: "mock" };
  }

  const step3 = {
    step: 3, name: "wallet_analysis",
    wallets_analyzed: walletData.wallets?.length || 6,
    smart_money_count: walletData.smart_count || 0,
    smart_money_ratio: walletData.smart_ratio || 0,
    smart_money_threshold: 0.5,
    wallet_results: walletData.wallets || [],
    source: walletData.source || "unknown",
    passed: (walletData.smart_ratio || 0) >= 0.5,
  };

  const step4 = buildSignal(ticker, step1, step2, step3);

  return res.status(200).json({
    ticker,
    steps: [step1, step2, step3, step4],
    signal: step4,
    wallet_source: walletData.source,
    timestamp: Date.now(),
  });
}

function buildSignal(ticker, s1, s2, s3) {
  const allPass = s1?.passed && s2?.passed && s3?.passed;

  if (allPass) {
    const confidence = Math.min(97, Math.round(
      (s1.zscore / 4.0) * 40 +
      (s3.smart_money_ratio) * 35 +
      (s2.rsi < 70 ? 15 : 5) +
      (s2.obv_signal === "rising" ? 10 : 0)
    ));
    return {
      step: 4, name: "signal_generation",
      signal: confidence > 65 ? "HIGH_CONVICTION_BUY" : "BUY",
      confidence,
      reason: `Z=${s1.zscore.toFixed(2)} spike confirmed. RSI=${s2.rsi?.toFixed(0)}, OBV ${s2.obv_signal}. ${s3.smart_money_count}/${s3.wallets_analyzed} wallets AI-verified smart money.`,
      passed: true,
    };
  }

  const failed = [];
  if (!s1?.passed) failed.push(`Z-score ${s1?.zscore?.toFixed(2)} < 2.0`);
  if (s1?.passed && !s2?.passed) failed.push(`technical divergence (OBV: ${s2?.obv_signal})`);
  if (s2?.passed && !s3?.passed) failed.push(`smart money ratio ${Math.round((s3?.smart_money_ratio||0)*100)}% < 50%`);

  return {
    step: 4, name: "signal_generation",
    signal: "NO_SIGNAL", confidence: 0,
    reason: "Failed: " + failed.join("; "),
    passed: false,
  };
}

function getMockWallets() {
  return [
    { wallet_address: "0x3aF7...b291", win_rate_percentage: 78, total_realized_pnl_usd: 842000,  total_trades: 234, risk_classification: "Moderate",     is_smart_money: true  },
    { wallet_address: "0x1c9E...d047", win_rate_percentage: 71, total_realized_pnl_usd: 1240000, total_trades: 189, risk_classification: "Aggressive",   is_smart_money: true  },
    { wallet_address: "4xKmP...qR2s", win_rate_percentage: 64, total_realized_pnl_usd: 390000,  total_trades: 412, risk_classification: "Degenerate",   is_smart_money: false },
    { wallet_address: "0x82bD...f3A1", win_rate_percentage: 69, total_realized_pnl_usd: 670000,  total_trades: 301, risk_classification: "Moderate",     is_smart_money: true  },
    { wallet_address: "9wLqT...mN5j", win_rate_percentage: 55, total_realized_pnl_usd: 88000,   total_trades: 567, risk_classification: "Aggressive",   is_smart_money: false },
    { wallet_address: "0xE4c2...7e9F", win_rate_percentage: 82, total_realized_pnl_usd: 2100000, total_trades: 98,  risk_classification: "Conservative", is_smart_money: true  },
  ];
}
