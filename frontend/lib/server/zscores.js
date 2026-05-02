import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { TRACKED_TICKERS } from "../tokens";
import { getLiveMentions } from "./socialMentions";
import { buildMentionTrendsForTicker, emptyMentionTrends } from "./mentionTrends";

export const TICKERS = TRACKED_TICKERS;

const DAY = 86400;

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

function unavailableRows() {
  return TICKERS.map((ticker) => ({
    ticker,
    zscore: 0,
    mentions_1h: 0,
    alert: false,
    chain: getChain(ticker),
  }));
}

export function getUnavailableZscores() {
  return unavailableRows();
}

async function fetchSupabaseMentionsSince(lowerBoundUnix) {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseKey = getEnv("SUPABASE_KEY");
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from("mentions")
      .select("ticker, count, timestamp")
      .gte("timestamp", lowerBoundUnix);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn("[zscores] supabase fetch failed:", e.message);
    return null;
  }
}

/** Local scrapers write `{repo}/data/mentions.db` — use when Supabase is empty or unavailable. */
function loadSqliteMentionsSince(lowerBoundUnix) {
  try {
    const dbPath = path.resolve(process.cwd(), "..", "data", "mentions.db");
    if (!fs.existsSync(dbPath)) return [];
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare("SELECT ticker, count, timestamp FROM mentions WHERE timestamp >= ?")
      .all(lowerBoundUnix)
      .map((r) => ({
        ticker: String(r.ticker || "").toUpperCase(),
        count: Number(r.count || 0),
        timestamp: Number(r.timestamp),
      }))
      .filter((r) => r.ticker && Number.isFinite(r.timestamp));
    db.close();
    return rows;
  } catch (e) {
    console.warn("[zscores] sqlite mentions read skipped:", e.message);
    return [];
  }
}

/**
 * Rows for deltas + 30d chart: prefer Supabase; else scrape SQLite.
 */
function resolveMentionTrendRows(supabaseRowsRaw, lowerBoundUnix) {
  const hasSupabaseEnv = !!(getEnv("SUPABASE_URL") && getEnv("SUPABASE_KEY"));

  if (Array.isArray(supabaseRowsRaw) && supabaseRowsRaw.length > 0) {
    return {
      rows: supabaseRowsRaw,
      mention_trends: { source: "supabase", detail: null, hint_short: null },
    };
  }

  const sqliteRows = loadSqliteMentionsSince(lowerBoundUnix);
  if (sqliteRows.length > 0) {
    return {
      rows: sqliteRows,
      mention_trends: { source: "sqlite", detail: null, hint_short: null },
    };
  }

  if (!hasSupabaseEnv) {
    return {
      rows: [],
      mention_trends: {
        source: "none",
        detail: "no_credentials",
        hint_short: null,
      },
    };
  }

  if (supabaseRowsRaw === null) {
    return {
      rows: [],
      mention_trends: {
        source: "none",
        detail: "supabase_error",
        hint_short: null,
      },
    };
  }

  return {
    rows: [],
    mention_trends: {
      source: "none",
      detail: "empty",
      hint_short: null,
    },
  };
}

function buildTickerTrendMap(rows, nowSec) {
  const safeRows = rows && rows.length ? rows : [];
  const map = {};
  for (const ticker of TICKERS) {
    map[ticker] = buildMentionTrendsForTicker(safeRows, ticker, nowSec);
  }
  return map;
}

function mergeTrendIntoRows(rows, trendMap) {
  return rows.map((row) => ({
    ...row,
    ...(trendMap[row.ticker] || emptyMentionTrends()),
  }));
}

