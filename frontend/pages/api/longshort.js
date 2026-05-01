const SYMBOL_MAP = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  DOGE: "DOGEUSDT",
  LINK: "LINKUSDT",
  AVAX: "AVAXUSDT",
  ARB: "ARBUSDT",
  OP: "OPUSDT",
  MATIC: "POLUSDT",
  POL: "POLUSDT",
  UNI: "UNIUSDT",
  AAVE: "AAVEUSDT",
  INJ: "INJUSDT",
  TIA: "TIAUSDT",
  SUI: "SUIUSDT",
  APT: "APTUSDT",
  NEAR: "NEARUSDT",
  ATOM: "ATOMUSDT",
  RUNE: "RUNEUSDT",
  SEI: "SEIUSDT",
  ENA: "ENAUSDT",
  LDO: "LDOUSDT",
  PENDLE: "PENDLEUSDT",
  ONDO: "ONDOUSDT",
  JUP: "JUPUSDT",
  PYTH: "PYTHUSDT",
  RENDER: "RENDERUSDT",
  FET: "FETUSDT",
  JTO: "JTOUSDT",
  TURBO: "TURBOUSDT",
  WIF: "WIFUSDT",
  BONK: "1000BONKUSDT",
  SHIB: "1000SHIBUSDT",
  FLOKI: "1000FLOKIUSDT",
  PEPE: "1000PEPEUSDT",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = (req.query.ticker || "BTC").toUpperCase();
  const symbol = SYMBOL_MAP[ticker] || `${ticker}USDT`;

  try {
    const feeds = await Promise.allSettled([
      fetchBinanceArray("global accounts", `/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=24`),
      fetchBinanceArray("top positions", `/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=1h&limit=24`),
      fetchBinanceObject("funding rate", `/fapi/v1/premiumIndex?symbol=${symbol}`),
    ]);
    const [account, position, funding] = feeds.map((feed, index) => feed.status === "fulfilled" ? feed.value : (index === 2 ? null : []));
    const feedErrors = feeds
      .filter((feed) => feed.status === "rejected")
      .map((feed) => feed.reason?.message)
      .filter(Boolean);

    if (!account.length && !position.length && !funding) {
      return res.status(200).json({
        ticker,
        symbol,
        available: false,
        source: "binance_futures",
        reason: feedErrors.length
          ? feedErrors.join("; ")
          : "No Binance futures long/short data available for this ticker",
        timestamp: Date.now(),
      });
    }

    const latestAccount = last(account);
    const latestPosition = last(position);
    const accountRatio = num(latestAccount?.longShortRatio);
    const topPositionRatio = num(latestPosition?.longShortRatio);
    const accountLongPct = longPctFromAccountRow(latestAccount);
    const topLongPct = longPctFromAccountRow(latestPosition);
    const fundingRatePct = fundingRatePctFromRow(funding);
    const fundingBiasPct = fundingBiasPctFromRate(fundingRatePct);
    const avgAccountLong = average(account.map(longPctFromAccountRow).filter(Number.isFinite));
    const biasScoreRaw = average([accountLongPct, topLongPct, fundingBiasPct].filter(Number.isFinite));
    const biasScore = Number.isFinite(biasScoreRaw) ? Math.round(biasScoreRaw) : null;
    const accountTrend = Number.isFinite(accountLongPct) && Number.isFinite(avgAccountLong)
      ? Math.round((accountLongPct - avgAccountLong) * 10) / 10
      : 0;
    const signal = !Number.isFinite(biasScore)
      ? "UNAVAILABLE"
      : biasScore >= 58 && accountTrend >= -2
      ? "BULLISH"
      : biasScore <= 42 && accountTrend <= 2
        ? "BEARISH"
        : "NEUTRAL";

    return res.status(200).json({
      ticker,
      symbol,
      available: true,
      signal,
      bias_score: biasScore,
      account_long_pct: round(accountLongPct),
      account_short_pct: round(shortPctFromLongPct(accountLongPct)),
      top_position_long_pct: round(topLongPct),
      funding_rate_pct: round(fundingRatePct, 4),
      funding_bias_pct: round(fundingBiasPct),
      next_funding_time: Number.isFinite(Number(funding?.nextFundingTime)) ? Number(funding.nextFundingTime) : null,
      long_short_ratio: round(accountRatio, 3),
      account_trend_pct: accountTrend,
      rows: account.slice(-12).map((row) => ({
        t: Number(row.timestamp),
        long_pct: round(longPctFromAccountRow(row)),
        short_pct: round(shortPctFromLongPct(longPctFromAccountRow(row))),
        ratio: round(num(row.longShortRatio), 3),
      })),
      source: "binance_futures",
      feed_status: {
        account: account.length > 0,
        top_position: position.length > 0,
        funding: Boolean(funding),
      },
      reason: feedErrors.length ? `Partial Binance data: ${feedErrors.join("; ")}` : undefined,
      timestamp: Date.now(),
    });
  } catch (e) {
    return res.status(200).json({
      ticker,
      symbol,
      available: false,
      source: "binance_futures",
      reason: e.message,
      timestamp: Date.now(),
    });
  }
}

async function fetchBinanceData(label, path) {
  const res = await fetch(`https://fapi.binance.com${path}`, {
    headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} request failed (${res.status})${body ? `: ${body.slice(0, 140)}` : ""}`);
  }
  return res.json();
}

async function fetchBinanceArray(label, path) {
  const data = await fetchBinanceData(label, path);
  return Array.isArray(data) ? data : [];
}

async function fetchBinanceObject(label, path) {
  const data = await fetchBinanceData(label, path);
  return data && !Array.isArray(data) ? data : null;
}

function longPctFromAccountRow(row) {
  const longAccount = num(row?.longAccount);
  if (Number.isFinite(longAccount)) {
    return longAccount <= 1 ? longAccount * 100 : longAccount;
  }
  return pctFromRatio(num(row?.longShortRatio));
}

function fundingRatePctFromRow(row) {
  const rate = num(row?.lastFundingRate);
  return Number.isFinite(rate) ? rate * 100 : NaN;
}

function fundingBiasPctFromRate(ratePct) {
  if (!Number.isFinite(ratePct)) return NaN;
  return Math.max(0, Math.min(100, 50 + ratePct * 1000));
}

function pctFromRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return NaN;
  return (ratio / (1 + ratio)) * 100;
}

function shortPctFromLongPct(longPct) {
  return Number.isFinite(longPct) ? 100 - longPct : NaN;
}

function average(values) {
  if (!values.length) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function last(values) {
  return values[values.length - 1];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
