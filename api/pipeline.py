"""
SmartFlow Pipeline — orchestrates all 4 steps of the trading loop.
Can run standalone or be called by the Next.js API routes.

Usage:
  python pipeline.py --ticker PEPE
  python pipeline.py --ticker WIF --mock
"""

import sys
import os
import json
import time
import sqlite3
import argparse
import statistics
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from dexscreener import get_full_token_report
from gemini_analyzer import analyze_wallet_batch, generate_mock_transactions

DB_PATH = os.path.join(os.path.dirname(__file__), "../data/mentions.db")

# Signal thresholds (tune these)
ZSCORE_THRESHOLD = 2.0
RSI_MAX = 75
SMART_MONEY_WIN_RATE = 65
SMART_MONEY_PNL = 100000
SMART_MONEY_MIN_RATIO = 0.50  # 50% of top wallets must be smart money

TRACKED_TICKERS = [
    "PEPE", "WIF", "BONK", "TURBO", "FLOKI", "DOGE", "SHIB",
    "SOL", "ETH", "BTC", "ARB", "OP", "AVAX", "LINK"
]


# ── Step 1: Social Momentum ──────────────────────────────────────────────────

def get_mention_history(ticker, source=None, lookback_seconds=7 * 86400):
    """Pull mention history from SQLite DB."""
    if not os.path.exists(DB_PATH):
        return []
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    cutoff = int(time.time()) - lookback_seconds
    if source:
        c.execute(
            "SELECT count, timestamp FROM mentions WHERE ticker=? AND source=? AND timestamp>? ORDER BY timestamp",
            (ticker, source, cutoff)
        )
    else:
        c.execute(
            "SELECT SUM(count), timestamp FROM mentions WHERE ticker=? AND timestamp>? GROUP BY timestamp ORDER BY timestamp",
            (ticker, cutoff)
        )
    rows = c.fetchall()
    conn.close()
    return [{"count": r[0], "timestamp": r[1]} for r in rows]


def compute_zscore(ticker):
    """Compute Z-score for a ticker based on 7-day rolling history."""
    history = get_mention_history(ticker)
    if len(history) < 3:
        # Not enough data — use mock Z-score for demo mode
        return None, 0

    counts = [h["count"] for h in history]
    current = counts[-1] if counts else 0

    mean = statistics.mean(counts)
    std = statistics.stdev(counts) if len(counts) > 1 else 1
    if std == 0:
        return current, 0.0

    zscore = (current - mean) / std
    return current, round(zscore, 2)


def get_mock_zscore(ticker):
    """Mock Z-score for demo purposes when no scraper data exists."""
    mock_values = {
        "PEPE": 1.8, "WIF": 2.1, "BONK": 1.4, "TURBO": 2.8,
        "FLOKI": 1.6, "DOGE": 0.9, "SHIB": 1.1, "SOL": 1.3,
    }
    import random
    base = mock_values.get(ticker.upper(), 1.0)
    return base + random.uniform(-0.3, 0.4)


def step1_social_momentum(ticker, mock=False):
    print(f"\n{'='*50}")
    print(f"STEP 1: Social Momentum — {ticker}")
    print(f"{'='*50}")

    mentions_1h, zscore = compute_zscore(ticker)

    if mock or mentions_1h is None:
        import random
        zscore = get_mock_zscore(ticker)
        mentions_1h = int(zscore * 45 + random.uniform(20, 80))
        print(f"  [MOCK] Using simulated social data")

    print(f"  Ticker: {ticker}")
    print(f"  Mentions/hr: {mentions_1h}")
    print(f"  Z-score (7d rolling): {zscore:.2f}")
    print(f"  Threshold: {ZSCORE_THRESHOLD}")

    passed = zscore > ZSCORE_THRESHOLD
    print(f"  Result: {'PASS ✓' if passed else 'FAIL ✗'}")

    return {
        "step": 1,
        "name": "social_momentum",
        "ticker": ticker,
        "mentions_1h": mentions_1h,
        "zscore": round(zscore, 2),
        "threshold": ZSCORE_THRESHOLD,
        "passed": passed,
        "sources": ["4chan_biz", "reddit", "telegram"],
        "timestamp": int(time.time()),
    }


# ── Step 2: Technical Confluence ─────────────────────────────────────────────

