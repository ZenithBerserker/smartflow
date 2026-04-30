// pages/api/zscores.js
// Returns current Z-scores for all tracked tickers (mock or from DB)

const TICKERS = [
  "PEPE","WIF","BONK","TURBO","FLOKI","DOGE","SHIB","SOL","ETH","ARB","LINK","INJ"
];

function getMockZscores() {
  const base = {
    PEPE: 1.8, WIF: 2.1, BONK: 1.4, TURBO: 3.1, FLOKI: 1.6,
    DOGE: 0.9, SHIB: 1.1, SOL: 2.3, ETH: 0.7, ARB: 1.9, LINK: 1.2, INJ: 2.6,
  };
  return TICKERS.map(t => ({
    ticker: t,
    zscore: Math.round((base[t] + (Math.random() * 0.3 - 0.15)) * 100) / 100,
    mentions_1h: Math.round(base[t] * 45 + Math.random() * 30),
    alert: base[t] > 2.0,
    chain: ["SOL","WIF","BONK","JUP"].includes(t) ? "solana" : "ethereum",
  }));
}

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const data = getMockZscores();
  res.status(200).json({ tickers: data, timestamp: Date.now() });
}
