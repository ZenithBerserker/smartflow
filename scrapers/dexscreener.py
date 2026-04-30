"""
DEXScreener API client — completely free, no API key needed
Fetches token data and top traders from public DEX data
"""
import requests
import time
from datetime import datetime
from lib.storage import Storage

BASE_URL = "https://api.dexscreener.com/latest/dex"
storage = Storage()


def search_token(ticker: str) -> dict | None:
    """
    Search for a token by ticker symbol.
    Returns the most liquid pair found.
    """
    try:
        url = f"{BASE_URL}/search?q={ticker}"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        pairs = data.get("pairs", [])
        
        if not pairs:
            return None
        
        # Sort by liquidity (USD), take the top pair
        pairs_with_liq = [p for p in pairs if p.get("liquidity", {}).get("usd", 0) > 10000]
        if not pairs_with_liq:
            return None
        
        top = sorted(pairs_with_liq, key=lambda p: p.get("liquidity", {}).get("usd", 0), reverse=True)[0]
        return top
    except Exception as e:
        print(f"[dexscreener] search error for {ticker}: {e}")
        return None


def get_token_metrics(contract_address: str, chain_id: str = None) -> dict | None:
    """
    Fetch detailed metrics for a specific token contract.
    """
    try:
        if chain_id:
            url = f"{BASE_URL}/tokens/{chain_id}/{contract_address}"
        else:
            url = f"{BASE_URL}/tokens/{contract_address}"
        
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        pairs = data.get("pairs", [])
        
        if not pairs:
            return None
        
        top = sorted(pairs, key=lambda p: p.get("volume", {}).get("h24", 0), reverse=True)[0]
        return top
    except Exception as e:
        print(f"[dexscreener] metrics error for {contract_address}: {e}")
        return None


def extract_technical_indicators(pair: dict) -> dict:
    """
    Derive pseudo-technical indicators from DEXScreener pair data.
    DEXScreener doesn't give RSI directly — we calculate proxies.
    """
    price_change = pair.get("priceChange", {})
    volume = pair.get("volume", {})
    txns = pair.get("txns", {})
    
    h1_change = price_change.get("h1", 0) or 0
    h6_change = price_change.get("h6", 0) or 0
    h24_change = price_change.get("h24", 0) or 0
    
    vol_h1 = volume.get("h1", 0) or 0
    vol_h6 = volume.get("h6", 0) or 0
    vol_h24 = volume.get("h24", 0) or 0
    
    buys_h1 = txns.get("h1", {}).get("buys", 0) or 0
    sells_h1 = txns.get("h1", {}).get("sells", 0) or 0
    
    # Proxy RSI: based on 24h price momentum (simplified)
    rsi_proxy = 50 + (h24_change * 0.8)
    rsi_proxy = max(10, min(90, rsi_proxy))
    
    # OBV proxy: if buys > sells in last hour, OBV is rising
    obv_rising = buys_h1 > sells_h1
    
    # MACD proxy: short-term vs longer-term momentum
    macd_positive = h1_change > 0 and h6_change > 0
    
    # ADX proxy: absolute momentum strength
    adx_proxy = min(abs(h24_change) * 2, 60)
    
    # Volume acceleration (is volume picking up?)
    vol_accel = (vol_h1 * 24) / vol_h24 if vol_h24 > 0 else 1.0
    
    return {
        "rsi": round(rsi_proxy, 1),
        "obv_rising": obv_rising,
        "macd_positive": macd_positive,
        "adx": round(adx_proxy, 1),
        "vol_acceleration": round(vol_accel, 2),
        "price_change_1h": h1_change,
        "price_change_24h": h24_change,
        "volume_24h": vol_h24,
        "liquidity_usd": pair.get("liquidity", {}).get("usd", 0),
        "market_cap": pair.get("marketCap", 0),
        "buys_1h": buys_h1,
        "sells_1h": sells_h1,
    }


def get_onchain_data(ticker: str) -> dict | None:
    """
    Full on-chain lookup for a ticker.
    Returns token info + technical indicators.
    """
    pair = search_token(ticker)
    if not pair:
        print(f"[dexscreener] no pair found for {ticker}")
        return None
    
    indicators = extract_technical_indicators(pair)
    
    result = {
        "ticker": ticker,
        "contract_address": pair.get("baseToken", {}).get("address", ""),
        "token_name": pair.get("baseToken", {}).get("name", ticker),
        "chain": pair.get("chainId", "unknown"),
        "dex": pair.get("dexId", "unknown"),
        "price_usd": pair.get("priceUsd", "0"),
        "pair_address": pair.get("pairAddress", ""),
        "url": pair.get("url", ""),
        "indicators": indicators,
        "timestamp": datetime.utcnow().isoformat(),
    }
    
    storage.save_onchain_data(ticker, result)
    time.sleep(0.5)  # Polite rate limiting
    return result


def get_top_wallets_dexscreener(pair_address: str, chain: str = "solana") -> list[dict]:
    """
    DEXScreener doesn't expose wallet-level data on the free API.
    For real wallet data without paying, we use the pair address 
    to construct a Solscan/Etherscan deep link and return mock 
    wallet structures that the AI can analyze.
    
    For real wallet PnL you need Birdeye (500 req/day free) or 
    to parse raw blockchain transactions — see docs.
    """
    # In production: swap this for real Birdeye top_traders call
    # GET https://public-api.birdeye.so/defi/v2/tokens/top_traders
    # Header: X-API-KEY (free tier at birdeye.so)
    
    print(f"[dexscreener] wallet data requires Birdeye API. returning mock structure.")
    return []


if __name__ == "__main__":
    import json
    data = get_onchain_data("PEPE")
    print(json.dumps(data, indent=2))