def step2_technical_confluence(ticker, mock=False):
    print(f"\n{'='*50}")
    print(f"STEP 2: Technical Confluence — {ticker}")
    print(f"{'='*50}")

    if mock:
        import random
        rsi = random.uniform(45, 72)
        obv = random.choice(["rising", "rising", "rising", "flat"])
        adx = random.uniform(18, 42)
        price_change_1h = random.uniform(-2, 8)
        price_change_24h = random.uniform(-5, 25)
        volume_24h = random.uniform(1e6, 50e6)
        print(f"  [MOCK] Using simulated technical data")
        report = {
            "rsi_approx": round(rsi, 1),
            "obv_signal": obv,
            "adx_approx": round(adx, 1),
            "price_change_1h": round(price_change_1h, 2),
            "price_change_24h": round(price_change_24h, 2),
            "volume_24h_usd": round(volume_24h, 0),
            "technical_pass": obv == "rising" and rsi < 75 and price_change_1h > 0,
            "price_usd": "0.00001234",
        }
    else:
        report = get_full_token_report(ticker)
        if not report:
            print(f"  [ERROR] Could not fetch data for {ticker}")
            return {"step": 2, "name": "technical_confluence", "passed": False, "error": "fetch_failed"}

    passed = report["technical_pass"]
    print(f"  RSI≈{report['rsi_approx']} (max: {RSI_MAX})")
    print(f"  OBV: {report['obv_signal']}")
    print(f"  ADX≈{report['adx_approx']}")
    print(f"  1h change: {report['price_change_1h']:+.2f}%")
    print(f"  Result: {'PASS ✓' if passed else 'FAIL ✗'}")

    return {
        "step": 2,
        "name": "technical_confluence",
        "ticker": ticker,
        "rsi": report["rsi_approx"],
        "obv_signal": report["obv_signal"],
        "adx": report["adx_approx"],
        "price_change_1h": report["price_change_1h"],
        "price_change_24h": report["price_change_24h"],
        "volume_24h_usd": report["volume_24h_usd"],
        "price_usd": report.get("price_usd", "0"),
        "passed": passed,
        "timestamp": int(time.time()),
    }


# ── Step 3: Wallet AI Analysis ───────────────────────────────────────────────

def fetch_top_wallets_mock(ticker, count=6):
    """Mock wallet data — replace with real Birdeye/Solscan calls in production."""
    styles = ["smart", "smart", "smart", "degen", "bot", "unlucky"]
    wallets = []
    for i, style in enumerate(styles[:count]):
        addr = f"0x{ticker[:3].upper()}{i}{'abcdef0123456789'[i*2:i*2+8]}"
        wallets.append({
            "address": addr,
            "transactions": generate_mock_transactions(addr, style),
            "style_hint": style,
        })
    return wallets


def step3_wallet_analysis(ticker, mock=False, use_ai=True):
    print(f"\n{'='*50}")
    print(f"STEP 3: Wallet AI Analysis — {ticker}")
    print(f"{'='*50}")

    wallets = fetch_top_wallets_mock(ticker)
    print(f"  Found {len(wallets)} top trader wallets")

    if use_ai:
        try:
            results = analyze_wallet_batch(wallets, max_wallets=6)
        except Exception as e:
            print(f"  [WARN] AI analysis failed ({e}), using mock scores")
            results = _mock_wallet_scores(wallets)
    else:
        results = _mock_wallet_scores(wallets)

    smart_wallets = [r for r in results if r.get("is_smart_money", False)]
    smart_ratio = len(smart_wallets) / len(results) if results else 0

    print(f"\n  Smart money wallets: {len(smart_wallets)}/{len(results)} ({smart_ratio:.0%})")
    passed = smart_ratio >= SMART_MONEY_MIN_RATIO

    return {
        "step": 3,
        "name": "wallet_analysis",
        "ticker": ticker,
        "wallets_analyzed": len(results),
        "smart_money_count": len(smart_wallets),
        "smart_money_ratio": round(smart_ratio, 3),
        "smart_money_threshold": SMART_MONEY_MIN_RATIO,
        "wallet_results": results,
        "passed": passed,
        "timestamp": int(time.time()),
    }


def _mock_wallet_scores(wallets):
    """Deterministic mock scores when AI is unavailable."""
    mock_scores = [
        {"win_rate_percentage": 78, "total_realized_pnl_usd": 842000, "total_trades": 234, "risk_classification": "Moderate", "is_smart_money": True},
        {"win_rate_percentage": 71, "total_realized_pnl_usd": 1240000, "total_trades": 189, "risk_classification": "Aggressive", "is_smart_money": True},
        {"win_rate_percentage": 64, "total_realized_pnl_usd": 390000, "total_trades": 412, "risk_classification": "Degenerate", "is_smart_money": False},
        {"win_rate_percentage": 69, "total_realized_pnl_usd": 670000, "total_trades": 301, "risk_classification": "Moderate", "is_smart_money": True},
        {"win_rate_percentage": 55, "total_realized_pnl_usd": 88000, "total_trades": 567, "risk_classification": "Aggressive", "is_smart_money": False},
        {"win_rate_percentage": 82, "total_realized_pnl_usd": 2100000, "total_trades": 98, "risk_classification": "Conservative", "is_smart_money": True},
    ]
    results = []
    for i, wallet in enumerate(wallets):
        score = mock_scores[i % len(mock_scores)].copy()
        score["wallet_address"] = wallet["address"]
        score["smart_money_reason"] = (
            "Win rate and PnL exceed thresholds consistently across diverse assets."
            if score["is_smart_money"]
            else "Does not meet minimum win rate or PnL criteria."
        )
        results.append(score)
    return results


# ── Step 4: Signal Generation ────────────────────────────────────────────────

