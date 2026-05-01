"""
Reddit scraper — free, no API key needed for read-only JSON.
Scrapes r/CryptoCurrency, r/solana, r/ethfinance, r/altcoin etc.
Run: python reddit_scraper.py
"""

import urllib.request
import json
import time
import re
import sqlite3
import os
from datetime import datetime
from collections import defaultdict

DB_PATH = os.path.join(os.path.dirname(__file__), "../data/mentions.db")
POLL_INTERVAL = 120  # seconds

SUBREDDITS = [
    "CryptoCurrency",
    "CryptoMoonShots",
    "solana",
    "ethfinance",
    "altcoin",
    "SatoshiStreetBets",
    "defi",
]

TRACKED_TICKERS = [
    "PEPE", "WIF", "BONK", "TURBO", "FLOKI", "DOGE", "SHIB",
    "SOL", "ETH", "BTC", "ARB", "OP", "AVAX", "LINK", "UNI",
    "AAVE", "INJ", "TIA", "JUP", "PYTH", "RENDER", "FET"
]

FALSE_POSITIVES = {
    "FOR", "THE", "ARE", "YOU", "ALL", "ONE", "NEW", "NOW",
    "GET", "HAS", "NOT", "BUT", "AND", "CAN", "USE", "ITS",
    "GOT", "BIG", "OLD", "TOP", "MAY", "PUT", "LET", "RUN",
    "BUY", "DID", "SET", "ACT", "ADD", "CUT", "OP"
}

# Track seen post IDs to avoid double-counting
seen_ids = set()


def fetch_subreddit_new(subreddit, limit=100):
    url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={limit}"
    headers = {
        "User-Agent": "SmartFlow-Bot/1.0 (crypto sentiment research)"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("data", {}).get("children", [])
    except Exception as e:
        print(f"[ERROR] r/{subreddit} fetch failed: {e}")
        return []


def extract_tickers(text):
    if not text:
        return []
    found = set()
    dollar_tickers = re.findall(r'\$([A-Z]{2,8})', text.upper())
    for t in dollar_tickers:
        if t in TRACKED_TICKERS and t not in FALSE_POSITIVES:
            found.add(t)
    for ticker in TRACKED_TICKERS:
        if re.search(r'\b' + ticker + r'\b', text.upper()):
            if ticker not in FALSE_POSITIVES:
                found.add(ticker)
    return list(found)


def scan_reddit():
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Scanning Reddit...")
    counts = defaultdict(int)
    new_posts = 0

    for sub in SUBREDDITS:
        posts = fetch_subreddit_new(sub)
        for post in posts:
            post_data = post.get("data", {})
            post_id = post_data.get("id", "")
            if post_id in seen_ids:
                continue
            seen_ids.add(post_id)
            new_posts += 1

            title = post_data.get("title", "")
            selftext = post_data.get("selftext", "")
            combined = title + " " + selftext
            for ticker in extract_tickers(combined):
                counts[ticker] += 1

        time.sleep(2)  # Reddit rate limit: 1 req/2s for unauthenticated

    print(f"[Reddit] {new_posts} new posts scanned across {len(SUBREDDITS)} subreddits.")
    for ticker, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {ticker}: {count}")
    return dict(counts)


def save_counts(counts):
    from supabase import create_client
    import os
    from dotenv import load_dotenv
    load_dotenv()
    
    client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    ts = int(time.time())
    rows = [
        {"ticker": ticker, "source": "reddit", "count": count, "timestamp": ts}
        for ticker, count in counts.items()
    ]
    if rows:
        client.table("mentions").insert(rows).execute()
        print(f"[Supabase] Saved {len(rows)} ticker counts")


def run():
    print("[Reddit Scraper] Starting. Press Ctrl+C to stop.")
    while True:
        try:
            counts = scan_reddit()
            if counts:
                save_counts(counts)
        except KeyboardInterrupt:
            print("\n[Reddit Scraper] Stopped.")
            break
        except Exception as e:
            print(f"[ERROR] {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
