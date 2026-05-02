// pages/api/price.js
// Real price + OHLC candle data from DEXScreener — completely free, no key needed
import { getTokenMeta } from "../../lib/tokens";

const PRICE_CACHE_TTL_MS = 15000;
const priceResponseCache = new Map();

const BINANCE_SYMBOLS = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", DOGE: "DOGEUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", BNB: "BNBUSDT", DOT: "DOTUSDT",
  LTC: "LTCUSDT", TRX: "TRXUSDT", ICP: "ICPUSDT", XLM: "XLMUSDT",
  FIL: "FILUSDT", HBAR: "HBARUSDT", ALGO: "ALGOUSDT", BCH: "BCHUSDT",
  ETC: "ETCUSDT", XMR: "XMRUSDT", VET: "VETUSDT", EOS: "EOSUSDT",
  EGLD: "EGLDUSDT", KAVA: "KAVAUSDT", ZEC: "ZECUSDT", DASH: "DASHUSDT",
  NEO: "NEOUSDT", AVAX: "AVAXUSDT", SUI: "SUIUSDT", APT: "APTUSDT",
  NEAR: "NEARUSDT", ATOM: "ATOMUSDT", RUNE: "RUNEUSDT", SEI: "SEIUSDT",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = (req.query.ticker || "PEPE").toUpperCase();
  const tf = normalizeTimeframe(req.query.tf || "1d"); // 15m, 1h, 4h, 1d, 1w, 1m
  const cacheKey = `${ticker}:${tf}`;
  const cached = priceResponseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  const respondWithData = (data) => {
    priceResponseCache.set(cacheKey, { ts: Date.now(), data });
    return res.status(200).json(data);
  };

  const meta = getTokenMeta(ticker);
  const resolvedMeta = meta || await resolveCoinGeckoMeta(ticker);
  const shouldUseCoinGeckoOnly = resolvedMeta?.chain === "native";

  const { limit } = getCandleConfig(tf);

  try {
    const [cgQuote, cgIntradayChanges] = resolvedMeta?.coingeckoId
      ? await Promise.all([
          getCoinGeckoQuote(resolvedMeta.coingeckoId),
          getCoinGeckoIntradayChanges(resolvedMeta.coingeckoId),
        ])
      : [null, null];

    if (shouldUseCoinGeckoOnly && cgQuote) {
      let candles = await getBinanceCandles(ticker, tf);
      let candleSource = candles.length > 0 ? "binance_spot" : "coingecko";
      if (candles.length === 0) candles = await getCoinGeckoCandles(resolvedMeta.coingeckoId, tf);
      const fib_signal = await buildFibonacciSignal(ticker, cgQuote.usd, {
        coingeckoId: resolvedMeta.coingeckoId,
        currentTf: tf,
        currentCandles: candles,
      });
      return respondWithData(
        buildCoinGeckoResponse(ticker, resolvedMeta, cgQuote, candles, fib_signal, candleSource, cgIntradayChanges)
      );
    }

    // Step 1 — get pair address from token address
    let pairAddress, chainId, pairData;

    if (resolvedMeta?.address) {
      const r = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${resolvedMeta.address}`,
        { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      if (d.pairs?.length > 0) {
        const sorted = d.pairs.sort((a, b) =>
          parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
        );
        pairData = sorted[0];
        pairAddress = pairData.pairAddress;
        chainId = pairData.chainId;
      }
    }

    // fallback to search
    if (!pairData) {
      const r = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${ticker}`,
        { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      const pairs = d.pairs || [];
      const exact = pairs.filter(p => p.baseToken?.symbol?.toUpperCase() === ticker);
      const pool = exact.length > 0 ? exact : pairs;
      pairData = pool.sort((a, b) =>
        parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
      )[0];
      if (pairData) {
        pairAddress = pairData.pairAddress;
        chainId = pairData.chainId;
      }
    }

    if (!meta && cgQuote) {
      const candles = await getCoinGeckoCandles(resolvedMeta.coingeckoId, tf);
      const fib_signal = await buildFibonacciSignal(ticker, cgQuote.usd, { coingeckoId: resolvedMeta.coingeckoId });
      return respondWithData(
        buildCoinGeckoResponse(ticker, resolvedMeta, cgQuote, candles, fib_signal, "coingecko", cgIntradayChanges)
      );
    }

    if (!pairData) {
      if (cgQuote) {
        const candles = await getCoinGeckoCandles(resolvedMeta.coingeckoId, tf);
        const fib_signal = await buildFibonacciSignal(ticker, cgQuote.usd, { coingeckoId: resolvedMeta.coingeckoId });
        return respondWithData(
          buildCoinGeckoResponse(ticker, resolvedMeta, cgQuote, candles, fib_signal, "coingecko", cgIntradayChanges)
        );
      }
      return res.status(404).json({ ticker, error: "No live price source found", candles: [], timestamp: Date.now() });
    }

    const price = cgQuote?.usd || parseFloat(pairData.priceUsd || 0);
    const priceChange = {
      m5:  parseFloat(pairData.priceChange?.m5  || 0),
      h1:  parseFloat(pairData.priceChange?.h1  || 0),
      h6:  parseFloat(pairData.priceChange?.h6  || 0),
      h24: cgQuote?.usd_24h_change ?? parseFloat(pairData.priceChange?.h24 || 0),
    };

    // Step 2 — fetch real OHLC candles from GeckoTerminal.
    // DEXScreener is still used for live price/pair selection; GeckoTerminal
    // has a documented public OHLCV endpoint for pool candles.
    let candles = [];
    let candleSource = "geckoterminal";
    try {
      const gt = getGeckoTimeframe(tf);
      const network = getGeckoNetwork(chainId);
      candles = aggregateCandlesForTimeframe(
        await fetchGeckoCandles(network, pairAddress, gt, getSourceCandleLimit(tf, limit)),
        tf
      );
      if (candles.length === 0) {
        const geckoPool = await findGeckoPool(ticker, network, resolvedMeta?.address || pairData.baseToken?.address);
        if (geckoPool) {
          candles = aggregateCandlesForTimeframe(
            await fetchGeckoCandles(network, geckoPool, gt, getSourceCandleLimit(tf, limit)),
            tf
          );
        }
      }
    } catch (e) {
      console.log("[price] candle fetch failed:", e.message);
    }

    // If pool candles are unavailable, use CoinGecko chart data where possible.
    if (candles.length === 0) {
      const cgCandles = resolvedMeta?.coingeckoId ? await getCoinGeckoCandles(resolvedMeta.coingeckoId, tf) : [];
      if (cgCandles.length > 0) {
        candleSource = "coingecko";
        candles = cgCandles;
      } else {
        candleSource = "unavailable";
        candles = [];
      }
    }

    const technicals = calculateTechnicals(candles, pairData);
    const fib_signal = await buildFibonacciSignal(ticker, price, {
      coingeckoId: resolvedMeta?.coingeckoId,
      pairAddress,
      chainId,
      currentTf: tf,
      currentCandles: candles,
    });

    return respondWithData({
      ticker,
      name: pairData.baseToken?.name || ticker,
      price_usd: price,
      price_change: priceChange,
      volume_24h: parseFloat(pairData.volume?.h24 || 0),
      volume_1h:  parseFloat(pairData.volume?.h1  || 0),
      liquidity_usd: parseFloat(pairData.liquidity?.usd || 0),
      market_cap: cgQuote?.usd_market_cap || parseFloat(pairData.marketCap || 0),
      fdv: cgQuote?.usd_market_cap || parseFloat(pairData.fdv || 0),
      buys_24h:  pairData.txns?.h24?.buys  || 0,
      sells_24h: pairData.txns?.h24?.sells || 0,
      buys_1h:   pairData.txns?.h1?.buys   || 0,
      sells_1h:  pairData.txns?.h1?.sells  || 0,
      chain: chainId || resolvedMeta?.chain || "unknown",
      dex: pairData.dexId || "",
      pair_address: pairAddress || "",
      candles,
      candle_count: candles.length,
      candle_source: candleSource,
      technicals,
      fib_signal,
      timestamp: Date.now(),
    });

  } catch (e) {
    console.error("[price] error:", e.message);
    if (cached?.data) {
      return res.status(200).json(cached.data);
    }
    return res.status(502).json({ ticker, error: e.message, candles: [], timestamp: Date.now() });
  }
}

