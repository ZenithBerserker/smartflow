"""
4chan /biz/ scraper — no API key required.
Polls the board every 60s, extracts ticker mentions, computes Z-scores.
Run: python fourchan_scraper.py
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
POLL_INTERVAL = 60  # seconds between board scans
BOARD = "biz"

# Tickers to track — add/remove as needed
TRACKED_TICKERS = [
    "PEPE", "WIF", "BONK", "TURBO", "FLOKI", "DOGE", "SHIB",
    "SOL", "ETH", "BTC", "ARB", "OP", "AVAX", "LINK", "UNI",
    "AAVE", "INJ", "TIA", "JUP", "PYTH", "RENDER", "FET"
]

# Words that look like tickers but aren't crypto — filter these out
FALSE_POSITIVES = {
    "FOR", "THE", "ARE", "YOU", "ALL", "ONE", "NEW", "NOW",
    "GET", "HAS", "NOT", "BUT", "AND", "CAN", "USE", "ITS",
    "GOT", "BIG", "OLD", "TOP", "MAY", "PUT", "LET", "RUN",
    "BUY", "DID", "SET", "ACT", "ADD", "CUT"
}


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS mentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            source TEXT NOT NULL,
            count INTEGER NOT NULL,
            timestamp INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()
    print("[DB] Initialized mentions database.")


def fetch_catalog():
    url = f"https://a.4cdn.org/{BOARD}/catalog.json"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[ERROR] catalog fetch failed: {e}")
        return []


def fetch_thread(thread_no):
    url = f"https://a.4cdn.org/{BOARD}/thread/{thread_no}.json"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[ERROR] thread {thread_no} fetch failed: {e}")
        return None


def extract_tickers_from_text(text):
    """Find $TICKER patterns and bare uppercase words matching our list."""
    if not text:
        return []
    found = []
    # Match $TICKER patterns
    dollar_tickers = re.findall(r'\$([A-Z]{2,8})', text.upper())
    for t in dollar_tickers:
        if t in TRACKED_TICKERS and t not in FALSE_POSITIVES:
            found.append(t)
    # Match bare ticker mentions (whole word only)
    for ticker in TRACKED_TICKERS:
        if re.search(r'\b' + ticker + r'\b', text.upper()):
            if ticker not in FALSE_POSITIVES:
                found.append(ticker)
    return list(set(found))


def clean_html(text):
    """Strip 4chan HTML tags from post text."""
    if not text:
        return ""
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&#[0-9]+;', '', text)
    return text


def scan_board():
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Scanning /biz/ catalog...")
    catalog = fetch_catalog()
    if not catalog:
        return {}

    counts = defaultdict(int)
    thread_count = 0

    for page in catalog:
        for thread in page.get("threads", []):
            thread_no = thread.get("no")
            subject = clean_html(thread.get("sub", ""))
            comment = clean_html(thread.get("com", ""))
            combined = subject + " " + comment

            tickers = extract_tickers_from_text(combined)
            for t in tickers:
                counts[t] += 1

            # Only fetch full thread if it mentions tracked tickers
            if tickers and thread.get("replies", 0) > 5:
                full = fetch_thread(thread_no)
                if full:
                    for post in full.get("posts", [])[1:]:  # skip OP (already counted)
                        post_text = clean_html(post.get("com", ""))
                        for t in extract_tickers_from_text(post_text):
                            counts[t] += 1
                thread_count += 1
                time.sleep(0.5)  # be polite to 4chan servers

    print(f"[4chan] Scanned {thread_count} relevant threads.")
    for ticker, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {ticker}: {count} mentions")

    return dict(counts)


def save_counts(counts):
    from supabase import create_client
    import os
    from dotenv import load_dotenv
    load_dotenv()
    
    client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    ts = int(time.time())
    rows = [
        {"ticker": ticker, "source": "4chan", "count": count, "timestamp": ts}
        for ticker, count in counts.items()
    ]
    if rows:
        client.table("mentions").insert(rows).execute()
        print(f"[Supabase] Saved {len(rows)} ticker counts")


def compute_zscore(ticker, current_count):
    """Compute Z-score vs 7-day rolling history."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    seven_days_ago = int(time.time()) - 7 * 86400
    c.execute(
        "SELECT count FROM mentions WHERE ticker=? AND source='4chan' AND timestamp>?",
        (ticker, seven_days_ago)
    )
    rows = [r[0] for r in c.fetchall()]
    conn.close()

    if len(rows) < 3:
        return 0.0  # not enough history

    import statistics
    mean = statistics.mean(rows)
    std = statistics.stdev(rows) if len(rows) > 1 else 1
    if std == 0:
        return 0.0
    return round((current_count - mean) / std, 2)


def get_current_zscores():
    """Return Z-scores for all tickers based on latest scan."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    one_hour_ago = int(time.time()) - 3600
    c.execute(
        "SELECT ticker, SUM(count) FROM mentions WHERE source='4chan' AND timestamp>? GROUP BY ticker",
        (one_hour_ago,)
    )
    recent = dict(c.fetchall())
    conn.close()
    results = {}
    for ticker, count in recent.items():
        results[ticker] = {
            "ticker": ticker,
            "mentions_1h": count,
            "zscore": compute_zscore(ticker, count)
        }
    return results


def run():
    init_db()
    print("[4chan Scraper] Starting. Press Ctrl+C to stop.")
    while True:
        try:
            counts = scan_board()
            if counts:
                save_counts(counts)
                zscores = get_current_zscores()
                alerts = {k: v for k, v in zscores.items() if v["zscore"] > 2.0}
                if alerts:
                    print(f"\n[ALERT] Z-score > 2.0 detected:")
                    for t, v in alerts.items():
                        print(f"  {t}: Z={v['zscore']} ({v['mentions_1h']} mentions/hr)")
        except KeyboardInterrupt:
            print("\n[4chan Scraper] Stopped.")
            break
        except Exception as e:
            print(f"[ERROR] {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
