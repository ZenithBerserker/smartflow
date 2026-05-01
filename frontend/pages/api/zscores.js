import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const TICKERS = ["PEPE","WIF","BONK","TURBO","FLOKI","DOGE","SHIB","SOL","ETH","ARB","LINK","INJ"]

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  
  try {
    const sevenDaysAgo = Math.floor(Date.now()/1000) - 7*86400
    const oneHourAgo = Math.floor(Date.now()/1000) - 3600

    // Get all mentions from last 7 days
    const { data } = await supabase
      .from('mentions')
      .select('ticker, count, timestamp')
      .gte('timestamp', sevenDaysAgo)

    if (!data || data.length === 0) {
      // No real data yet — return mock
      return res.status(200).json({ tickers: getMock(), timestamp: Date.now() })
    }

    // Compute Z-scores per ticker
    const results = TICKERS.map(ticker => {
      const history = data.filter(r => r.ticker === ticker)
      const recent = history.filter(r => r.timestamp > oneHourAgo)
      const currentCount = recent.reduce((s, r) => s + r.count, 0)
      
      if (history.length < 3) {
        return { ticker, zscore: 0, mentions_1h: currentCount, alert: false }
      }

      const counts = history.map(r => r.count)
      const mean = counts.reduce((a,b) => a+b, 0) / counts.length
      const std = Math.sqrt(counts.map(c => Math.pow(c-mean,2)).reduce((a,b)=>a+b,0) / counts.length)
      const zscore = std === 0 ? 0 : (currentCount - mean) / std

      return {
        ticker,
        zscore: Math.round(zscore * 100) / 100,
        mentions_1h: currentCount,
        alert: zscore > 2.0,
        chain: ["SOL","WIF","BONK","JUP"].includes(ticker) ? "solana" : "ethereum"
      }
    })

    res.status(200).json({ tickers: results, timestamp: Date.now() })
  } catch (e) {
    res.status(200).json({ tickers: getMock(), timestamp: Date.now(), error: e.message })
  }
}

function getMock() {
  const base = { PEPE:1.8, WIF:2.1, BONK:1.4, TURBO:3.1, FLOKI:1.6, DOGE:0.9, SHIB:1.1, SOL:2.3, ETH:0.7, ARB:1.9, LINK:1.2, INJ:2.6 }
  return Object.entries(base).map(([ticker, z]) => ({
    ticker, zscore: Math.round((z + Math.random()*0.3-0.15)*100)/100,
    mentions_1h: Math.round(z*45+Math.random()*30), alert: z > 2.0,
    chain: ["SOL","WIF","BONK"].includes(ticker) ? "solana" : "ethereum"
  }))
}