export async function getZscores() {
  const nowSec = Math.floor(Date.now() / 1000);
  const sevenBoundary = nowSec - 7 * DAY;
  const trendLowerBound = nowSec - 61 * DAY;

  const [live, supabaseRowsRaw] = await Promise.all([
    getLiveMentionZscores(),
    fetchSupabaseMentionsSince(trendLowerBound),
  ]);

  const { rows: trendRows, mention_trends } = resolveMentionTrendRows(supabaseRowsRaw, trendLowerBound);
  const trendMap = buildTickerTrendMap(trendRows || [], nowSec);

  if (live) {
    return {
      tickers: mergeTrendIntoRows(live.tickers, trendMap),
      source: live.source,
      sources: live.sources.map(({ source, scanned, error }) => ({ source, scanned, error })),
      mention_trends,
    };
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseKey = getEnv("SUPABASE_KEY");
  const hasSupabaseConfigured = !!(supabaseUrl && supabaseKey);

  const dataSeven = trendRows.filter((r) => r.timestamp >= sevenBoundary);

  if (trendRows.length === 0) {
    const reason =
      mention_trends.detail === "supabase_error"
        ? "Could not query Supabase mentions (check credentials or logs)"
        : hasSupabaseConfigured
          ? "No mention rows in Supabase or local SQLite for ~61 days"
          : "SUPABASE_URL / SUPABASE_KEY not set — and data/mentions.db has no usable history rows";

    return {
      tickers: mergeTrendIntoRows(unavailableRows(), trendMap),
      source: "unavailable",
      reason,
      mention_trends,
    };
  }

  if (dataSeven.length === 0) {
    return {
      tickers: mergeTrendIntoRows(unavailableRows(), trendMap),
      source: mention_trends.source === "sqlite" ? "sqlite_history" : "supabase_history",
      reason:
        "No stored rows in the last 7 days (rolling deltas/chart below still reflect older history)",
      mention_trends,
    };
  }

  const oneHourAgo = nowSec - 3600;

  const results = TICKERS.map((ticker) => {
    const history = dataSeven.filter((r) => r.ticker === ticker);
    const recent = history.filter((r) => r.timestamp > oneHourAgo);
    const currentCount = recent.reduce((sum, row) => sum + Number(row.count || 0), 0);

    if (history.length < 3) {
      return { ticker, zscore: 0, mentions_1h: currentCount, alert: false, chain: getChain(ticker) };
    }

    const counts = history.map((r) => Number(r.count || 0));
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const std = Math.sqrt(
      counts.map((count) => Math.pow(count - mean, 2)).reduce((a, b) => a + b, 0) / counts.length,
    );
    const zscore = std === 0 ? 0 : (currentCount - mean) / std;

    return {
      ticker,
      zscore: Math.round(zscore * 100) / 100,
      mentions_1h: currentCount,
      alert: zscore > 2.0,
      chain: getChain(ticker),
    };
  });

  return {
    tickers: mergeTrendIntoRows(results, trendMap),
    source: mention_trends.source === "sqlite" ? "sqlite_history" : "supabase",
    mention_trends,
  };
}

async function getLiveMentionZscores() {
  try {
    const live = await getLiveMentions();
    const values = TICKERS.map((ticker) => Number(live.counts[ticker] || 0));
    const total = values.reduce((sum, count) => sum + count, 0);
    if (total === 0) return null;

    const mean = total / Math.max(1, values.length);
    const std =
      Math.sqrt(values.map((count) => Math.pow(count - mean, 2)).reduce((a, b) => a + b, 0) / Math.max(1, values.length)) ||
      1;
    const tickers = TICKERS.map((ticker) => {
      const count = Number(live.counts[ticker] || 0);
      const zscore = (count - mean) / std;
      return {
        ticker,
        zscore: Math.round(zscore * 100) / 100,
        mentions_1h: count,
        alert: zscore > 2.0,
        chain: getChain(ticker),
        source_counts: Object.fromEntries(live.sources.map((source) => [source.source, source.counts[ticker] || 0])),
      };
    });

    return {
      tickers,
      source: "live_social",
      sources: live.sources.map(({ source, scanned, error }) => ({ source, scanned, error })),
    };
  } catch (e) {
    console.error("[zscores] live social scrape failed:", e.message);
    return null;
  }
}

export async function getZscoreForTicker(ticker) {
  const data = await getZscores();
  const normalized = ticker.toUpperCase();
  const row = data.tickers.find((item) => item.ticker === normalized);
  if (row) return { ...row, source: data.source, reason: data.reason, mention_trends: data.mention_trends };

  const fallback =
    unavailableRows().find((item) => item.ticker === normalized) || {
      ticker: normalized,
      zscore: 0,
      mentions_1h: 0,
      alert: false,
      chain: getChain(normalized),
    };

  return {
    ...fallback,
    ...emptyMentionTrends(),
    source: data.source,
    reason: data.reason || "Ticker not present in tracked set",
    mention_trends: data.mention_trends,
  };
}

function getChain(ticker) {
  return ["SOL", "WIF", "BONK", "JUP", "PYTH", "RENDER", "JTO"].includes(ticker) ? "solana" : "ethereum";
}
