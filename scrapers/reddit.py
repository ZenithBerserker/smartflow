"""
Reddit scraper — free tier, no payment needed
Monitors crypto subreddits for ticker mentions
"""
import praw
import re
import os
import time
from datetime import datetime
from dotenv import load_dotenv
from lib.storage import Storage

load_dotenv()

SUBREDDITS = [
    "CryptoCurrency", "CryptoMoonShots", "SatoshiStreetBets",
    "solana", "ethereum", "altcoin", "defi", "memecoins"
]

TRACKED_TICKERS = [
    "SOL", "ETH", "BTC", "PEPE", "WIF", "BONK", "FLOKI", "DOGE",
    "SHIB", "ARB", "OP", "MATIC", "AVAX", "LINK", "UNI", "AAVE",
    "TURBO", "MEME", "WOJAK", "ANDY", "MOG", "BRETT", "TOSHI",
]

EXCLUDED_WORDS = {"IT", "ON", "OR", "AT", "BE", "DO", "IF", "IN", "IS", "NO",
                  "OF", "SO", "TO", "UP", "US", "WE", "GO", "BY", "AS", "ALL",
                  "NEW", "OLD", "BIG", "TOP", "HOT"}

storage = Storage()


def get_reddit_client():
    """Initialize Reddit client. Falls back to public read-only if no keys."""
    client_id = os.getenv("REDDIT_CLIENT_ID")
    client_secret = os.getenv("REDDIT_CLIENT_SECRET")
    
    if client_id and client_secret:
        return praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent="smartflow_scraper/1.0"
        )
    else:
        # Read-only mode — no account needed but lower rate limits
        print("[reddit] no credentials found — using read-only mode")
        return praw.Reddit(
            client_id="public",
            client_secret="public",
            user_agent="smartflow_scraper/1.0"
        )


def extract_tickers(text: str) -> list[str]:
    """Extract ticker mentions from text."""
    if not text:
        return []
    text_upper = text.upper()
    found = []
    
    # $TICKER format
    dollar_tickers = re.findall(r'\$([A-Z]{2,8})', text_upper)
    found.extend([t for t in dollar_tickers if t not in EXCLUDED_WORDS])
    
    # Tracked tickers as standalone words
    for ticker in TRACKED_TICKERS:
        if re.search(rf'\b{ticker}\b', text_upper):
            if ticker not in found:
                found.append(ticker)
    
    return found


def scrape_subreddit(reddit, subreddit_name: str, limit: int = 100) -> dict:
    """Scrape hot posts and comments from a subreddit."""
    ticker_counts = {}
    
    try:
        sub = reddit.subreddit(subreddit_name)
        posts = list(sub.hot(limit=limit))
        
        for post in posts:
            # Title + selftext
            text = f"{post.title} {post.selftext}"
            for t in extract_tickers(text):
                ticker_counts[t] = ticker_counts.get(t, 0) + 1
            
            # Top-level comments (limit to avoid rate limits)
            try:
                post.comments.replace_more(limit=0)
                for comment in list(post.comments)[:20]:
                    for t in extract_tickers(comment.body):
                        ticker_counts[t] = ticker_counts.get(t, 0) + 1
            except Exception:
                pass
        
        print(f"[reddit] r/{subreddit_name}: {len(posts)} posts → {ticker_counts}")
    except Exception as e:
        print(f"[reddit] r/{subreddit_name} error: {e}")
    
    return ticker_counts


def scrape_all() -> dict:
    """Scrape all configured subreddits."""
    print(f"[reddit] starting scrape at {datetime.now().strftime('%H:%M:%S')}")
    reddit = get_reddit_client()
    combined = {}
    
    for sub_name in SUBREDDITS:
        counts = scrape_subreddit(reddit, sub_name, limit=50)
        for ticker, count in counts.items():
            combined[ticker] = combined.get(ticker, 0) + count
        time.sleep(2)  # Stay within free rate limits
    
    snapshot = {
        "source": "reddit",
        "timestamp": datetime.utcnow().isoformat(),
        "subreddits_scanned": len(SUBREDDITS),
        "ticker_counts": combined,
    }
    storage.append_mention_snapshot(snapshot)
    print(f"[reddit] total: {combined}")
    return combined


if __name__ == "__main__":
    import json
    counts = scrape_all()
    print(json.dumps(counts, indent=2))
