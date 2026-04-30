"""
4chan /biz/ scraper — no API key required
Polls the board catalog every 2 minutes, extracts altcoin ticker mentions
"""
import requests
import json
import re
import time
from datetime import datetime
from unidecode import unidecode
from lib.storage import Storage

BOARD = "biz"
CATALOG_URL = f"https://a.4cdn.org/{BOARD}/catalog.json"
THREAD_URL = f"https://a.4cdn.org/{BOARD}/thread/{{thread_id}}.json"

# Common crypto tickers to track — add/remove as needed
TRACKED_TICKERS = [
    "SOL", "ETH", "BTC", "PEPE", "WIF", "BONK", "FLOKI", "DOGE",
    "SHIB", "ARB", "OP", "MATIC", "AVAX", "LINK", "UNI", "AAVE",
    "TURBO", "MEME", "WOJAK", "ANDY", "MOG", "BRETT", "TOSHI",
]

# Words to exclude (avoid false positives on common English words)
EXCLUDED_WORDS = {"IT", "ON", "OR", "AT", "BE", "DO", "IF", "IN", "IS", "NO",
                  "OF", "SO", "TO", "UP", "US", "WE", "GO", "BY", "AS"}

storage = Storage()


def extract_tickers(text: str) -> list[str]:
    """Extract crypto ticker mentions from raw text."""
    if not text:
        return []
    text = unidecode(text).upper()
    found = []

    # Match $TICKER format
    dollar_tickers = re.findall(r'\$([A-Z]{2,8})', text)
    found.extend(dollar_tickers)

    # Match tracked tickers mentioned without $ sign
    for ticker in TRACKED_TICKERS:
        pattern = rf'\b{ticker}\b'
        if re.search(pattern, text):
            if ticker not in found:
                found.append(ticker)

    # Filter exclusions
    return [t for t in found if t not in EXCLUDED_WORDS]


def fetch_catalog() -> list[dict]:
    """Fetch the /biz/ board catalog."""
    try:
        resp = requests.get(CATALOG_URL, timeout=10)
        resp.raise_for_status()
        pages = resp.json()
        threads = []
        for page in pages:
            threads.extend(page.get("threads", []))
        return threads
    except Exception as e:
        print(f"[4chan] catalog fetch error: {e}")
        return []


def fetch_thread(thread_id: int) -> list[dict]:
    """Fetch all posts in a thread."""
    try:
        url = THREAD_URL.format(thread_id=thread_id)
        resp = requests.get(url, timeout=10)
        if resp.status_code == 404:
            return []  # Thread deleted
        resp.raise_for_status()
        posts = resp.json().get("posts", [])
        return posts
    except Exception as e:
        print(f"[4chan] thread {thread_id} fetch error: {e}")
        return []


def scrape_board() -> dict:
    """
    Full board scrape. Returns mention counts per ticker for this interval.
    """
    print(f"[4chan] scraping /biz/ at {datetime.now().strftime('%H:%M:%S')}")
    threads = fetch_catalog()
    
    ticker_counts = {}
    posts_scanned = 0

    for thread in threads[:50]:  # Top 50 threads (most active)
        thread_id = thread.get("no")
        if not thread_id:
            continue

        # Check OP post first (in catalog)
        op_text = thread.get("com", "") + " " + thread.get("sub", "")
        op_tickers = extract_tickers(op_text)
        
        # Only fetch full thread if OP mentions crypto
        if op_tickers or any(t in op_text.upper() for t in TRACKED_TICKERS):
            posts = fetch_thread(thread_id)
            posts_scanned += len(posts)
            
            for post in posts:
                text = post.get("com", "")
                tickers = extract_tickers(text)
                for t in tickers:
                    ticker_counts[t] = ticker_counts.get(t, 0) + 1

        time.sleep(0.5)  # Be polite to 4chan's servers

    print(f"[4chan] scanned {posts_scanned} posts. found: {ticker_counts}")
    
    # Save to storage
    snapshot = {
        "source": "4chan_biz",
        "timestamp": datetime.utcnow().isoformat(),
        "posts_scanned": posts_scanned,
        "ticker_counts": ticker_counts,
    }
    storage.append_mention_snapshot(snapshot)
    return ticker_counts


if __name__ == "__main__":
    # Run once
    counts = scrape_board()
    print(json.dumps(counts, indent=2))
