export const TOKEN_REGISTRY = {
  PEPE: { coingeckoId: "pepe", chain: "ethereum", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
  SHIB: { coingeckoId: "shiba-inu", chain: "ethereum", address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE" },
  WIF: { coingeckoId: "dogwifcoin", chain: "solana", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  BONK: { coingeckoId: "bonk", chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  TURBO: { coingeckoId: "turbo", chain: "ethereum", address: "0xA35923162C49cF95e6BF26623385eb431ad920D3" },
  FLOKI: { coingeckoId: "floki", chain: "ethereum", address: "0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E" },
  DOGE: { coingeckoId: "dogecoin", chain: "native" },
  SOL: { coingeckoId: "solana", chain: "solana", address: "So11111111111111111111111111111111111111112" },
  ETH: { coingeckoId: "ethereum", chain: "native" },
  BTC: { coingeckoId: "bitcoin", chain: "native" },
  ARB: { coingeckoId: "arbitrum", chain: "ethereum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
  LINK: { coingeckoId: "chainlink", chain: "ethereum", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
  INJ: { coingeckoId: "injective-protocol", chain: "ethereum", address: "0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30" },
  TIA: { coingeckoId: "celestia", chain: "native" },
  OP: { coingeckoId: "optimism", chain: "ethereum", address: "0x4200000000000000000000000000000000000042" },
  AVAX: { coingeckoId: "avalanche-2", chain: "native" },
  MATIC: { coingeckoId: "matic-network", chain: "ethereum", address: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0" },
  UNI: { coingeckoId: "uniswap", chain: "ethereum", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
  AAVE: { coingeckoId: "aave", chain: "ethereum", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9" },
  JUP: { coingeckoId: "jupiter-exchange-solana", chain: "solana", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  PYTH: { coingeckoId: "pyth-network", chain: "solana", address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKWUkL9Fxh3dD" },
  RENDER: { coingeckoId: "render-token", chain: "solana", address: "rndrizKT3QkHwwrKQnGgz5Z5rFfR3q6Kf4RMqMtn7Tq" },
  FET: { coingeckoId: "fetch-ai", chain: "ethereum", address: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85" },
  SUI: { coingeckoId: "sui", chain: "native" },
  APT: { coingeckoId: "aptos", chain: "native" },
  NEAR: { coingeckoId: "near", chain: "native" },
  ATOM: { coingeckoId: "cosmos", chain: "native" },
  RUNE: { coingeckoId: "thorchain", chain: "native" },
  SEI: { coingeckoId: "sei-network", chain: "native" },
  ENA: { coingeckoId: "ethena", chain: "ethereum", address: "0x57e114B691Db790C35207b2e685D4A43181e6061" },
  LDO: { coingeckoId: "lido-dao", chain: "ethereum", address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32" },
  PENDLE: { coingeckoId: "pendle", chain: "ethereum", address: "0x808507121B80c02388fAd14726482e061B8da827" },
  ONDO: { coingeckoId: "ondo-finance", chain: "ethereum", address: "0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3" },
  JTO: { coingeckoId: "jito-governance-token", chain: "solana", address: "JTOjtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
};

export const TRACKED_TICKERS = Object.keys(TOKEN_REGISTRY);

export function getTokenMeta(ticker) {
  return TOKEN_REGISTRY[ticker.toUpperCase()];
}
