import { TRACKED_TICKERS } from "../tokens";
import { persistMentionSnapshotFromCounts } from "./persistMentionSnapshots";

const EXCLUDED_WORDS = new Set([
  "IT", "ON", "OR", "AT", "BE", "DO", "IF", "IN", "IS", "NO", "OF", "SO",
  "TO", "UP", "US", "WE", "GO", "BY", "AS", "ALL", "NEW", "OLD", "BIG",
  "TOP", "HOT", "CEO", "USD", "ATH",
]);

/** Comma- or pipe-separated; optional `r/` / `@` prefixes stripped. Use in Vercel: `base,ethtrader` or `@lookonchain`. */
function splitEnvList(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,|]/)
    .map((s) => s.trim().replace(/^@/, "").replace(/^r\//i, ""))
    .filter(Boolean);
}

function mergeUnique(base, extras) {
  const seen = new Set(base.map((s) => String(s).toLowerCase()));
  const out = [...base];
  for (const x of extras) {
    const n = String(x).trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

/** Subs with real discussion & market context; cheap alt/pump subs kept for retail flow. */
const REDDIT_SUBS_BASE = [
  "CryptoCurrency",
  "CryptoMarkets",
  "BitcoinMarkets",
  "Bitcoin",
  "ethtrader",
  "ethfinance",
  "ethereum",
  "solana",
  "cardano",
  "cosmosnetwork",
  "avalancheavax",
  "polygonnetwork",
  "arbitrum",
  "Chainlink",
  "Ripple",
  "altcoin",
  "defi",
  "memecoins",
  "CryptoMoonShots",
  "SatoshiStreetBets",
];

const REDDIT_SUBS = mergeUnique(REDDIT_SUBS_BASE, splitEnvList(process.env.REDDIT_EXTRA_SUBS));

/**
 * Public t.me/s/… channels only. Prefer news, protocol & on-chain analytics over “signals” bots.
 * Remove any that 404 or go private; add more the same way (username as in t.me/username).
 */
const TELEGRAM_CHANNELS_BASE = [
  "binance_announcements",
  "coindesk",
  "cointelegraph",
  "theblockcrypto",
  "defillama",
  "lookonchain",
  "Uniswap",
  "SolanaFloor",
  "WhaleAlertio",
  "WatcherGuru",
  "WuBlockchain",
];

const TELEGRAM_CHANNELS = mergeUnique(TELEGRAM_CHANNELS_BASE, splitEnvList(process.env.TELEGRAM_EXTRA_CHANNELS));

let mentionCache;
let mentionPending;

export async function getLiveMentions({ force = false } = {}) {
  const now = Date.now();
  if (!force && mentionCache && now - mentionCache.timestamp < 5 * 60 * 1000) {
    return mentionCache.data;
  }
  if (!force && mentionPending) return mentionPending;

  mentionPending = collectLiveMentions();
  try {
    return await mentionPending;
  } finally {
    mentionPending = null;
  }
}

async function collectLiveMentions() {
  const now = Date.now();
  const sources = await Promise.allSettled([
    withTimeout(scrapeFourChan(), 7000, "4chan_biz"),
    withTimeout(scrapeReddit(), 14000, "reddit"),
    withTimeout(scrapeTelegram(), 14000, "telegram"),
  ]);

  const sourceResults = sources.map((result, i) => {
    const fallback = { counts: emptyCounts(), source: ["4chan_biz", "reddit", "telegram"][i], scanned: 0, error: "unavailable" };
    return result.status === "fulfilled" ? result.value : fallback;
  });

  const counts = emptyCounts();
  for (const source of sourceResults) {
    for (const ticker of TRACKED_TICKERS) counts[ticker] += source.counts[ticker] || 0;
  }

  const data = {
    counts,
    sources: sourceResults,
    source: "live_social",
    timestamp: now,
  };
  mentionCache = { timestamp: now, data };
  persistMentionSnapshotFromCounts(counts).catch(() => {});
  return data;
}

async function withTimeout(promise, timeoutMs, source) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${source} timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function extractTickers(text) {
  if (!text) return [];
  const clean = stripHtml(text).toUpperCase();
  const found = new Set();

  for (const match of clean.matchAll(/\$([A-Z][A-Z0-9]{1,9})\b/g)) {
    const ticker = match[1];
    if (!EXCLUDED_WORDS.has(ticker)) found.add(ticker);
  }

  for (const ticker of TRACKED_TICKERS) {
    if (new RegExp(`\\b${escapeRegExp(ticker)}\\b`, "i").test(clean)) found.add(ticker);
  }

  return [...found].filter((ticker) => TRACKED_TICKERS.includes(ticker));
}

async function scrapeFourChan() {
  const counts = emptyCounts();
  let scanned = 0;
  const catalogRes = await fetch("https://a.4cdn.org/biz/catalog.json", {
    headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
    signal: AbortSignal.timeout(6000),
  });
  if (!catalogRes.ok) throw new Error(`4chan ${catalogRes.status}`);
  const pages = await catalogRes.json();
  const threads = pages.flatMap((page) => page.threads || []).slice(0, 80);

  for (const thread of threads) {
    scanned += 1;
    countInto(counts, `${thread.sub || ""} ${thread.com || ""}`);
  }

  return { source: "4chan_biz", counts, scanned };
}

async function scrapeReddit() {
  const counts = emptyCounts();
  let scanned = 0;

  await Promise.all(REDDIT_SUBS.map(async (sub) => {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=40`, {
        headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return;
      const data = await res.json();
      for (const child of data?.data?.children || []) {
        const post = child.data || {};
        scanned += 1;
        countInto(counts, `${post.title || ""} ${post.selftext || ""}`);
      }
    } catch {}
  }));

  return { source: "reddit", counts, scanned };
}

async function scrapeTelegram() {
  const counts = emptyCounts();
  let scanned = 0;

  await Promise.all(TELEGRAM_CHANNELS.map(async (channel) => {
    try {
      const res = await fetch(`https://t.me/s/${channel}`, {
        headers: { "Accept": "text/html", "User-Agent": "BlackCat/1.0" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return;
      const html = await res.text();
      const messages = html.match(/<div class="tgme_widget_message_text[^>]*>[\s\S]*?<\/div>/g) || [];
      scanned += messages.length;
      for (const message of messages.slice(-60)) countInto(counts, message);
    } catch {}
  }));

  return { source: "telegram", counts, scanned };
}

function countInto(counts, text) {
  for (const ticker of extractTickers(text)) counts[ticker] = (counts[ticker] || 0) + 1;
}

function emptyCounts() {
  return Object.fromEntries(TRACKED_TICKERS.map((ticker) => [ticker, 0]));
}

function stripHtml(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
