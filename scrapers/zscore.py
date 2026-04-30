"""
Z-score calculator — the core math engine
Computes rolling Z-scores across all tracked tickers
"""
import json
import math
from datetime import datetime, timedelta
from lib.storage import Storage

storage = Storage()

LOOKBACK_HOURS = 168  # 7 days
ANOMALY_THRESHOLD = 2.0
EXTREME_THRESHOLD = 2.5


def get_ticker_history(ticker: str, hours: int = LOOKBACK_HOURS) -> list[dict]:
    """Get all mention snapshots for a ticker within the lookback window."""
    snapshots = storage.get_mention_snapshots(hours_back=hours)
    history = []
    
    for snap in snapshots:
        count = snap.get("ticker_counts", {}).get(ticker, 0)
        history.append({
            "timestamp": snap["timestamp"],
            "source": snap["source"],
            "count": count,
        })
    
    return history


def aggregate_by_hour(history: list[dict]) -> list[dict]:
    """Aggregate mention counts into hourly buckets."""
    hourly = {}
    
    for entry in history:
        ts = datetime.fromisoformat(entry["timestamp"])
        hour_key = ts.strftime("%Y-%m-%dT%H:00:00")
        hourly[hour_key] = hourly.get(hour_key, 0) + entry["count"]
    
    return [{"timestamp": k, "count": v} for k, v in sorted(hourly.items())]


def calculate_zscore(ticker: str) -> dict:
    """
    Calculate the current Z-score for a ticker.
    Z = (current_mentions - rolling_mean) / rolling_std
    """
    history = get_ticker_history(ticker)
    hourly = aggregate_by_hour(history)
    
    if len(hourly) < 5:
        return {
            "ticker": ticker,
            "z_score": 0.0,
            "current_mentions": 0,
            "mean": 0.0,
            "std": 0.0,
            "status": "insufficient_data",
            "is_anomaly": False,
            "is_extreme": False,
        }
    
    counts = [h["count"] for h in hourly]
    current = counts[-1]
    historical = counts[:-1]  # All except current
    
    # Rolling mean and std
    mean = sum(historical) / len(historical)
    variance = sum((x - mean) ** 2 for x in historical) / len(historical)
    std = math.sqrt(variance)
    
    if std == 0:
        z = 0.0
    else:
        z = (current - mean) / std
    
    # Percentage change vs previous period
    prev = counts[-2] if len(counts) >= 2 else current
    pct_change = ((current - prev) / prev * 100) if prev > 0 else 0
    
    return {
        "ticker": ticker,
        "z_score": round(z, 2),
        "current_mentions": current,
        "mean": round(mean, 1),
        "std": round(std, 1),
        "pct_change": round(pct_change, 1),
        "data_points": len(counts),
        "status": "extreme_hype" if z >= EXTREME_THRESHOLD else ("anomaly" if z >= ANOMALY_THRESHOLD else "normal"),
        "is_anomaly": z >= ANOMALY_THRESHOLD,
        "is_extreme": z >= EXTREME_THRESHOLD,
        "history_hourly": hourly[-48:],  # Last 48 hours for charts
        "timestamp": datetime.utcnow().isoformat(),
    }


def get_all_zscores(tickers: list[str]) -> list[dict]:
    """Calculate Z-scores for all tracked tickers, sorted by score."""
    results = [calculate_zscore(t) for t in tickers]
    return sorted(results, key=lambda r: r["z_score"], reverse=True)


def get_alerts(tickers: list[str]) -> list[dict]:
    """Return only tickers with anomalous Z-scores."""
    all_scores = get_all_zscores(tickers)
    return [r for r in all_scores if r["is_anomaly"]]


if __name__ == "__main__":
    tickers = ["SOL", "ETH", "PEPE", "WIF", "BONK", "TURBO"]
    results = get_all_zscores(tickers)
    for r in results:
        print(f"{r['ticker']}: Z={r['z_score']} ({r['status']}) — {r['current_mentions']} mentions")
