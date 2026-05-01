export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const boostedRes = await fetch("https://api.dexscreener.com/token-boosts/latest/v1", {
      headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
      signal: AbortSignal.timeout(10000),
    });

    if (!boostedRes.ok) {
      return res.status(200).json({ tokens: [], source: "unavailable", reason: `DEXScreener error: ${boostedRes.status}` });
    }

    const boosted = await boostedRes.json();
    const items = (Array.isArray(boosted) ? boosted : []).slice(0, 16);
    const tokens = [];

    await Promise.all(items.map(async (item) => {
      const tokenAddress = item.tokenAddress;
      const chainId = item.chainId;
      if (!tokenAddress || !chainId) return;

      try {
        const pairRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
          headers: { "Accept": "application/json", "User-Agent": "BlackCat/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (!pairRes.ok) return;
        const pairData = await pairRes.json();
        const pair = (pairData.pairs || [])
          .filter((p) => p.chainId === chainId)
          .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];
        if (!pair) return;

        tokens.push({
          name: pair.baseToken?.symbol || item.description || tokenAddress.slice(0, 6),
          chain: chainId.toUpperCase(),
          age: formatAge(pair.pairCreatedAt),
          liquidity: Number(pair.liquidity?.usd || 0),
          volume_1h: Number(pair.volume?.h1 || 0),
          mentions_1h: null,
          zscore: null,
          price_change_1h: Number(pair.priceChange?.h1 || 0),
        });
      } catch {}
    }));

    tokens.sort((a, b) => Math.abs(b.price_change_1h) - Math.abs(a.price_change_1h));
    return res.status(200).json({ tokens: tokens.slice(0, 8), source: "dexscreener", timestamp: Date.now() });
  } catch (e) {
    return res.status(200).json({ tokens: [], source: "unavailable", reason: e.message, timestamp: Date.now() });
  }
}

function formatAge(pairCreatedAt) {
  if (!pairCreatedAt) return "--";
  const ageMs = Date.now() - Number(pairCreatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return "--";
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
