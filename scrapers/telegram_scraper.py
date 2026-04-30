"""
Telegram scraper using Telethon — free, needs phone number + API ID.
Setup:
  1. Go to https://my.telegram.org
  2. Log in with your phone number
  3. Click "API Development Tools"
  4. Create an app — copy API_ID and API_HASH into .env
  5. pip install telethon python-dotenv
  6. Run: python telegram_scraper.py
     (first run will ask for your phone + verification code)
"""

import asyncio
import re
import sqlite3
import os
import time
from datetime import datetime
from collections import defaultdict

try:
    from telethon import TelegramClient, events
    from telethon.tl.types import Channel
    HAS_TELETHON = True
except ImportError:
    HAS_TELETHON = False
    print("[WARN] telethon not installed. Run: pip install telethon")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

API_ID = os.getenv("TELEGRAM_API_ID", "")
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
DB_PATH = os.path.join(os.path.dirname(__file__), "../data/mentions.db")

# High-signal crypto channels — public ones you can join without invite
# These are examples; replace with channels you actually follow
TARGET_CHANNELS = [
    "whalechannel",           # whale alerts
    "CryptoComOfficial",      # crypto.com news
    "binance",                # binance announcements
    "coinbureau",             # coin bureau
    "altcoindaily",           # altcoin daily
    # Add private channels you're a member of by their username or invite link
]

TRACKED_TICKERS = [
    "PEPE", "WIF", "BONK", "TURBO", "FLOKI", "DOGE", "SHIB",
    "SOL", "ETH", "BTC", "ARB", "OP", "AVAX", "LINK", "UNI",
    "AAVE", "INJ", "TIA", "JUP", "PYTH", "RENDER", "FET"
]

FALSE_POSITIVES = {
    "FOR", "THE", "ARE", "YOU", "ALL", "ONE", "NEW", "NOW",
    "GET", "HAS", "NOT", "BUT", "AND", "CAN", "USE", "ITS",
}


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


def save_mentions(counts):
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
    ts = int(time.time())
    for ticker, count in counts.items():
        c.execute(
            "INSERT INTO mentions (ticker, source, count, timestamp) VALUES (?, ?, ?, ?)",
            (ticker, "telegram", count, ts)
        )
    conn.commit()
    conn.close()


async def run():
    if not HAS_TELETHON:
        print("[ERROR] Install telethon first: pip install telethon")
        return

    if not API_ID or not API_HASH:
        print("[ERROR] Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env file")
        print("  Get them from: https://my.telegram.org")
        return

    client = TelegramClient("smartflow_session", int(API_ID), API_HASH)
    await client.start()
    print(f"[Telegram] Logged in. Monitoring {len(TARGET_CHANNELS)} channels...")

    # Batch counter — flush to DB every 60s
    counts = defaultdict(int)
    last_flush = time.time()

    @client.on(events.NewMessage(chats=TARGET_CHANNELS))
    async def handler(event):
        nonlocal last_flush
        text = event.message.text or ""
        tickers = extract_tickers(text)
        for t in tickers:
            counts[t] += 1
            print(f"[Telegram] {t} mentioned in {event.chat.title if hasattr(event.chat, 'title') else 'channel'}")

        # Flush to DB every 60s
        if time.time() - last_flush > 60:
            if counts:
                save_mentions(dict(counts))
                print(f"[Telegram] Flushed {sum(counts.values())} mentions to DB")
                counts.clear()
            last_flush = time.time()

    print("[Telegram] Listening for new messages... (Ctrl+C to stop)")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(run())
