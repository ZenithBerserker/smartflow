// pages/api/pipeline.js
// Vercel serverless function — runs the SmartFlow pipeline for a given ticker.
// Deployed free on Vercel. No server needed.

import { exec } from "child_process";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

// Mock data for Vercel deployment (Python scrapers run separately)
// When you run the Python scrapers locally, they write to data/mentions.db
// The Next.js frontend reads from this API which can use mock or real data

function getMockPipelineResult(ticker, forceSignal = false) {
  const mockZscores = {
    PEPE: 1.8, WIF: 2.1, BONK: 1.4, TURBO: 3.1,
    FLOKI: 1.6, DOGE: 0.9, SHIB: 1.1, SOL: 2.3,
    ETH: 0.7, BTC: 0.6, ARB: 1.9,
  };

  const zscore = (mockZscores[ticker.toUpperCase()] || 1.0) + (Math.random() * 0.4 - 0.2);
  const rsi = 45 + Math.random() * 30;
  const obvRising = Math.random() > 0.35;
  const step1Pass = zscore > 2.0;
  const step2Pass = step1Pass && rsi < 75 && obvRising;
  const smartCount = step2Pass ? Math.floor(Math.random() * 3) + 2 : 1;
  const smartRatio = smartCount / 6;
  const step3Pass = step2Pass && smartRatio >= 0.5;

  const wallets = [
    { wallet_address: `0x${ticker.slice(0,3)}7b291`, win_rate_percentage: 78, total_realized_pnl_usd: 842000, total_trades: 234, risk_classification: "Moderate", is_smart_money: smartCount >= 1 },
    { wallet_address: `0x${ticker.slice(0,3)}d047`, win_rate_percentage: 71, total_realized_pnl_usd: 1240000, total_trades: 189, risk_classification: "Aggressive", is_smart_money: smartCount >= 2 },
    { wallet_address: `4x${ticker.slice(0,3)}qR2s`, win_rate_percentage: 64, total_realized_pnl_usd: 390000, total_trades: 412, risk_classification: "Degenerate", is_smart_money: false },
    { wallet_address: `0x${ticker.slice(0,3)}f3A1`, win_rate_percentage: 69, total_realized_pnl_usd: 670000, total_trades: 301, risk_classification: "Moderate", is_smart_money: smartCount >= 3 },
    { wallet_address: `9w${ticker.slice(0,3)}mN5j`, win_rate_percentage: 55, total_realized_pnl_usd: 88000, total_trades: 567, risk_classification: "Aggressive", is_smart_money: false },
    { wallet_address: `0x${ticker.slice(0,3)}7e9F`, win_rate_percentage: 82, total_realized_pnl_usd: 2100000, total_trades: 98, risk_classification: "Conservative", is_smart_money: smartCount >= 4 },
  ];

  const confidence = step3Pass
    ? Math.min(97, Math.round((zscore / 4.0) * 40 + smartRatio * 35 + (obvRising ? 10 : 0) + 10))
    : 0;

  return {
    ticker: ticker.toUpperCase(),
    timestamp: Date.now(),
    steps: [
      {
        step: 1, name: "social_momentum",
        zscore: Math.round(zscore * 100) / 100,
        mentions_1h: Math.round(zscore * 45 + 40),
        threshold: 2.0,
        passed: step1Pass,
        sources: ["4chan_biz", "reddit", "telegram"],
      },
      {
        step: 2, name: "technical_confluence",
        rsi: Math.round(rsi * 10) / 10,
        obv_signal: obvRising ? "rising" : "flat",
        adx: Math.round(20 + Math.random() * 20),
        price_change_1h: Math.round((Math.random() * 8 - 1) * 100) / 100,
        price_change_24h: Math.round((Math.random() * 25 - 3) * 100) / 100,
        volume_24h_usd: Math.round(1e6 + Math.random() * 49e6),
        passed: step2Pass,
      },
      {
        step: 3, name: "wallet_analysis",
        wallets_analyzed: 6,
        smart_money_count: smartCount,
        smart_money_ratio: Math.round(smartRatio * 1000) / 1000,
        smart_money_threshold: 0.5,
        wallet_results: wallets,
        passed: step3Pass,
      },
      {
        step: 4, name: "signal_generation",
        signal: step3Pass ? (confidence > 65 ? "HIGH_CONVICTION_BUY" : "BUY") : "NO_SIGNAL",
        confidence,
        reason: step3Pass
          ? `Z=${zscore.toFixed(2)} confirmed. RSI=${rsi.toFixed(0)}, OBV ${obvRising ? "rising" : "flat"}. ${smartCount}/6 wallets AI-verified.`
          : `Pipeline halted: ${!step1Pass ? "Z-score below threshold" : !step2Pass ? "Technical divergence detected" : "Insufficient smart money ratio"}`,
        passed: step3Pass,
      },
    ],
    signal: {
      signal: step3Pass ? (confidence > 65 ? "HIGH_CONVICTION_BUY" : "BUY") : "NO_SIGNAL",
      confidence,
      ticker: ticker.toUpperCase(),
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ticker = (req.query.ticker || req.body?.ticker || "PEPE").toUpperCase();
  const useMock = req.query.mock !== "false"; // default to mock unless explicitly disabled

  // CORS headers for development
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");

  try {
    if (useMock) {
      // Return mock data instantly (no Python needed)
      const result = getMockPipelineResult(ticker);
      return res.status(200).json(result);
    }

    // Production: call Python pipeline
    // This works on Railway/Render where you can run Python
    // On Vercel, use mock mode or a separate Python microservice
    const scriptPath = path.join(process.cwd(), "api", "pipeline.py");
    const { stdout, stderr } = await execAsync(
      `python3 ${scriptPath} --ticker ${ticker} --mock --no-ai`,
      { timeout: 30000 }
    );

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    // Parse last JSON line from stdout
    const lines = stdout.trim().split("\n");
    const jsonLine = lines.reverse().find(l => l.startsWith("{"));
    if (!jsonLine) throw new Error("No JSON output from pipeline");

    return res.status(200).json(JSON.parse(jsonLine));
  } catch (error) {
    console.error("Pipeline error:", error);
    // Fallback to mock on error
    return res.status(200).json({
      ...getMockPipelineResult(ticker),
      _fallback: true,
      _error: error.message,
    });
  }
}