def step4_signal(ticker, step1, step2, step3):
    print(f"\n{'='*50}")
    print(f"STEP 4: Signal Generation — {ticker}")
    print(f"{'='*50}")

    all_passed = step1["passed"] and step2["passed"] and step3["passed"]

    if all_passed:
        zscore = step1["zscore"]
        smart_ratio = step3["smart_money_ratio"]
        rsi_factor = 1 - (max(0, step2["rsi"] - 50) / 50)
        confidence = min(97, int(
            (zscore / 4.0) * 40 +
            smart_ratio * 35 +
            rsi_factor * 15 +
            (10 if step2["obv_signal"] == "rising" else 0)
        ))
        signal = "HIGH_CONVICTION_BUY" if confidence > 65 else "BUY"
        reason = (
            f"Z={zscore:.2f} social spike confirmed. "
            f"RSI={step2['rsi']:.0f}, OBV {step2['obv_signal']}. "
            f"{step3['smart_money_count']}/{step3['wallets_analyzed']} wallets AI-verified smart money."
        )
        print(f"  Signal: {signal}")
        print(f"  Confidence: {confidence}%")
    else:
        signal = "NO_SIGNAL"
        confidence = 0
        failed = []
        if not step1["passed"]: failed.append(f"Z-score {step1['zscore']:.2f} < {ZSCORE_THRESHOLD}")
        if not step2["passed"]: failed.append(f"Technical divergence (OBV: {step2.get('obv_signal', 'N/A')})")
        if not step3["passed"]: failed.append(f"Smart money ratio {step3['smart_money_ratio']:.0%} < {SMART_MONEY_MIN_RATIO:.0%}")
        reason = "Failed: " + "; ".join(failed)
        print(f"  Signal: {signal}")
        print(f"  Reason: {reason}")

    return {
        "step": 4,
        "name": "signal_generation",
        "ticker": ticker,
        "signal": signal,
        "confidence": confidence,
        "reason": reason,
        "passed": all_passed,
        "timestamp": int(time.time()),
        "steps_summary": {
            "social": step1["passed"],
            "technical": step2["passed"],
            "wallets": step3["passed"],
        }
    }


# ── Full Pipeline ─────────────────────────────────────────────────────────────

def run_pipeline(ticker, mock=False, use_ai=True):
    """Run all 4 steps and return full results dict."""
    start = time.time()
    print(f"\n{'#'*50}")
    print(f"SmartFlow Pipeline starting: {ticker.upper()}")
    print(f"Mode: {'MOCK' if mock else 'LIVE'} | AI: {'ON' if use_ai else 'OFF'}")
    print(f"{'#'*50}")

    s1 = step1_social_momentum(ticker, mock=mock)
    if not s1["passed"]:
        s4 = step4_signal(ticker, s1, {"passed": False, "rsi": 0, "obv_signal": "N/A"}, {"passed": False, "smart_money_ratio": 0, "smart_money_count": 0, "wallets_analyzed": 0})
        return {"ticker": ticker, "steps": [s1, s4], "signal": s4, "duration_s": round(time.time()-start, 2)}

    s2 = step2_technical_confluence(ticker, mock=mock)
    if not s2["passed"]:
        s4 = step4_signal(ticker, s1, s2, {"passed": False, "smart_money_ratio": 0, "smart_money_count": 0, "wallets_analyzed": 0})
        return {"ticker": ticker, "steps": [s1, s2, s4], "signal": s4, "duration_s": round(time.time()-start, 2)}

    s3 = step3_wallet_analysis(ticker, mock=mock, use_ai=use_ai)
    s4 = step4_signal(ticker, s1, s2, s3)

    result = {
        "ticker": ticker,
        "steps": [s1, s2, s3, s4],
        "signal": s4,
        "duration_s": round(time.time() - start, 2),
    }

    print(f"\n{'='*50}")
    print(f"PIPELINE COMPLETE in {result['duration_s']}s")
    print(f"Final signal: {s4['signal']} (confidence: {s4['confidence']}%)")
    print(f"{'='*50}\n")

    return result


def scan_all_tickers(mock=True):
    """Scan all tracked tickers and return those with signals."""
    signals = []
    for ticker in TRACKED_TICKERS:
        result = run_pipeline(ticker, mock=mock, use_ai=False)
        if result["signal"]["signal"] != "NO_SIGNAL":
            signals.append(result)
        time.sleep(1)
    return signals


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SmartFlow trading pipeline")
    parser.add_argument("--ticker", default="PEPE", help="Token ticker to analyze")
    parser.add_argument("--mock", action="store_true", help="Use mock data (no API calls)")
    parser.add_argument("--no-ai", action="store_true", help="Skip Gemini AI analysis")
    parser.add_argument("--scan-all", action="store_true", help="Scan all tracked tickers")
    args = parser.parse_args()

    if args.scan_all:
        results = scan_all_tickers(mock=args.mock)
        print(f"\n{len(results)} signals found:")
        for r in results:
            print(f"  {r['ticker']}: {r['signal']['signal']} ({r['signal']['confidence']}%)")
    else:
        result = run_pipeline(args.ticker, mock=args.mock, use_ai=not args.no_ai)
        print(json.dumps(result["signal"], indent=2))
