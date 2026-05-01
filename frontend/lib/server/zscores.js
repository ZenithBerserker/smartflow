import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { TRACKED_TICKERS } from "../tokens";

export const TICKERS = TRACKED_TICKERS;

let rootEnvCache;

function getEnv(name) {
  if (process.env[name]) return process.env[name];

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

export function getMockZscores() {
  const base = { PEPE: 1.8, WIF: 2.1, BONK: 1.4, TURBO: 3.1, FLOKI: 1.6, DOGE: 0.9, SHIB: 1.1, SOL: 2.3, ETH: 0.7, BTC: 0.6, ARB: 1.9, LINK: 1.2, INJ: 2.6, TIA: 1.5, OP: 1.7, AVAX: 1.4, MATIC: 1.2, UNI: 1.1, AAVE: 1.3, JUP: 2.4, PYTH: 2.0, RENDER: 2.2, FET: 2.1, SUI: 1.9, APT: 1.6, NEAR: 1.8, ATOM: 1.0, RUNE: 1.7, SEI: 2.0, ENA: 2.3, LDO: 1.4, PENDLE: 2.2, ONDO: 2.1, JTO: 1.9 };
  return TICKERS.map((ticker) => {
    const z = base[ticker] || 1.0;
    return {
    ticker,
    zscore: Math.round((z + Math.random() * 0.3 - 0.15) * 100) / 100,
    mentions_1h: Math.round(z * 45 + Math.random() * 30),
    alert: z > 2.0,
    chain: ["SOL", "WIF", "BONK"].includes(ticker) ? "solana" : "ethereum",
  };
  });
}

export async function getZscores() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseKey = getEnv("SUPABASE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return {
      tickers: getMockZscores(),
      source: "mock",
      reason: "SUPABASE_URL or SUPABASE_KEY not set",
    };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

    const { data, error } = await supabase
      .from("mentions")
      .select("ticker, count, timestamp")
      .gte("timestamp", sevenDaysAgo);

    if (error) throw error;

    if (!data || data.length === 0) {
      return {
        tickers: getMockZscores(),
        source: "mock",
        reason: "No mention data found in Supabase",
      };
    }

    const results = TICKERS.map((ticker) => {
      const history = data.filter((r) => r.ticker === ticker);
      const recent = history.filter((r) => r.timestamp > oneHourAgo);
      const currentCount = recent.reduce((sum, row) => sum + Number(row.count || 0), 0);

      if (history.length < 3) {
        return { ticker, zscore: 0, mentions_1h: currentCount, alert: false, chain: getChain(ticker) };
      }

      const counts = history.map((r) => Number(r.count || 0));
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const std = Math.sqrt(counts.map((count) => Math.pow(count - mean, 2)).reduce((a, b) => a + b, 0) / counts.length);
      const zscore = std === 0 ? 0 : (currentCount - mean) / std;

      return {
        ticker,
        zscore: Math.round(zscore * 100) / 100,
        mentions_1h: currentCount,
        alert: zscore > 2.0,
        chain: getChain(ticker),
      };
    });

    return { tickers: results, source: "supabase" };
  } catch (e) {
    return {
      tickers: getMockZscores(),
      source: "mock",
      reason: e.message,
    };
  }
}

export async function getZscoreForTicker(ticker) {
  const data = await getZscores();
  const normalized = ticker.toUpperCase();
  const row = data.tickers.find((item) => item.ticker === normalized);
  if (row) return { ...row, source: data.source, reason: data.reason };

  const fallback = getMockZscores().find((item) => item.ticker === normalized) || {
    ticker: normalized,
    zscore: 1,
    mentions_1h: 45,
    alert: false,
    chain: getChain(normalized),
  };
  return { ...fallback, source: data.source, reason: data.reason || "Ticker not present in tracked set" };
}

function getChain(ticker) {
  return ["SOL", "WIF", "BONK", "JUP", "PYTH", "RENDER", "JTO"].includes(ticker) ? "solana" : "ethereum";
}