async function fetchGeckoCandles(network, poolAddress, gt, limit) {
  if (!network || !poolAddress) return [];
  const chartUrl = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress}/ohlcv/${gt.timeframe}?aggregate=${gt.aggregate}&limit=${limit}&currency=usd`;
  const chartRes = await fetch(chartUrl, {
    headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!chartRes.ok) return [];
  const chartData = await chartRes.json();
  const ohlcv = chartData?.data?.attributes?.ohlcv_list || [];
  return ohlcv
    .map(c => ({
      t: Number(c[0]) * 1000,
      o: parseFloat(c[1]),
      h: parseFloat(c[2]),
      l: parseFloat(c[3]),
      c: parseFloat(c[4]),
      v: parseFloat(c[5] || 0),
    }))
    .filter(c => Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t);
}

async function findGeckoPool(ticker, network, tokenAddress) {
  try {
    const searchUrl = `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(tokenAddress || ticker)}&network=${network}`;
    const searchRes = await fetch(searchUrl, {
      headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchRes.ok) return null;
    const data = await searchRes.json();
    const pools = data?.data || [];
    const tokenKey = tokenAddress ? `${network}_${tokenAddress}`.toLowerCase() : "";
    const exact = pools.filter(p => {
      const baseId = p.relationships?.base_token?.data?.id?.toLowerCase() || "";
      const quoteId = p.relationships?.quote_token?.data?.id?.toLowerCase() || "";
      const name = p.attributes?.name?.toUpperCase() || "";
      return (tokenKey && (baseId === tokenKey || quoteId === tokenKey)) || name.includes(ticker);
    });
    const pool = (exact.length ? exact : pools).sort((a, b) =>
      Number(b.attributes?.reserve_in_usd || 0) - Number(a.attributes?.reserve_in_usd || 0)
    )[0];
    return pool?.attributes?.address || null;
  } catch {
    return null;
  }
}

async function getCoinGeckoQuote(id) {
  try {
    const simpleUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;
    const simpleRes = await fetch(simpleUrl, {
      headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!simpleRes.ok) return null;
    const simple = await simpleRes.json();
    return simple[id] || null;
  } catch {
    return null;
  }
}

async function resolveCoinGeckoMeta(ticker) {
  try {
    const searchRes = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`,
      {
        headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!searchRes.ok) return null;
    const data = await searchRes.json();
    const normalized = ticker.toLowerCase();
    const coins = data?.coins || [];
    const exact = coins
      .filter((coin) => coin.symbol?.toLowerCase() === normalized)
      .sort((a, b) => Number(a.market_cap_rank || 999999) - Number(b.market_cap_rank || 999999))[0];
    if (!exact) return null;
    return {
      coingeckoId: exact.id,
      chain: "native",
      name: exact.name,
    };
  } catch {
    return null;
  }
}

