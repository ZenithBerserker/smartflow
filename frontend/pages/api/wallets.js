// pages/api/wallets.js
// Fetches real top trader wallets from Birdeye + analyzes with Gemini AI
// Runs entirely on Vercel — no Python needed
// Requires: BIRDEYE_API_KEY and GEMINI_API_KEY in Vercel environment variables
import fs from "fs";
import path from "path";
import { getTokenMeta } from "../../lib/tokens";

let rootEnvCache;

function getEnv(name) {
  if (process.env[name]) return process.env[name];

  // Local dev often runs from frontend/, while this repo stores Python/API keys
  // in the project-root .env. Vercel still uses normal process.env values.
  if (!rootEnvCache) {
    rootEnvCache = {};
    const envPath = path.resolve(process.cwd(), "..", ".env");
    try {
      const raw = fs.readFileSync(envPath, "utf8");
      raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const eq = trimmed.indexOf("=");
        if (eq === -1) return;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key) rootEnvCache[key] = value;
      });
    } catch {}
  }

  return rootEnvCache[name];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = (req.query.ticker || "PEPE").toUpperCase();

  const BIRDEYE_KEY = getEnv("BIRDEYE_API_KEY");
  const GEMINI_KEY  = getEnv("GEMINI_API_KEY");

  if (!BIRDEYE_KEY || !GEMINI_KEY) {
    return res.status(200).json({
      ticker,
      wallets: [],
      smart_count: 0,
      smart_ratio: 0,
      source: "unavailable",
      reason: !BIRDEYE_KEY ? "BIRDEYE_API_KEY not set" : "GEMINI_API_KEY not set",
    });
  }

  try {
    // ── Step 1: Get contract address ─────────────────────────────────────────
    let contractAddress, chain;
    const known = getTokenMeta(ticker);

    if (known?.address) {
      contractAddress = known.address;
      chain = known.chain;
    } else {
      // Search DEXScreener for unknown tickers (free, no key)
      const searchRes = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${ticker}`,
        { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
      );
      const searchData = await searchRes.json();
      const pairs = searchData.pairs || [];
      const exact = pairs.filter(p => p.baseToken?.symbol?.toUpperCase() === ticker);
      const best = (exact.length > 0 ? exact : pairs)
        .sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0))[0];

      if (!best) {
        return buildResponse(res, ticker, [], "unavailable", "Token not found");
      }
      contractAddress = best.baseToken.address;
      chain = best.chainId;
    }

    // ── Step 2: Fetch top traders from Birdeye ───────────────────────────────
    const birdeyeChain = chain === "solana" ? "solana" : "ethereum";
    const traderParams = new URLSearchParams({
      address: contractAddress,
      time_frame: birdeyeChain === "solana" ? "7d" : "24h",
      sort_by: birdeyeChain === "solana" ? "realized_pnl" : "volume",
      sort_type: "desc",
      offset: "0",
      limit: "8",
    });
    const tradersUrl = `https://public-api.birdeye.so/defi/v2/tokens/top_traders?${traderParams.toString()}`;

    const tradersRes = await fetch(tradersUrl, {
      headers: {
        "X-API-KEY": BIRDEYE_KEY,
        "x-chain": birdeyeChain,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!tradersRes.ok) {
      console.error("[wallets] Birdeye error:", tradersRes.status, await tradersRes.text());
      return buildResponse(res, ticker, [], "unavailable", `Birdeye error: ${tradersRes.status}`);
    }

    const tradersData = await tradersRes.json();
    const topTraders = normalizeTopTraders(tradersData);

    if (topTraders.length === 0) {
      return buildResponse(res, ticker, [], "unavailable", "No trader data from Birdeye");
    }

    // ── Step 3: Fetch PnL history for each wallet ────────────────────────────
    const walletAddresses = topTraders.slice(0, 6).map(t => t.address).filter(Boolean);
    let walletPnlData = [];

    if (birdeyeChain === "solana" && walletAddresses.length > 0) try {
      const pnlUrl = `https://public-api.birdeye.so/wallet/v2/pnl/multiple?wallet=${walletAddresses.join("&wallet=")}`;
      const pnlRes = await fetch(pnlUrl, {
        headers: { "X-API-KEY": BIRDEYE_KEY, "x-chain": birdeyeChain, "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (pnlRes.ok) {
        const pnlData = await pnlRes.json();
        walletPnlData = pnlData?.data || [];
      }
    } catch (e) {
      console.log("[wallets] PnL fetch failed, using trader summary only:", e.message);
    }

    // ── Step 4: Build wallet payload for Gemini ──────────────────────────────
    const walletsForAI = topTraders.slice(0, 6).map((trader) => {
      const pnl = walletPnlData.find(p => p.wallet === trader.address) || {};
      return {
        address: trader.address,
        realized_pnl_usd: num(trader.realizedPnl ?? trader.realized_pnl ?? trader.realized_pnl_usd ?? pnl.realizedPnl),
        unrealized_pnl_usd: num(trader.unrealizedPnl ?? trader.unrealized_pnl ?? trader.unrealized_pnl_usd),
        total_pnl_usd: num(trader.totalPnl ?? trader.total_pnl ?? trader.total_pnl_usd),
        trade_count: num(trader.tradeCount ?? trader.trade_count ?? trader.trade ?? trader.trades),
        volume_usd: num(trader.volumeUsd ?? trader.volume_usd ?? trader.volume),
        buy_count: num(trader.buyCount ?? trader.buy_count ?? trader.tradeBuy ?? trader.buy),
        sell_count: num(trader.sellCount ?? trader.sell_count ?? trader.tradeSell ?? trader.sell),
        historical_win_rate: pnl.winRate || null,
        historical_pnl_usd: pnl.realizedPnl || null,
        tokens_traded: pnl.tokenCount || null,
      };
    });

    // ── Step 5: Analyze with Gemini Flash ────────────────────────────────────
    const geminiPrompt = `You are an elite quantitative crypto analyst. Analyze these wallet trading records for the token ${ticker} and classify each wallet.

For each wallet return ONLY a JSON array (no markdown, no preamble, no explanation):
[
  {
    "wallet_address": string,
    "win_rate_percentage": number (estimate from buy/sell ratio and PnL if win_rate not provided),
    "total_realized_pnl_usd": number,
    "total_trades": number,
    "risk_classification": "Conservative" | "Moderate" | "Aggressive" | "Degenerate",
    "is_smart_money": boolean,
    "smart_money_reason": string (one sentence max)
  }
]

Smart money criteria (BOTH required for is_smart_money=true):
- win_rate_percentage >= 65
- total_realized_pnl_usd > 100000

Wallet data:
${JSON.stringify(walletsForAI, null, 2)}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: geminiPrompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!geminiRes.ok) {
      console.error("[wallets] Gemini error:", geminiRes.status);
      // Fall back to rule-based scoring if Gemini fails
      const ruleBasedWallets = walletsForAI.map(w => scoreWalletRuleBased(w));
      return buildResponse(res, ticker, ruleBasedWallets, "birdeye+rule_based", `Gemini error: ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from Gemini response
    let analysisResults = [];
    try {
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysisResults = JSON.parse(cleaned);
    } catch (e) {
      console.error("[wallets] JSON parse error:", e.message, "Raw:", rawText.slice(0, 200));
      // Fall back to rule-based
      const ruleBasedWallets = walletsForAI.map(w => scoreWalletRuleBased(w));
      return buildResponse(res, ticker, ruleBasedWallets, "birdeye+rule_based", "Gemini returned invalid JSON");
    }

    return buildResponse(res, ticker, enrichWallets(analysisResults, walletsForAI), "birdeye+gemini");

  } catch (error) {
    console.error("[wallets] Pipeline error:", error);
    return res.status(200).json({
      ticker,
      wallets: [],
      smart_count: 0,
      smart_ratio: 0,
      source: "unavailable",
      reason: error.message,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildResponse(res, ticker, wallets, source, reason = undefined) {
  const smartWallets = wallets.filter(w => w.is_smart_money);
  return res.status(200).json({
    ticker,
    wallets,
    smart_count: smartWallets.length,
    smart_ratio: wallets.length > 0 ? smartWallets.length / wallets.length : 0,
    source,
    reason,
    timestamp: Date.now(),
  });
}

function normalizeTopTraders(data) {
  const candidates = [
    data?.data?.items,
    data?.data?.traders,
    data?.data,
    data?.items,
  ];
  const list = candidates.find(Array.isArray) || [];
  return list
    .map((item) => ({
      ...item,
      address: item.address || item.owner || item.wallet || item.walletAddress || item.wallet_address,
    }))
    .filter((item) => item.address);
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function enrichWallets(results, rawWallets) {
  return results.map((wallet, i) => {
    const raw = rawWallets.find(w => w.address === wallet.wallet_address) || rawWallets[i] || {};
    return {
      ...wallet,
      wallet_address: wallet.wallet_address || raw.address,
      volume_usd: raw.volume_usd || 0,
      buy_count: raw.buy_count || 0,
      sell_count: raw.sell_count || 0,
      total_pnl_usd: raw.total_pnl_usd || 0,
      unrealized_pnl_usd: raw.unrealized_pnl_usd || 0,
    };
  });
}

function scoreWalletRuleBased(w) {
  // Simple rule-based scoring when AI is unavailable
  const buys = w.buy_count || 0;
  const sells = w.sell_count || 0;
  const total = buys + sells;
  const winRate = total > 0 ? Math.round((buys / total) * 100) : 50;
  const pnl = w.realized_pnl_usd || 0;
  const trades = w.trade_count || total;
  const isSmart = winRate >= 65 && pnl > 100000;

  let risk = "Moderate";
  if (trades > 500) risk = "Degenerate";
  else if (trades > 200) risk = "Aggressive";
  else if (pnl > 500000 && trades < 100) risk = "Conservative";

  return {
    wallet_address: w.address,
    win_rate_percentage: winRate,
    total_realized_pnl_usd: pnl,
    total_trades: trades,
    volume_usd: w.volume_usd || 0,
    buy_count: buys,
    sell_count: sells,
    total_pnl_usd: w.total_pnl_usd || 0,
    unrealized_pnl_usd: w.unrealized_pnl_usd || 0,
    risk_classification: risk,
    is_smart_money: isSmart,
    smart_money_reason: isSmart
      ? "Meets win rate and PnL thresholds based on trading history."
      : "Does not meet minimum smart money criteria.",
  };
}
