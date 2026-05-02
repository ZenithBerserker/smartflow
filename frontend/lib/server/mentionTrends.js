const DAY_SECONDS = 86400;

/** @returns {number|null} */
export function pctChange(current, prev) {
  const c = Number(current) || 0;
  const p = Number(prev) || 0;
  if (p > 0) return Math.round(((c - p) / p) * 1000) / 10;
  if (p <= 0 && c > 0) return null;
  return p === 0 && c === 0 ? 0 : null;
}

export function aggregateMentions(rows, ticker, tsStartInclusive, tsEndExclusive) {
  let sum = 0;
  for (const r of rows) {
    if (r.ticker !== ticker) continue;
    const ts = Number(r.timestamp);
    if (ts < tsStartInclusive || ts >= tsEndExclusive) continue;
    sum += Number(r.count || 0);
  }
  return sum;
}

export function rollingDailyCounts(rows, ticker, numDays, nowSec = Math.floor(Date.now() / 1000)) {
  const counts = [];
  for (let i = numDays - 1; i >= 0; i--) {
    const endExclusive = nowSec - i * DAY_SECONDS;
    const start = endExclusive - DAY_SECONDS;
    counts.push(aggregateMentions(rows, ticker, start, endExclusive));
  }
  return counts;
}

/** @typedef {{ mentions_change_pct_24h: number|null, mentions_change_pct_7d: number|null, mentions_change_pct_30d: number|null, mentions_daily_30d: number[], mentions_trends_loaded: boolean }} MentionTrendExtras */

/** @returns {MentionTrendExtras} */
export function buildMentionTrendsForTicker(rows, ticker, nowSec = Math.floor(Date.now() / 1000)) {
  if (!rows || rows.length === 0) {
    return emptyMentionTrends();
  }

  const m24 = aggregateMentions(rows, ticker, nowSec - DAY_SECONDS, nowSec);
  const prev24 = aggregateMentions(rows, ticker, nowSec - 2 * DAY_SECONDS, nowSec - DAY_SECONDS);

  const m7 = aggregateMentions(rows, ticker, nowSec - 7 * DAY_SECONDS, nowSec);
  const prev7 = aggregateMentions(rows, ticker, nowSec - 14 * DAY_SECONDS, nowSec - 7 * DAY_SECONDS);

  const m30 = aggregateMentions(rows, ticker, nowSec - 30 * DAY_SECONDS, nowSec);
  const prev30 = aggregateMentions(rows, ticker, nowSec - 60 * DAY_SECONDS, nowSec - 30 * DAY_SECONDS);

  return {
    mentions_change_pct_24h: pctChange(m24, prev24),
    mentions_change_pct_7d: pctChange(m7, prev7),
    mentions_change_pct_30d: pctChange(m30, prev30),
    mentions_daily_30d: rollingDailyCounts(rows, ticker, 30, nowSec),
    mentions_trends_loaded: true,
  };
}

export function emptyMentionTrends() {
  return {
    mentions_change_pct_24h: null,
    mentions_change_pct_7d: null,
    mentions_change_pct_30d: null,
    mentions_daily_30d: [],
    mentions_trends_loaded: false,
  };
}