function buildCoinGeckoResponse(ticker, meta, row, candles, fib_signal, candleSource = "coingecko", intraday = null) {
  return {
    ticker,
    name: meta?.name || ticker,
    price_usd: row.usd,
    price_change: {
      m5: intraday?.m5 ?? 0,
      h1: intraday?.h1 ?? 0,
      h6: intraday?.h6 ?? 0,
      h24: row.usd_24h_change || 0,
    },
    volume_24h: row.usd_24h_vol || 0,
    volume_1h: 0,
    liquidity_usd: 0,
    market_cap: row.usd_market_cap || 0,
    fdv: row.usd_market_cap || 0,
    buys_24h: 0,
    sells_24h: 0,
    buys_1h: 0,
    sells_1h: 0,
    chain: meta?.chain || "native",
    dex: "coingecko",
    pair_address: "",
    candles,
    candle_count: candles.length,
    candle_source: candles.length > 0 ? candleSource : "unavailable",
    technicals: calculateTechnicals(candles, null),
    fib_signal,
    timestamp: Date.now(),
  };
}

async function getCoinGeckoCandles(id, tf) {
  try {
    const { days } = getCandleConfig(tf);
    const chartUrl = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
    const chartRes = await fetch(chartUrl, {
      headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!chartRes.ok) return [];
    const chart = await chartRes.json();
    return buildCandlesFromCoinGecko(chart.prices || [], chart.total_volumes || [], tf);
  } catch {
    return [];
  }
}

async function getCoinGeckoIntradayChanges(id) {
  try {
    const chartUrl = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`;
    const chartRes = await fetch(chartUrl, {
      headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!chartRes.ok) return null;
    const chart = await chartRes.json();
    const prices = (chart?.prices || [])
      .map(([t, p]) => [Number(t), Number(p)])
      .filter(([t, p]) => Number.isFinite(t) && Number.isFinite(p))
      .sort((a, b) => a[0] - b[0]);
    if (prices.length < 2) return null;

    return {
      m5: pctChangeFromSeries(prices, 5 * 60 * 1000),
      h1: pctChangeFromSeries(prices, 60 * 60 * 1000),
      h6: pctChangeFromSeries(prices, 6 * 60 * 60 * 1000),
    };
  } catch {
    return null;
  }
}

function pctChangeFromSeries(prices, windowMs) {
  if (!prices || prices.length < 2) return null;
  const [latestTs, latestPrice] = prices[prices.length - 1];
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) return null;

  const targetTs = latestTs - windowMs;
  let referencePrice = null;
  for (let i = prices.length - 1; i >= 0; i--) {
    if (prices[i][0] <= targetTs) {
      referencePrice = prices[i][1];
      break;
    }
  }
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return null;

  return Math.round((((latestPrice - referencePrice) / referencePrice) * 100) * 100) / 100;
}

async function getBinanceCandles(ticker, tf) {
  const symbol = BINANCE_SYMBOLS[ticker];
  if (!symbol) return [];
  try {
    const { limit } = getCandleConfig(tf);
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${getBinanceInterval(tf)}&limit=${Math.min(limit, 1000)}`,
      {
        headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) return [];
    const rows = await r.json();
    if (!Array.isArray(rows)) return [];
    return rows
      .map(c => ({
        t: Number(c[0]),
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4]),
        v: parseFloat(c[5] || 0),
      }))
      .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

function buildCandlesFromCoinGecko(prices, volumes, tf) {
  const { limit, bucketMs } = getCandleConfig(tf);
  if (!prices.length) return [];
  const buckets = new Map();

  prices.forEach((point, index) => {
    const t = Number(point?.[0]);
    const price = Number(point?.[1]);
    if (!Number.isFinite(t) || !Number.isFinite(price)) return;
    const key = Math.floor(t / bucketMs) * bucketMs;
    const volume = Number(volumes[index]?.[1] || 0);
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { t: key, o: price, h: price, l: price, c: price, v: volume, samples: 1 });
      return;
    }
    bucket.h = Math.max(bucket.h, price);
    bucket.l = Math.min(bucket.l, price);
    bucket.c = price;
    bucket.v += volume;
    bucket.samples += 1;
  });

  const candles = [];

  [...buckets.values()]
    .sort((a, b) => a.t - b.t)
    .forEach((bucket) => candles.push({ ...bucket, v: bucket.v / Math.max(1, bucket.samples) }));

  return candles.slice(-limit);
}

