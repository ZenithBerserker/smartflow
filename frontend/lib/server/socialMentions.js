import { TRACKED_TICKERS } from "../tokens";
import { persistMentionSnapshotFromCounts } from "./persistMentionSnapshots";

const EXCLUDED_WORDS = new Set([
  "IT", "ON", "OR", "AT", "BE", "DO", "IF", "IN", "IS", "NO", "OF", "SO",
  "TO", "UP", "US", "WE", "GO", "BY", "AS", "ALL", "NEW", "OLD", "BIG",
  "TOP", "HOT", "CEO", "USD", "ATH",
]);

const REDDIT_SUBS = [
  "CryptoCurrency",
  "CryptoMoonShots",
  "SatoshiStreetBets",
  "solana",
  "ethereum",
  "altcoin",
  "defi",
  "memecoins",
];

const TELEGRAM_CHANNELS = [
  "CryptoSignalsAll",
  "binance_announcements",
  "Uniswap",
  "SolanaFloor",
  "dexsignals",
  "WhaleAlertio",
];

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
    withTimeout(scrapeFourChan(), 5000, "4chan_biz"),
    withTimeout(scrapeReddit(), 5000, "reddit"),
    withTimeout(scrapeTelegram(), 5000, "telegram"),
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
