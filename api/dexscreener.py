"""
DEXScreener API wrapper — completely free, no API key required.
Fetches token data, top traders, and on-chain metrics.
Docs: https://docs.dexscreener.com/api/reference
"""

import urllib.request
import json
import time
import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "../data/mentions.db")

DEXSCREENER_BASE = "https://api.dexscreener.com"

# Known contract addresses for common tokens (fallback if search fails)
# You can find these on dexscreener.com by searching the token
KNOWN_CONTRACTS = {
    "PEPE": {"chain": "ethereum", "address": "0x6982508145454Ce325dDbE47a25d4ec3d2311933"},
    "WIF":  {"chain": "solana",   "address": "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"},
    "BONK": {"chain": "solana",   "address": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"},
    "TURBO":{"chain": "ethereum", "address": "0xA35923162C49cF95e6BF26623385eb431ad920D3"},
    "FLOKI":{"chain": "ethereum", "address": "0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E"},
}


def fetch_json(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "SmartFlow/1.0", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[ERROR] fetch failed: {url}\n  {e}")
        return None


def search_token(ticker):
    """Search DEXScreener for a token by ticker symbol."""
    url = f"{DEXSCREENER_BASE}/latest/dex/search?q={ticker}"
    data = fetch_json(url)
    if not data or not data.get("pairs"):
        return None

    # Find the pair with highest liquidity — most likely the real token
    pairs = data["pairs"]
    # Filter for our ticker exactly
    exact = [p for p in pairs if p.get("baseToken", {}).get("symbol", "").upper() == ticker.upper()]
    if not exact:
        exact = pairs

    # Sort by liquidity USD descending
    exact.sort(key=lambda p: float(p.get("liquidity", {}).get("usd", 0) or 0), reverse=True)
    best = exact[0]

    return {
        "ticker": ticker,
        "name": best.get("baseToken", {}).get("name", ""),
        "chain": best.get("chainId", ""),
        "address": best.get("baseToken", {}).get("address", ""),
        "pair_address": best.get("pairAddress", ""),
        "price_usd": best.get("priceUsd", "0"),
        "price_change_24h": best.get("priceChange", {}).get("h24", 0),
        "volume_24h": best.get("volume", {}).get("h24", 0),
        "liquidity_usd": best.get("liquidity", {}).get("usd", 0),
        "market_cap": best.get("marketCap", 0),
        "txns_24h": (
            best.get("txns", {}).get("h24", {}).get("buys", 0) +
            best.get("txns", {}).get("h24", {}).get("sells", 0)
        ),
        "dex": best.get("dexId", ""),
    }


def get_token_metrics(ticker):
    """Get full metrics for a ticker."""
    # Try known contract first
    known = KNOWN_CONTRACTS.get(ticker.upper())
    if known:
        url = f"{DEXSCREENER_BASE}/latest/dex/tokens/{known['address']}"
        data = fetch_json(url)
        if data and data.get("pairs"):
            pair = data["pairs"][0]
            return {
                "ticker": ticker,
                "chain": known["chain"],
                "address": known["address"],
                "price_usd": pair.get("priceUsd", "0"),
                "price_change_1h": pair.get("priceChange", {}).get("h1", 0),
                "price_change_24h": pair.get("priceChange", {}).get("h24", 0),
                "volume_1h": pair.get("volume", {}).get("h1", 0),
                "volume_24h": pair.get("volume", {}).get("h24", 0),
                "liquidity_usd": pair.get("liquidity", {}).get("usd", 0),
                "txns_buys_1h": pair.get("txns", {}).get("h1", {}).get("buys", 0),
                "txns_sells_1h": pair.get("txns", {}).get("h1", {}).get("sells", 0),
                "market_cap": pair.get("marketCap", 0),
            }
    # Fall back to search
    return search_token(ticker)


def get_top_traders_dexscreener(ticker, chain=None):
    """
    DEXScreener doesn't have a direct top-traders endpoint in the free tier.
    We use the transactions endpoint to identify most active wallet addresses.
    For Solana tokens, we use the token transactions endpoint.
    Returns a list of wallet-like summaries derived from recent transactions.
    """
    known = KNOWN_CONTRACTS.get(ticker.upper())
    if not known and not chain:
        token_data = search_token(ticker)
        if not token_data:
            return []
        known = {"chain": token_data["chain"], "address": token_data["address"]}

    address = known["address"]
    chain_id = known["chain"]

    # DEXScreener token pairs endpoint — gives us pair addresses
    url = f"{DEXSCREENER_BASE}/latest/dex/tokens/{address}"
    data = fetch_json(url)
    if not data or not data.get("pairs"):
        return []

    pairs = data["pairs"]
    print(f"[DEX] Found {len(pairs)} trading pairs for {ticker}")

    # Return structured pair data — in production you'd augment this
    # with Solscan (Solana) or Etherscan (ETH) for actual wallet PnL
    result = []
    for pair in pairs[:5]:
        result.append({
            "pair_address": pair.get("pairAddress", ""),
            "dex": pair.get("dexId", ""),
            "volume_24h": pair.get("volume", {}).get("h24", 0),
            "liquidity": pair.get("liquidity", {}).get("usd", 0),
            "price_change_24h": pair.get("priceChange", {}).get("h24", 0),
            "buys_24h": pair.get("txns", {}).get("h24", {}).get("buys", 0),
            "sells_24h": pair.get("txns", {}).get("h24", {}).get("sells", 0),
        })
    return result


def get_solscan_top_holders(token_address):
    """
    Solscan public API — free, no key needed.
    Returns top holders for a Solana token.
    NOTE: Use respectfully, rate limit ~1 req/s
    """
    url = f"https://public-api.solscan.io/token/holders?tokenAddress={token_address}&offset=0&limit=20"
    req = urllib.request.Request(url, headers={
        "User-Agent": "SmartFlow/1.0",
        "Accept": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            holders = data.get("data", [])
            return [
                {
                    "address": h.get("address", ""),
                    "amount": h.get("amount", 0),
                    "decimals": h.get("decimals", 0),
                    "rank": h.get("rank", 0),
                }
                for h in holders
            ]
    except Exception as e:
        print(f"[Solscan] Error: {e}")
        return []


def get_etherscan_token_holders(token_address):
    """
    Etherscan free API (no key needed for basic calls, 5 req/s limit).
    Gets top holders for an ERC-20 token.
    """
    # Note: Full holder list requires API key on Etherscan
    # This gets token info which is free
    url = f"https://api.etherscan.io/api?module=token&action=tokeninfo&contractaddress={token_address}"
    data = fetch_json(url)
    if data and data.get("status") == "1":
        return data.get("result", [])
    return []


def compute_obv_signal(ticker):
    """
    Compute a simplified OBV signal from DEXScreener transaction data.
    Buys > Sells = positive OBV (accumulation)
    Sells > Buys = negative OBV (distribution)
    """
    metrics = get_token_metrics(ticker)
    if not metrics:
        return {"obv_signal": "unknown", "ratio": 0}

    buys = metrics.get("txns_buys_1h", 0)
    sells = metrics.get("txns_sells_1h", 0)
    total = buys + sells

    if total == 0:
        return {"obv_signal": "neutral", "ratio": 0.5}

    ratio = buys / total
    signal = "rising" if ratio > 0.55 else ("falling" if ratio < 0.45 else "neutral")

    return {
        "obv_signal": signal,
        "buy_ratio": round(ratio, 3),
        "buys_1h": buys,
        "sells_1h": sells,
        "price_change_1h": metrics.get("price_change_1h", 0),
    }


def get_full_token_report(ticker):
    """Get everything needed for Step 2 technical confluence check."""
    print(f"\n[DEX] Fetching full report for {ticker}...")
    metrics = get_token_metrics(ticker)
    obv = compute_obv_signal(ticker)

    if not metrics:
        return None

    price_change_1h = float(metrics.get("price_change_1h", 0) or 0)
    price_change_24h = float(metrics.get("price_change_24h", 0) or 0)
    volume_24h = float(metrics.get("volume_24h", 0) or 0)

    # Simplified RSI approximation from price changes (real RSI needs OHLC data)
    # For real RSI: use ccxt or a free OHLC source like CoinGecko
    rsi_approx = 50 + (price_change_24h * 0.5)
    rsi_approx = max(10, min(90, rsi_approx))

    # ADX approximation — high volume + price trend = strong trend
    adx_approx = min(60, abs(price_change_24h) * 2 + 15)

    report = {
        "ticker": ticker,
        "price_usd": metrics.get("price_usd", "0"),
        "price_change_1h": price_change_1h,
        "price_change_24h": price_change_24h,
        "volume_24h_usd": volume_24h,
        "liquidity_usd": metrics.get("liquidity_usd", 0),
        "market_cap": metrics.get("market_cap", 0),
        "obv_signal": obv["obv_signal"],
        "buy_ratio": obv.get("buy_ratio", 0.5),
        "rsi_approx": round(rsi_approx, 1),
        "adx_approx": round(adx_approx, 1),
        "technical_pass": (
            obv["obv_signal"] == "rising" and
            rsi_approx < 75 and
            rsi_approx > 40 and
            price_change_1h > 0
        ),
        "chain": metrics.get("chain", ""),
        "address": metrics.get("address", ""),
    }

    print(f"  Price: ${report['price_usd']} ({price_change_24h:+.1f}% 24h)")
    print(f"  Volume 24h: ${volume_24h:,.0f}")
    print(f"  OBV: {obv['obv_signal']} (buy ratio: {obv.get('buy_ratio', 0):.0%})")
    print(f"  RSI≈{rsi_approx:.0f} | ADX≈{adx_approx:.0f}")
    print(f"  Technical pass: {report['technical_pass']}")

    return report


if __name__ == "__main__":
    # Test with PEPE
    report = get_full_token_report("PEPE")
    if report:
        print("\nFull report:")
        print(json.dumps(report, indent=2))