function calculateTechnicals(candles, pairData) {
  const rsi = calculateRSI(candles.map(c => c.c));
  const obv = calculateOBV(candles);
  const txns = pairData?.txns?.h1 || {};
  const buys = Number(txns.buys || 0);
  const sells = Number(txns.sells || 0);
  const total = buys + sells;
  const buyRatio = total > 0 ? buys / total : 0.5;

  let obvSignal = "flat";
  if (obv.change_pct > 3) obvSignal = "rising";
  if (obv.change_pct < -3) obvSignal = "falling";

  return {
    rsi,
    obv,
    obv_signal: obvSignal,
    buy_ratio: Math.round(buyRatio * 1000) / 1000,
    technical_pass: rsi > 40 && rsi < 75 && obvSignal === "rising",
  };
}

function getGeckoTimeframe(tf) {
  if (tf === "15m") return { timeframe: "minute", aggregate: 15 };
  if (tf === "1h") return { timeframe: "hour", aggregate: 1 };
  if (tf === "4h") return { timeframe: "hour", aggregate: 4 };
  if (tf === "1w" || tf === "1m") return { timeframe: "day", aggregate: 1 };
  return { timeframe: "day", aggregate: 1 };
}

function getBinanceInterval(tf) {
  const map = { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w", "1m": "1M" };
  return map[tf] || "1d";
}

function getSourceCandleLimit(tf, displayLimit) {
  if (tf === "1w") return Math.min(1000, displayLimit * 7 + 14);
  if (tf === "1m") return Math.min(365, displayLimit * 30 + 30);
  return displayLimit;
}

function aggregateCandlesForTimeframe(candles, tf) {
  if (tf !== "1w" && tf !== "1m") return candles;
  const { limit, bucketMs } = getCandleConfig(tf);
  const buckets = new Map();

  candles.forEach((c) => {
    if (![c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)) return;
    const key = Math.floor(c.t / bucketMs) * bucketMs;
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { t: key, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 });
      return;
    }
    bucket.h = Math.max(bucket.h, c.h);
    bucket.l = Math.min(bucket.l, c.l);
    bucket.c = c.c;
    bucket.v += c.v || 0;
  });

  return [...buckets.values()].sort((a, b) => a.t - b.t).slice(-limit);
}

