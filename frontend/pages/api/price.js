// pages/api/price.js
// Fetches real price data from DEXScreener — completely free, no key needed
// Also generates OHLC candle data for charting

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const ticker = (req.query.ticker || "PEPE").toUpperCase();

  // Known contract addresses for instant lookup
  const CONTRACTS = {
    PEPE:  { chain: "ethereum", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
    WIF:   { chain: "solana",   address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
    BONK:  { chain: "solana",   address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
    TURBO: { chain: "ethereum", address: "0xA35923162C49cF95e6BF26623385eb431ad920D3" },
    FLOKI: { chain: "ethereum", address: "0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E" },
    DOGE:  { chain: "ethereum", address: "0" }, // use search
    SOL:   { chain: "solana",   address: "So11111111111111111111111111111111111111112" },
    SHIB:  { chain: "ethereum", address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE" },
    ARB:   { chain: "ethereum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
    LINK:  { chain: "ethereum", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
    INJ:   { chain: "ethereum", address: "0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30" },
    TIA:   { chain: "ethereum", address: "0" },
  };

  try {
    let pairData = null;
    const known = CONTRACTS[ticker];

    // Try known address first
    if (known && known.address !== "0") {
      const r = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${known.address}`,
        { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      if (d.pairs && d.pairs.length > 0) {
        // Pick highest liquidity pair
        pairData = d.pairs.sort((a, b) =>
          (parseFloat(b.liquidity?.usd || 0)) - (parseFloat(a.liquidity?.usd || 0))
        )[0];
      }
    }

    // Fall back to search
    if (!pairData) {
      const r = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${ticker}`,
        { headers: { "User-Agent": "BlackCat/1.0" }, signal: AbortSignal.timeout(8000) }
      );
      const d = await r.json();
      if (d.pairs && d.pairs.length > 0) {
        const exact = d.pairs.filter(p =>
          p.baseToken?.symbol?.toUpperCase() === ticker
        );
        const pool = exact.length > 0 ? exact : d.pairs;
        pairData = pool.sort((a, b) =>
          (parseFloat(b.liquidity?.usd || 0)) - (parseFloat(a.liquidity?.usd || 0))
        )[0];
      }
    }

    if (!pairData) {
      return res.status(200).json({ error: "Token not found", ticker, mock: true, ...getMockPrice(ticker) });
    }

    const price = parseFloat(pairData.priceUsd || 0);
    const priceChange = {
      m5:  parseFloat(pairData.priceChange?.m5  || 0),
      h1:  parseFloat(pairData.priceChange?.h1  || 0),
      h6:  parseFloat(pairData.priceChange?.h6  || 0),
      h24: parseFloat(pairData.priceChange?.h24 || 0),
    };

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
      chain: pairData.chainId || known?.chain || "unknown",
      dex: pairData.dexId || "",
      pair_address: pairData.pairAddress || "",
      candles: generateCandles(price, priceChange.h24),
      timestamp: Date.now(),
    });
  } catch (e) {
    // Return mock data on any error so UI never breaks
    return res.status(200).json({ ...getMockPrice(ticker), _error: e.message });
  }
}

function getMockPrice(ticker) {
  const prices = {
    PEPE:0.00001234, WIF:2.87, BONK:0.000028, TURBO:0.0084,
    FLOKI:0.000198, DOGE:0.142, SOL:148.3, ARB:0.94,
    LINK:13.4, INJ:22.1, SHIB:0.0000242, TIA:6.8,
  };
  const base = prices[ticker] || 0.001;
  return {
    ticker, name: ticker, price_usd: base,
    price_change: { m5: (Math.random()-0.4)*2, h1: (Math.random()-0.4)*5, h6: (Math.random()-0.4)*10, h24: (Math.random()-0.3)*20 },
    volume_24h: Math.random()*50e6+1e6,
    liquidity_usd: Math.random()*10e6+100000,
    market_cap: base * (Math.random()*1e11+1e9),
    buys_24h: Math.floor(Math.random()*5000+500),
    sells_24h: Math.floor(Math.random()*4000+400),
    candles: generateCandles(base, (Math.random()-0.3)*20),
    chain: ["SOL","WIF","BONK","TIA"].includes(ticker)?"solana":"ethereum",
    mock: true,
  };
}

function generateCandles(currentPrice, change24h) {
  // Generate 48 x 30min candles spanning 24h
  const candles = [];
  const startPrice = currentPrice / (1 + change24h / 100);
  let price = startPrice;
  const now = Date.now();

  for (let i = 47; i >= 0; i--) {
    const volatility = currentPrice * 0.015;
    const trend = (currentPrice - startPrice) / 48;
    const open = price;
    const close = price + trend + (Math.random() - 0.48) * volatility;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low  = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.random() * 500000 + 50000;

    candles.push({
      t: now - i * 30 * 60 * 1000,
      o: +open.toFixed(10),
      h: +high.toFixed(10),
      l: +Math.max(0, low).toFixed(10),
      c: +close.toFixed(10),
      v: Math.round(volume),
    });
    price = close;
  }
  return candles;
}
