"""
Telegram scraper — free with a phone number
Uses Telethon to read public crypto channels
"""
import asyncio
import os
import re
from datetime import datetime, timedelta
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from lib.storage import Storage

load_dotenv()

API_ID = os.getenv("TELEGRAM_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH")

# Public crypto telegram channels — all free to join and scrape
PUBLIC_CHANNELS = [
    "https://t.me/CryptoSignalsAll",
    "https://t.me/binance_announcements",
    "https://t.me/Uniswap",
    "https://t.me/SolanaFloor",
    "https://t.me/dexsignals",
    "https://t.me/WhaleAlertio",
]

TRACKED_TICKERS = [
    "SOL", "ETH", "BTC", "PEPE", "WIF", "BONK", "FLOKI", "DOGE",
    "SHIB", "ARB", "OP", "MATIC", "AVAX", "LINK", "UNI", "TURBO",
]

EXCLUDED_WORDS = {"IT", "ON", "OR", "AT", "BE", "DO", "IF", "IN", "IS", "NO",
                  "OF", "SO", "TO", "UP", "US", "WE", "GO", "BY", "AS"}

storage = Storage()


def extract_tickers(text: str) -> list[str]:
    if not text:
        return []
    text_upper = text.upper()
    found = []
    dollar_tickers = re.findall(r'\$([A-Z]{2,8})', text_upper)
    found.extend([t for t in dollar_tickers if t not in EXCLUDED_WORDS])
    for ticker in TRACKED_TICKERS:
        if re.search(rf'\b{ticker}\b', text_upper) and ticker not in found:
            found.append(ticker)
    return found


async def scrape_channel(client: TelegramClient, channel_url: str, hours_back: int = 1) -> dict:
    """Scrape recent messages from a public channel."""
    ticker_counts = {}
    cutoff = datetime.utcnow() - timedelta(hours=hours_back)
    
    try:
        entity = await client.get_entity(channel_url)
        messages = await client.get_messages(entity, limit=200)
        
        recent = [m for m in messages if m.date.replace(tzinfo=None) > cutoff]
        
        for msg in recent:
            if msg.text:
                for t in extract_tickers(msg.text):
                    ticker_counts[t] = ticker_counts.get(t, 0) + 1
        
        print(f"[telegram] {channel_url}: {len(recent)} msgs → {ticker_counts}")
    except Exception as e:
        print(f"[telegram] {channel_url} error: {e}")
    
    return ticker_counts


async def scrape_all() -> dict:
    """Scrape all configured Telegram channels."""
    if not API_ID or not API_HASH:
        print("[telegram] no API credentials. skipping. add TELEGRAM_API_ID and TELEGRAM_API_HASH to .env")
        return {}
    
    print(f"[telegram] starting scrape at {datetime.now().strftime('%H:%M:%S')}")
    combined = {}
    
    async with TelegramClient("smartflow_session", int(API_ID), API_HASH) as client:
        for channel in PUBLIC_CHANNELS:
            counts = await scrape_channel(client, channel)
            for ticker, count in counts.items():
                combined[ticker] = combined.get(ticker, 0) + count
            await asyncio.sleep(1)
    
    snapshot = {
        "source": "telegram",
        "timestamp": datetime.utcnow().isoformat(),
        "channels_scanned": len(PUBLIC_CHANNELS),
        "ticker_counts": combined,
    }
    storage.append_mention_snapshot(snapshot)
    return combined


def run():
    return asyncio.run(scrape_all())


if __name__ == "__main__":
    import json
    counts = run()
    print(json.dumps(counts, indent=2))