function getCandleConfig(tf) {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const map = {
    "15m": { limit: 192, days: 2, bucketMs: 15 * minute },
    "1h": { limit: 240, days: 14, bucketMs: hour },
    "4h": { limit: 240, days: 60, bucketMs: 4 * hour },
    "1d": { limit: 365, days: 365, bucketMs: day },
    "1w": { limit: 156, days: 1095, bucketMs: 7 * day },
    "1m": { limit: 120, days: "max", bucketMs: 30 * day },
  };
  return map[tf] || map["1d"];
}

function normalizeTimeframe(tf) {
  if (tf === "7d") return "1w";
  if (tf === "24h") return "1d";
  if (tf === "30d") return "1m";
  return tf;
}

function getGeckoNetwork(chainId) {
  const map = {
    ethereum: "eth",
    solana: "solana",
    bsc: "bsc",
    polygon: "polygon_pos",
    arbitrum: "arbitrum",
    optimism: "optimism",
    base: "base",
    avalanche: "avax",
  };
  return map[chainId] || chainId;
}

function calculateRSI(closes, period = 14) {
  const values = closes.filter(n => Number.isFinite(n));
  if (values.length <= period) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - (100 / (1 + rs))) * 10) / 10;
}

function calculateOBV(candles) {
  let value = 0;
  const series = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].c > candles[i - 1].c) value += candles[i].v || 0;
    else if (candles[i].c < candles[i - 1].c) value -= candles[i].v || 0;
    series.push(value);
  }
  const recent = series.slice(-6);
  const start = recent[0] || 0;
  const end = recent[recent.length - 1] || 0;
  const denom = Math.max(1, Math.abs(start));
  return {
    value: Math.round(end),
    change: Math.round(end - start),
    change_pct: Math.round(((end - start) / denom) * 1000) / 10,
  };
}

