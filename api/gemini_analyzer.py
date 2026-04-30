"""
Gemini Flash 2.0 wallet analyzer — FREE via Google AI Studio.
Setup:
  1. Go to https://aistudio.google.com/apikey
  2. Click "Create API Key" — completely free, generous limits
  3. Add to .env: GEMINI_API_KEY=your_key_here
  4. pip install google-generativeai

This module replicates the Claude wallet analysis from the document
using Gemini Flash 2.0 (free tier: 15 req/min, 1M tokens/day).
"""

import json
import os
import re

try:
    import google.generativeai as genai
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False
    print("[WARN] google-generativeai not installed. Run: pip install google-generativeai")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """You are an elite quantitative analyst and blockchain data engineer.
Your sole function is to ingest wallet transaction data, calculate historical profitability metrics,
and output ONLY a valid JSON object — no preamble, no explanation, no markdown code fences.

Apply FIFO accounting principles. Be precise and deterministic."""

ANALYSIS_PROMPT = """Analyze this wallet transaction data and return ONLY a JSON object with these exact keys:

{
  "wallet_address": string,
  "total_realized_pnl_usd": number,
  "win_rate_percentage": number (0-100),
  "avg_roi_per_trade": number (percentage),
  "max_drawdown_pct": number (0-100),
  "total_trades": number,
  "risk_classification": one of ["Conservative", "Moderate", "Aggressive", "Degenerate"],
  "is_smart_money": boolean,
  "smart_money_reason": string (one sentence)
}

Smart money criteria (BOTH must be true for is_smart_money=true):
- win_rate_percentage >= 65
- total_realized_pnl_usd > 100000

Wallet data:
{wallet_data}"""


def init_gemini():
    if not HAS_GEMINI:
        raise ImportError("Install google-generativeai: pip install google-generativeai")
    if not GEMINI_API_KEY:
        raise ValueError(
            "Set GEMINI_API_KEY in your .env file.\n"
            "Get a free key at: https://aistudio.google.com/apikey"
        )
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(
        model_name="gemini-2.0-flash",
        system_instruction=SYSTEM_PROMPT,
        generation_config={"temperature": 0.1, "max_output_tokens": 1024}
    )


def parse_json_response(text):
    """Safely extract JSON from model response, even if it adds markdown fences."""
    text = text.strip()
    # Strip markdown fences if present
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"[WARN] JSON parse error: {e}\nRaw response: {text[:200]}")
        return None


def analyze_wallet(wallet_address, transaction_data, model=None):
    """
    Analyze a single wallet's transaction history.

    wallet_address: string like "0x3aF7...b291"
    transaction_data: dict or list of transaction records
    model: optional pre-initialized Gemini model (reuse for efficiency)

    Returns: dict with profitability metrics and is_smart_money boolean
    """
    if model is None:
        model = init_gemini()

    wallet_json = json.dumps({
        "address": wallet_address,
        "transactions": transaction_data
    }, indent=2)

    # Truncate if too long (Gemini Flash free tier: 1M tokens/day)
    if len(wallet_json) > 50000:
        wallet_json = wallet_json[:50000] + "\n... (truncated)"

    prompt = ANALYSIS_PROMPT.replace("{wallet_data}", wallet_json)

    try:
        response = model.generate_content(prompt)
        result = parse_json_response(response.text)

        if result:
            result["wallet_address"] = wallet_address
            return result
        else:
            return {
                "wallet_address": wallet_address,
                "error": "Failed to parse AI response",
                "raw": response.text[:200],
                "is_smart_money": False
            }
    except Exception as e:
        print(f"[Gemini] Error analyzing {wallet_address}: {e}")
        return {
            "wallet_address": wallet_address,
            "error": str(e),
            "is_smart_money": False
        }


