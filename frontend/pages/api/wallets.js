// pages/api/wallets.js
// Fetches real top trader wallets from Birdeye + analyzes with Gemini AI
// Runs entirely on Vercel — no Python needed
// Requires: BIRDEYE_API_KEY and GEMINI_API_KEY in Vercel environment variables
import fs from "fs";
import path from "path";

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

  // If no keys, return mock data so UI never breaks
  if (!BIRDEYE_KEY || !GEMINI_KEY) {
    console.log("[wallets] Missing API keys — returning mock data");
    return res.status(200).json({
      ticker,
      wallets: getMockWallets(),
      smart_count: 4,
      smart_ratio: 0.67,
      source: "mock",
      reason: !BIRDEYE_KEY ? "BIRDEYE_API_KEY not set" : "GEMINI_API_KEY not set",
    });
  }

  // Known contract addresses for quick lookup
  const CONTRACTS = {
    PEPE:  { chain: "ethereum", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
    WIF:   { chain: "solana",   address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
    BONK:  { chain: "solana",   address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
    TURBO: { chain: "ethereum", address: "0xA35923162C49cF95e6BF26623385eb431ad920D3" },
    FLOKI: { chain: "ethereum", address: "0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E" },
    SHIB:  { chain: "ethereum", address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE" },
    ARB:   { chain: "ethereum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
    LINK:  { chain: "ethereum", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
    INJ:   { chain: "ethereum", address: "0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30" },
    SOL:   { chain: "solana",   address: "So11111111111111111111111111111111111111112" },
  };

  try {
    // ── Step 1: Get contract address ─────────────────────────────────────────
    let contractAddress, chain;
    const known = CONTRACTS[ticker];

    if (known) {
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
        return res.status(200).json({ ticker, wallets: getMockWallets(), source: "mock", reason: "Token not found" });
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
      return res.status(200).json({ ticker, wallets: getMockWallets(), source: "mock", reason: `Birdeye error: ${tradersRes.status}` });
    }

    const tradersData = await tradersRes.json();
    const topTraders = normalizeTopTraders(tradersData);

    if (topTraders.length === 0) {
      return res.status(200).json({ ticker, wallets: getMockWallets(), source: "mock", reason: "No trader data from Birdeye" });
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

    return buildResponse(res, ticker, analysisResults, "birdeye+gemini");

  } catch (error) {
    console.error("[wallets] Pipeline error:", error);
    return res.status(200).json({
      ticker,
      wallets: getMockWallets(),
      source: "mock",
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
    risk_classification: risk,
    is_smart_money: isSmart,
    smart_money_reason: isSmart
      ? "Meets win rate and PnL thresholds based on trading history."
      : "Does not meet minimum smart money criteria.",
  };
}

function getMockWallets() {
  return [
    { wallet_address: "0x3aF7...b291", win_rate_percentage: 78, total_realized_pnl_usd: 842000,  total_trades: 234, risk_classification: "Moderate",      is_smart_money: true,  smart_money_reason: "Consistent high win rate across multiple tokens." },
    { wallet_address: "0x1c9E...d047", win_rate_percentage: 71, total_realized_pnl_usd: 1240000, total_trades: 189, risk_classification: "Aggressive",    is_smart_money: true,  smart_money_reason: "Strong PnL with above-threshold win rate." },
    { wallet_address: "4xKmP...qR2s", win_rate_percentage: 64, total_realized_pnl_usd: 390000,  total_trades: 412, risk_classification: "Degenerate",    is_smart_money: false, smart_money_reason: "Win rate slightly below 65% threshold." },
    { wallet_address: "0x82bD...f3A1", win_rate_percentage: 69, total_realized_pnl_usd: 670000,  total_trades: 301, risk_classification: "Moderate",      is_smart_money: true,  smart_money_reason: "Meets both win rate and PnL criteria." },
    { wallet_address: "9wLqT...mN5j", win_rate_percentage: 55, total_realized_pnl_usd: 88000,   total_trades: 567, risk_classification: "Aggressive",    is_smart_money: false, smart_money_reason: "PnL below $100K threshold." },
    { wallet_address: "0xE4c2...7e9F", win_rate_percentage: 82, total_realized_pnl_usd: 2100000, total_trades: 98,  risk_classification: "Conservative",  is_smart_money: true,  smart_money_reason: "Elite win rate with very high realized PnL." },
  ];
}
