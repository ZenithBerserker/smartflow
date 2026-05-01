const SYMBOL_MAP = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  DOGE: "DOGEUSDT",
  LINK: "LINKUSDT",
  AVAX: "AVAXUSDT",
  ARB: "ARBUSDT",
  OP: "OPUSDT",
  MATIC: "MATICUSDT",
  UNI: "UNIUSDT",
  AAVE: "AAVEUSDT",
  INJ: "INJUSDT",
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
    const [account, position, taker] = await Promise.all([
      fetchBinance(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=24`),
      fetchBinance(`/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=1h&limit=24`),
      fetchBinance(`/futures/data/takerlongshortRatio?symbol=${symbol}&period=1h&limit=24`),
    ]);

    if (!account.length && !position.length && !taker.length) {
      return res.status(200).json({
        ticker,
        symbol,
        available: false,
        source: "binance_futures",
        reason: "No futures long/short data available for this ticker",
        timestamp: Date.now(),
      });
    }

    const latestAccount = last(account);
    const latestPosition = last(position);
    const latestTaker = last(taker);
    const accountRatio = num(latestAccount?.longShortRatio);
    const topPositionRatio = num(latestPosition?.longShortRatio);
    const takerRatio = num(latestTaker?.buySellRatio);
    const accountLongPct = pctFromRatio(accountRatio);
    const topLongPct = pctFromRatio(topPositionRatio);
    const takerBuyPct = pctFromRatio(takerRatio);
    const avgAccountLong = average(account.map((row) => pctFromRatio(num(row.longShortRatio))).filter(Number.isFinite));
    const biasScore = Math.round(average([accountLongPct, topLongPct, takerBuyPct].filter(Number.isFinite)));
    const accountTrend = Number.isFinite(avgAccountLong) ? Math.round((accountLongPct - avgAccountLong) * 10) / 10 : 0;
    const signal = biasScore >= 58 && accountTrend >= -2
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
      account_short_pct: round(100 - accountLongPct),
      top_position_long_pct: round(topLongPct),
      taker_buy_pct: round(takerBuyPct),
      long_short_ratio: round(accountRatio, 3),
      account_trend_pct: accountTrend,
      rows: account.slice(-12).map((row) => ({
        t: Number(row.timestamp),
        long_pct: round(pctFromRatio(num(row.longShortRatio))),
        short_pct: round(100 - pctFromRatio(num(row.longShortRatio))),
        ratio: round(num(row.longShortRatio), 3),
      })),
      source: "binance_futures",
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

async function fetchBinance(path) {
  const res = await fetch(`https://fapi.binance.com${path}`, {
    headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function pctFromRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return NaN;
  return (ratio / (1 + ratio)) * 100;
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