def analyze_wallet_batch(wallets, max_wallets=10):
    """
    Analyze multiple wallets, return list of results with smart money flags.

    wallets: list of {"address": str, "transactions": list}
    max_wallets: cap to avoid rate limits (free tier: 15 req/min)

    Returns: list of analysis results, sorted by PnL descending
    """
    if not wallets:
        return []

    print(f"\n[Gemini] Analyzing {min(len(wallets), max_wallets)} wallets...")
    model = init_gemini()
    results = []

    for i, wallet in enumerate(wallets[:max_wallets]):
        address = wallet.get("address", f"wallet_{i}")
        txns = wallet.get("transactions", wallet)  # handle both formats

        print(f"  [{i+1}/{min(len(wallets), max_wallets)}] Analyzing {address[:16]}...")
        result = analyze_wallet(address, txns, model)
        results.append(result)

        # Rate limit: free tier allows 15 req/min = 1 req/4s
        import time
        time.sleep(4)

    # Sort by PnL descending
    results.sort(
        key=lambda r: float(r.get("total_realized_pnl_usd", 0) or 0),
        reverse=True
    )

    smart_count = sum(1 for r in results if r.get("is_smart_money", False))
    print(f"\n[Gemini] {smart_count}/{len(results)} wallets classified as smart money")

    return results


def generate_mock_transactions(wallet_address, style="smart"):
    """
    Generate realistic mock transaction data for testing.
    In production, replace this with real DEXScreener/Birdeye/Solscan data.
    style: "smart" | "degen" | "bot" | "unlucky"
    """
    import random
    random.seed(hash(wallet_address) % 10000)

    styles = {
        "smart": {"wr": 0.72, "avg_gain": 85, "avg_loss": -22, "trades": 180},
        "degen": {"wr": 0.45, "avg_gain": 200, "avg_loss": -80, "trades": 450},
        "bot":   {"wr": 0.58, "avg_gain": 12, "avg_loss": -10, "trades": 2400},
        "unlucky": {"wr": 0.35, "avg_gain": 40, "avg_loss": -55, "trades": 120},
    }
    cfg = styles.get(style, styles["smart"])

    tokens = ["PEPE", "WIF", "BONK", "SOL", "ETH", "TURBO", "FLOKI", "ARB", "LINK"]
    txns = []

    for i in range(min(cfg["trades"], 50)):  # truncate for API efficiency
        is_win = random.random() < cfg["wr"]
        roi = (
            random.uniform(20, cfg["avg_gain"] * 2) if is_win
            else random.uniform(cfg["avg_loss"] * 2, -5)
        )
        entry = random.uniform(500, 50000)
        exit_val = entry * (1 + roi / 100)
        pnl = exit_val - entry

        txns.append({
            "token": random.choice(tokens),
            "entry_usd": round(entry, 2),
            "exit_usd": round(exit_val, 2),
            "pnl_usd": round(pnl, 2),
            "roi_pct": round(roi, 2),
            "hold_days": random.randint(1, 45),
        })

    return txns


def run_demo():
    """Demo: analyze 3 mock wallets without real API calls needed for structure."""
    test_wallets = [
        {"address": "0x3aF7b291EcD6", "transactions": generate_mock_transactions("0x3aF7", "smart")},
        {"address": "9wLqTmN5jsolana", "transactions": generate_mock_transactions("9wLqT", "degen")},
        {"address": "0xE4c27e9Feth01", "transactions": generate_mock_transactions("0xE4c2", "unlucky")},
    ]

    if not GEMINI_API_KEY:
        print("[DEMO] No GEMINI_API_KEY set — showing mock transaction structure only.")
        print("\nSample wallet data structure:")
        print(json.dumps(test_wallets[0], indent=2)[:500])
        print("\nTo run real AI analysis:")
        print("  1. Get free key: https://aistudio.google.com/apikey")
        print("  2. Add GEMINI_API_KEY=your_key to .env")
        print("  3. Run this script again")
        return

    results = analyze_wallet_batch(test_wallets, max_wallets=3)
    print("\n=== WALLET ANALYSIS RESULTS ===")
    for r in results:
        print(f"\n{r.get('wallet_address', 'unknown')}")
        print(f"  PnL: ${r.get('total_realized_pnl_usd', 0):,.0f}")
        print(f"  Win Rate: {r.get('win_rate_percentage', 0):.1f}%")
        print(f"  Risk: {r.get('risk_classification', 'unknown')}")
        print(f"  Smart Money: {'YES' if r.get('is_smart_money') else 'NO'}")


if __name__ == "__main__":
    run_demo()
