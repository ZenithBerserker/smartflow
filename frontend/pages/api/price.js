// pages/api/price.js
// Real price + OHLC candle data from DEXScreener — completely free, no key needed

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = (req.query.ticker || "PEPE").toUpperCase();
  const tf = req.query.tf || "24h"; // 1h, 4h, 24h

  const COINGECKO_IDS = {
    PEPE: "pepe",
    WIF: "dogwifcoin",
    BONK: "bonk",
    TURBO: "turbo",
    FLOKI: "floki",
    DOGE: "dogecoin",
    SOL: "solana",
    ARB: "arbitrum",
    LINK: "chainlink",
    INJ: "injective-protocol",
    SHIB: "shiba-inu",
    TIA: "celestia",
  };

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
    DOGE:  { chain: null, address: "0" },
    TIA:   { chain: null, address: "0" },
  };

  // Timeframe → DEXScreener resolution mapping
  const tfMap = { "1h": { res: "5m", limit: 12 }, "4h": { res: "15m", limit: 16 }, "24h": { res: "30m", limit: 48 } };
  const { limit } = tfMap[tf] || tfMap["24h"];

  try {
    if (["DOGE", "TIA"].includes(ticker) && COINGECKO_IDS[ticker]) {
      const cg = await getCoinGeckoPrice(ticker, COINGECKO_IDS[ticker], tf);
      if (cg) return res.status(200).json(cg);
    }

    // Step 1 — get pair address from token address
    let pairAddress, chainId, pairData;
    const known = CONTRACTS[ticker];

    if (known && known.address !== "0") {
      const r = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${known.address}`,
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

    if (!pairData) {
      const mock = getMockData(ticker);
      const candles = getMockCandles(mock.price_usd, mock.price_change.h24);
      return res.status(200).json({ ...mock, candles, technicals: calculateTechnicals(candles, null) });
    }

    const price = parseFloat(pairData.priceUsd || 0);
    const priceChange = {
      m5:  parseFloat(pairData.priceChange?.m5  || 0),
      h1:  parseFloat(pairData.priceChange?.h1  || 0),
      h6:  parseFloat(pairData.priceChange?.h6  || 0),
      h24: parseFloat(pairData.priceChange?.h24 || 0),
    };

    // Step 2 — fetch real OHLC candles from GeckoTerminal.
    // DEXScreener is still used for live price/pair selection; GeckoTerminal
    // has a documented public OHLCV endpoint for pool candles.
    let candles = [];
    let candleSource = "geckoterminal";
    try {
      const gt = getGeckoTimeframe(tf);
      const network = getGeckoNetwork(chainId);
      candles = await fetchGeckoCandles(network, pairAddress, gt, limit);
      if (candles.length === 0) {
        const geckoPool = await findGeckoPool(ticker, network, known?.address || pairData.baseToken?.address);
        if (geckoPool) candles = await fetchGeckoCandles(network, geckoPool, gt, limit);
      }
    } catch (e) {
      console.log("[price] candle fetch failed:", e.message);
    }

    // If candle fetch failed, generate realistic candles from price change data
    if (candles.length === 0) {
      const cgCandles = COINGECKO_IDS[ticker] ? await getCoinGeckoCandles(COINGECKO_IDS[ticker], tf) : [];
      if (cgCandles.length > 0) {
        candleSource = "coingecko";
        candles = cgCandles;
      } else {
        candleSource = "generated";
        candles = getMockCandles(price, priceChange.h24);
      }
    }

    const technicals = calculateTechnicals(candles, pairData);

    return res.status(200).json({
      ticker,
      name: pairData.baseToken?.name || ticker,
      price_usd: price,
      price_change: priceChange,
      volume_24h: parseFloat(pairData.volume?.h24 || 0),
      volume_1h:  parseFloat(pairData.volume?.h1  || 0),
      liquidity_usd: parseFloat(pairData.liquidity?.usd || 0),
      market_cap: parseFloat(pairData.marketCap || 0),
      fdv: parseFloat(pairData.fdv || 0),
      buys_24h:  pairData.txns?.h24?.buys  || 0,
      sells_24h: pairData.txns?.h24?.sells || 0,
      buys_1h:   pairData.txns?.h1?.buys   || 0,
      sells_1h:  pairData.txns?.h1?.sells  || 0,
      chain: chainId || known?.chain || "unknown",
      dex: pairData.dexId || "",
      pair_address: pairAddress || "",
      candles,
      candle_count: candles.length,
      candle_source: candleSource,
      technicals,
      timestamp: Date.now(),
    });

  } catch (e) {
    console.error("[price] error:", e.message);
    const mock = getMockData(ticker);
    const candles = getMockCandles(mock.price_usd, mock.price_change.h24);
    return res.status(200).json({ ...mock, candles, technicals: calculateTechnicals(candles, null) });
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

async function getCoinGeckoPrice(ticker, id, tf) {
  try {
    const simpleUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;
    const simpleRes = await fetch(simpleUrl, {
      headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!simpleRes.ok) return null;
    const simple = await simpleRes.json();
    const row = simple[id];
    if (!row?.usd) return null;

    let candles = await getCoinGeckoCandles(id, tf);
    if (candles.length === 0) candles = getMockCandles(row.usd, row.usd_24h_change || 0);

    return {
      ticker,
      name: ticker,
      price_usd: row.usd,
      price_change: { m5: 0, h1: 0, h6: 0, h24: row.usd_24h_change || 0 },
      volume_24h: row.usd_24h_vol || 0,
      volume_1h: 0,
      liquidity_usd: 0,
      market_cap: row.usd_market_cap || 0,
      fdv: row.usd_market_cap || 0,
      buys_24h: 0,
      sells_24h: 0,
      buys_1h: 0,
      sells_1h: 0,
      chain: "native",
      dex: "coingecko",
      pair_address: "",
      candles,
      candle_count: candles.length,
      candle_source: "coingecko",
      technicals: calculateTechnicals(candles, null),
      timestamp: Date.now(),
    };
  } catch (e) {
    console.log("[price] coingecko fetch failed:", e.message);
    return null;
  }
}

async function getCoinGeckoCandles(id, tf) {
  const chartUrl = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`;
  const chartRes = await fetch(chartUrl, {
    headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!chartRes.ok) return [];
  const chart = await chartRes.json();
  return buildCandlesFromCoinGecko(chart.prices || [], chart.total_volumes || [], tf);
}

function buildCandlesFromCoinGecko(prices, volumes, tf) {
  const target = tf === "1h" ? 12 : tf === "4h" ? 16 : 48;
  if (!prices.length) return [];
  const recent = prices.slice(-Math.max(target * 2, target));
  const step = Math.max(1, Math.floor(recent.length / target));
  const candles = [];

  for (let i = 0; i < recent.length; i += step) {
    const chunk = recent.slice(i, i + step);
    if (!chunk.length) continue;
    const closeValues = chunk.map(p => Number(p[1])).filter(Number.isFinite);
    if (!closeValues.length) continue;
    const volChunk = volumes.slice(Math.max(0, prices.length - recent.length + i), Math.max(0, prices.length - recent.length + i + step));
    candles.push({
      t: Number(chunk[chunk.length - 1][0]),
      o: closeValues[0],
      h: Math.max(...closeValues),
      l: Math.min(...closeValues),
      c: closeValues[closeValues.length - 1],
      v: volChunk.reduce((sum, v) => sum + Number(v?.[1] || 0), 0) / Math.max(1, volChunk.length),
    });
  }

  return candles.slice(-target);
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
  if (tf === "1h") return { timeframe: "minute", aggregate: 5 };
  if (tf === "4h") return { timeframe: "minute", aggregate: 15 };
  return { timeframe: "hour", aggregate: 1 };
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

function getMockData(ticker) {
  const prices = {
    PEPE:0.00001234, WIF:2.87, BONK:0.000028, TURBO:0.0084,
    FLOKI:0.000198, DOGE:0.142, SOL:148.3, ARB:0.94,
    LINK:13.4, INJ:22.1, SHIB:0.0000242, TIA:6.8,
  };
  const p = prices[ticker] || 0.001;
  return {
    ticker, name: ticker, price_usd: p,
    price_change: { m5:0.1, h1:0.5, h6:1.2, h24: (Math.random()-0.3)*20 },
    volume_24h: Math.random()*50e6+1e6,
    liquidity_usd: Math.random()*10e6+100000,
    market_cap: p*(Math.random()*1e11+1e9),
    buys_24h: Math.floor(Math.random()*5000+500),
    sells_24h: Math.floor(Math.random()*4000+400),
    chain: ["SOL","WIF","BONK","TIA"].includes(ticker)?"solana":"ethereum",
    mock: true,
  };
}

function getMockCandles(currentPrice, change24h = 0) {
  const candles = [];
  const startPrice = currentPrice / (1 + change24h / 100);
  let price = startPrice;
  const now = Date.now();
  const count = 48;

  for (let i = count - 1; i >= 0; i--) {
    const vol = currentPrice * 0.018;
    const trend = (currentPrice - startPrice) / count;
    const open = price;
    const close = price + trend + (Math.random() - 0.47) * vol;
    const high = Math.max(open, close) + Math.random() * vol * 0.4;
    const low  = Math.min(open, close) - Math.random() * vol * 0.4;
    candles.push({
      t: now - i * 30 * 60 * 1000,
      o: +Math.max(0, open).toPrecision(6),
      h: +Math.max(0, high).toPrecision(6),
      l: +Math.max(0, low).toPrecision(6),
      c: +Math.max(0, close).toPrecision(6),
      v: Math.round(Math.random() * 500000 + 50000),
    });
    price = close;
  }
  return candles;
}
