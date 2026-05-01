// pages/api/pipeline.js — updated to use real wallet analysis from /api/wallets

function getMockZscore(ticker) {
  const base = { PEPE:1.8, WIF:2.1, BONK:1.4, TURBO:3.1, FLOKI:1.6, DOGE:0.9, SHIB:1.1, SOL:2.3, ETH:0.7, ARB:1.9, LINK:1.2, INJ:2.6 };
  const z = (base[ticker] || 1.0) + (Math.random() * 0.4 - 0.2);
  return Math.round(z * 100) / 100;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = (req.query.ticker || "PEPE").toUpperCase();

  // ── Step 1: Social momentum ───────────────────────────────────────────────
  const zscore = getMockZscore(ticker);
  const mentions = Math.round(zscore * 45 + Math.random() * 30);
  const step1 = {
    step: 1, name: "social_momentum",
    zscore, mentions_1h: mentions,
    threshold: 2.0,
    passed: zscore > 2.0,
    sources: ["4chan_biz", "reddit", "telegram"],
  };

  if (!step1.passed) {
    const s4 = buildSignal(ticker, step1, null, null);
    return res.status(200).json({ ticker, steps: [step1, s4], signal: s4 });
  }

  // ── Step 2: Technical confluence ─────────────────────────────────────────
  const rsi = 45 + Math.random() * 30;
  const obvRising = Math.random() > 0.3;
  const priceChange1h = (Math.random() * 8 - 1);
  const step2 = {
    step: 2, name: "technical_confluence",
    rsi: Math.round(rsi * 10) / 10,
    obv_signal: obvRising ? "rising" : "flat",
    adx: Math.round(20 + Math.random() * 20),
    price_change_1h: Math.round(priceChange1h * 100) / 100,
    price_change_24h: Math.round((Math.random() * 25 - 3) * 100) / 100,
    volume_24h_usd: Math.round(1e6 + Math.random() * 49e6),
    passed: rsi < 75 && obvRising && priceChange1h > 0,
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