async function buildFibonacciSignal(ticker, currentPrice, opts = {}) {
  const timeframes = ["1h", "4h", "1d"];
  const candlesByTf = {};

  await Promise.all(timeframes.map(async (timeframe) => {
    if (opts.currentTf === timeframe && opts.currentCandles?.length) {
      candlesByTf[timeframe] = opts.currentCandles;
      return;
    }

    let candles = [];
    if (opts.pairAddress && opts.chainId) {
      try {
        const gt = getGeckoTimeframe(timeframe);
        candles = await fetchGeckoCandles(getGeckoNetwork(opts.chainId), opts.pairAddress, gt, getCandleConfig(timeframe).limit);
      } catch {}
    }

    if (candles.length === 0 && opts.coingeckoId) {
      candles = await getCoinGeckoCandles(opts.coingeckoId, timeframe);
    }

    candlesByTf[timeframe] = candles;
  }));

  return calculateFibonacciSignal(currentPrice, candlesByTf, ticker);
}

function calculateFibonacciSignal(currentPrice, candlesByTf, ticker = "") {
  const frames = Object.entries(candlesByTf)
    .map(([timeframe, candles]) => analyzeFibonacciFrame(timeframe, currentPrice, candles))
    .filter(Boolean);

  if (frames.length === 0) {
    return {
      signal: "NEUTRAL",
      confidence: 0,
      summary: "not enough candle data",
      frames: [],
    };
  }

  const score = frames.reduce((sum, frame) => sum + frame.score, 0);
  const signal = score >= 2 ? "BUY" : score <= -2 ? "SELL" : "NEUTRAL";
  const confidence = Math.min(95, Math.round((Math.abs(score) / (frames.length * 2)) * 100));
  const aligned = frames.filter((frame) => frame.signal === signal).length;

  return {
    ticker,
    signal,
    confidence,
    summary: signal === "NEUTRAL"
      ? "mixed Fibonacci levels across 1h, 4h, and 1d"
      : `${aligned}/${frames.length} timeframes align for ${signal}`,
    frames,
  };
}

function analyzeFibonacciFrame(timeframe, currentPrice, candles) {
  const usable = (candles || []).filter((c) =>
    Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c)
  );
  if (usable.length < 5 || !Number.isFinite(currentPrice)) return null;

  const high = Math.max(...usable.map((c) => c.h));
  const low = Math.min(...usable.map((c) => c.l));
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return null;

  const first = usable[0].c;
  const last = usable[usable.length - 1].c;
  const trend = last >= first ? "uptrend" : "downtrend";
  const pos = (currentPrice - low) / range;
  const levels = {
    "0.236": low + range * 0.236,
    "0.382": low + range * 0.382,
    "0.500": low + range * 0.5,
    "0.618": low + range * 0.618,
    "0.786": low + range * 0.786,
  };

  let signal = "NEUTRAL";
  let score = 0;
  let zone = "mid range";

  if (trend === "uptrend") {
    const buyLow = high - range * 0.618;
    const buyHigh = high - range * 0.382;
    const sellLine = high - range * 0.236;
    if (currentPrice >= buyLow && currentPrice <= buyHigh) {
      signal = "BUY";
      score = 1;
      zone = "golden retracement support";
    } else if (currentPrice > sellLine) {
      signal = "SELL";
      score = -1;
      zone = "near Fibonacci resistance";
    } else if (currentPrice < high - range * 0.786) {
      signal = "SELL";
      score = -1;
      zone = "lost deep retracement";
    }
  } else {
    const sellLow = low + range * 0.382;
    const sellHigh = low + range * 0.618;
    const buyLine = low + range * 0.236;
    if (currentPrice >= sellLow && currentPrice <= sellHigh) {
      signal = "SELL";
      score = -1;
      zone = "bearish retracement resistance";
    } else if (currentPrice < buyLine) {
      signal = "BUY";
      score = 1;
      zone = "near Fibonacci support";
    } else if (currentPrice > low + range * 0.786) {
      signal = "BUY";
      score = 1;
      zone = "reclaiming deep retracement";
    }
  }

  return {
    timeframe,
    signal,
    score,
    trend,
    zone,
    position: Math.round(pos * 1000) / 10,
    high,
    low,
    levels,
  };
}
