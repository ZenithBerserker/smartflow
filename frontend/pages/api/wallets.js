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
    let walletHoldingData = {};

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

    if (walletAddresses.length > 0) {
      walletHoldingData = Object.fromEntries(await Promise.all(walletAddresses.map(async (wallet) => {
        const summary = await fetchWalletHoldings(BIRDEYE_KEY, birdeyeChain, wallet, ticker, contractAddress);
        return [wallet, summary];
      })));
    }

    // ── Step 4: Build wallet payload for Gemini ──────────────────────────────
    const walletsForAI = topTraders.slice(0, 6).map((trader) => {
      const pnl = walletPnlData.find(p => p.wallet === trader.address) || {};
      const holdings = walletHoldingData[trader.address] || {};
      const buys = num(trader.buyCount ?? trader.buy_count ?? trader.tradeBuy ?? trader.buy);
      const sells = num(trader.sellCount ?? trader.sell_count ?? trader.tradeSell ?? trader.sell);
      const realized = num(trader.realizedPnl ?? trader.realized_pnl ?? trader.realized_pnl_usd ?? pnl.realizedPnl);
      const volume = num(trader.volumeUsd ?? trader.volume_usd ?? trader.volume);
      const firstTrade = timeMs(trader.firstTradeTime ?? trader.first_trade_time ?? trader.firstTradeAt ?? trader.first_trade_at);
      const lastTrade = timeMs(trader.lastTradeTime ?? trader.last_trade_time ?? trader.lastTradeAt ?? trader.last_trade_at);
      const observedDays = firstTrade && lastTrade ? Math.max(1, (lastTrade - firstTrade) / 86400000) : null;
      const avgHoldDays = daysFromAny(trader.avgHoldingTime ?? trader.avg_holding_time ?? trader.holdingTime ?? trader.holding_time ?? pnl.avgHoldingTime);
      return {
        address: trader.address,
        realized_pnl_usd: realized,
        unrealized_pnl_usd: num(trader.unrealizedPnl ?? trader.unrealized_pnl ?? trader.unrealized_pnl_usd),
        total_pnl_usd: num(trader.totalPnl ?? trader.total_pnl ?? trader.total_pnl_usd),
        trade_count: num(trader.tradeCount ?? trader.trade_count ?? trader.trade ?? trader.trades),
        volume_usd: volume,
        buy_count: buys,
        sell_count: sells,
        historical_win_rate: pnl.winRate || null,
        historical_pnl_usd: pnl.realizedPnl || null,
        tokens_traded: pnl.tokenCount || null,
        avg_hold_days: avgHoldDays,
        observed_trade_days: observedDays,
        capital_allocated_usd: holdings.token_value_usd || num(trader.currentValueUsd ?? trader.current_value_usd ?? trader.holdingUsd),
        largest_alt_position_usd: holdings.largest_alt_position_usd || 0,
        largest_alt_symbol: holdings.largest_alt_symbol || "",
        target_token_value_usd: holdings.token_value_usd || 0,
        portfolio_value_usd: holdings.portfolio_value_usd || 0,
        profit_to_volume_ratio: volume > 0 ? realized / volume : 0,
      };
    });

    // ── Step 5: Analyze with Gemini Flash ────────────────────────────────────
    const geminiPrompt = `You are an elite quantitative crypto analyst. Analyze these wallet trading records for the token ${ticker} and classify each wallet.

For each wallet return ONLY a JSON array (no markdown, no preamble, no explanation):
[
  {
    "wallet_address": string,
    "wallet_verdict": "BULLISH" | "BEARISH" | "NEUTRAL",
    "conviction_score": number from 0 to 100,
    "investment_horizon": "Long-term accumulator" | "Swing trader" | "Short-term flipper" | "Unknown",
    "win_rate_percentage": number,
    "total_realized_pnl_usd": number,
    "total_trades": number,
    "capital_allocated_usd": number,
    "largest_alt_position_usd": number,
    "largest_alt_symbol": string,
    "avg_hold_days": number or null,
    "risk_classification": "Conservative" | "Moderate" | "Aggressive" | "Degenerate",
    "is_smart_money": boolean,
    "smart_money_reason": string (one sentence max)
  }
]

Bullish smart money should require durable edge, not only activity:
- profitable realized or historical PnL, preferably over many observed days
- meaningful capital allocation or current target-token holding
- reasonable win rate or profit-to-volume efficiency
- not just rapid churn, wash-like volume, or one lucky trade

Bearish means profitable wallets are exiting, low current allocation, high sell pressure, or poor long-term edge. Neutral means insufficient evidence.

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
  const bullishWallets = wallets.filter(w => w.wallet_verdict === "BULLISH");
  const bearishWallets = wallets.filter(w => w.wallet_verdict === "BEARISH");
  return res.status(200).json({
    ticker,
    wallets,
    smart_count: smartWallets.length,
    smart_ratio: wallets.length > 0 ? smartWallets.length / wallets.length : 0,
    bullish_count: bullishWallets.length,
    bearish_count: bearishWallets.length,
    conviction_avg: wallets.length > 0
      ? Math.round(wallets.reduce((sum, w) => sum + num(w.conviction_score), 0) / wallets.length)
      : 0,
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
      wallet_verdict: wallet.wallet_verdict || scoreWalletRuleBased(raw).wallet_verdict,
      conviction_score: num(wallet.conviction_score) || scoreWalletRuleBased(raw).conviction_score,
      investment_horizon: wallet.investment_horizon || scoreWalletRuleBased(raw).investment_horizon,
      capital_allocated_usd: num(wallet.capital_allocated_usd) || raw.capital_allocated_usd || 0,
      largest_alt_position_usd: num(wallet.largest_alt_position_usd) || raw.largest_alt_position_usd || 0,
      largest_alt_symbol: wallet.largest_alt_symbol || raw.largest_alt_symbol || "",
      avg_hold_days: wallet.avg_hold_days ?? raw.avg_hold_days ?? null,
    };
  });
}

function scoreWalletRuleBased(w) {
  const buys = w.buy_count || 0;
  const sells = w.sell_count || 0;
  const total = buys + sells;
  const winRate = w.historical_win_rate ? Math.round(num(w.historical_win_rate)) : total > 0 ? Math.round((buys / total) * 100) : 50;
  const pnl = w.realized_pnl_usd || 0;
  const trades = w.trade_count || total;
  const allocation = w.capital_allocated_usd || 0;
  const avgHold = w.avg_hold_days || 0;
  const observedDays = w.observed_trade_days || 0;
  const profitEfficiency = w.profit_to_volume_ratio || 0;
  const sellPressure = total > 0 ? sells / total : 0.5;
  const conviction = Math.max(0, Math.min(100, Math.round(
    (pnl > 100000 ? 25 : pnl > 25000 ? 12 : 0) +
    (winRate >= 65 ? 20 : winRate >= 55 ? 10 : 0) +
    (allocation > 100000 ? 20 : allocation > 25000 ? 10 : 0) +
    (avgHold >= 30 || observedDays >= 90 ? 15 : avgHold >= 7 || observedDays >= 30 ? 8 : 0) +
    (profitEfficiency > 0.15 ? 10 : profitEfficiency > 0.03 ? 5 : 0) -
    (sellPressure > 0.7 ? 20 : 0)
  )));
  const walletVerdict = conviction >= 65 ? "BULLISH" : sellPressure > 0.7 || pnl < -25000 ? "BEARISH" : "NEUTRAL";
  const isSmart = walletVerdict === "BULLISH" && pnl > 25000 && (allocation > 10000 || avgHold >= 7 || observedDays >= 30);

  let risk = "Moderate";
  if (trades > 500) risk = "Degenerate";
  else if (trades > 200) risk = "Aggressive";
  else if (pnl > 500000 && trades < 100) risk = "Conservative";
  const horizon = avgHold >= 30 || observedDays >= 90
    ? "Long-term accumulator"
    : avgHold >= 7 || observedDays >= 30
      ? "Swing trader"
      : trades > 0
        ? "Short-term flipper"
        : "Unknown";

  return {
    wallet_address: w.address,
    wallet_verdict: walletVerdict,
    conviction_score: conviction,
    investment_horizon: horizon,
    win_rate_percentage: winRate,
    total_realized_pnl_usd: pnl,
    total_trades: trades,
    volume_usd: w.volume_usd || 0,
    buy_count: buys,
    sell_count: sells,
    total_pnl_usd: w.total_pnl_usd || 0,
    unrealized_pnl_usd: w.unrealized_pnl_usd || 0,
    capital_allocated_usd: allocation,
    largest_alt_position_usd: w.largest_alt_position_usd || 0,
    largest_alt_symbol: w.largest_alt_symbol || "",
    avg_hold_days: w.avg_hold_days ?? null,
    risk_classification: risk,
    is_smart_money: isSmart,
    smart_money_reason: isSmart
      ? "Durable PnL, allocation, and holding profile support bullish smart-money behavior."
      : walletVerdict === "BEARISH"
        ? "Sell pressure or poor PnL profile argues against bullish confirmation."
        : "Insufficient durable edge or allocation for a bullish smart-money read.",
  };
}

async function fetchWalletHoldings(apiKey, chain, wallet, ticker, tokenAddress) {
  const endpoints = [
    `https://public-api.birdeye.so/wallet/v2/token_list?wallet=${wallet}`,
    `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${wallet}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: { "X-API-KEY": apiKey, "x-chain": chain, "Accept": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const items = normalizeTokenList(data);
      if (items.length === 0) continue;
      const portfolioValue = items.reduce((sum, item) => sum + item.value_usd, 0);
      const target = items.find((item) =>
        item.address?.toLowerCase() === tokenAddress?.toLowerCase() || item.symbol?.toUpperCase() === ticker
      );
      const largestAlt = items
        .filter((item) => !["USDC", "USDT", "DAI", "USD"].includes(item.symbol?.toUpperCase()))
        .sort((a, b) => b.value_usd - a.value_usd)[0];
      return {
        portfolio_value_usd: portfolioValue,
        token_value_usd: target?.value_usd || 0,
        largest_alt_position_usd: largestAlt?.value_usd || 0,
        largest_alt_symbol: largestAlt?.symbol || "",
      };
    } catch {}
  }

  return {};
}

function normalizeTokenList(data) {
  const list = [
    data?.data?.items,
    data?.data?.tokens,
    data?.data,
    data?.items,
  ].find(Array.isArray) || [];
  return list.map((item) => ({
    address: item.address || item.mint || item.tokenAddress,
    symbol: item.symbol || item.token_symbol,
    value_usd: num(item.valueUsd ?? item.value_usd ?? item.usdValue ?? item.value),
  })).filter((item) => item.value_usd > 0);
}

function timeMs(value) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysFromAny(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 10000000) return Math.round((n / 86400000) * 10) / 10;
  if (n > 86400) return Math.round((n / 86400) * 10) / 10;
  return Math.round(n * 10) / 10;
}
