"""
Wallet analyzer powered by Google Gemini 1.5 Flash (FREE tier)
- 15 requests/minute
- 1500 requests/day
- No credit card required

Get your free key at: https://aistudio.google.com/app/apikey
"""
import os
import json
import re
from datetime import datetime
from dotenv import load_dotenv
import google.generativeai as genai
from lib.storage import Storage

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
storage = Storage()

SMART_MONEY_CRITERIA = {
    "min_win_rate": 65.0,      # 65% win rate minimum
    "min_realized_pnl": 100000, # $100k minimum realized PnL
}

SYSTEM_PROMPT = """You are an elite quantitative blockchain analyst and risk assessment agent. 
Your sole function is to analyze cryptocurrency wallet trading history data and determine if a wallet 
qualifies as "smart money" based on strict quantitative criteria.

You must respond ONLY with valid JSON. No preamble, no explanation, no markdown fences.
Apply FIFO accounting principles for PnL calculations.
"""

ANALYSIS_PROMPT = """Analyze this wallet trading data and calculate the following metrics.
Return ONLY a JSON object with exactly these fields:

{{
  "wallet_address": "<address>",
  "total_realized_pnl_usd": <number>,
  "win_rate_percentage": <number 0-100>,
  "total_trades": <integer>,
  "avg_roi_per_trade": <number>,
  "best_trade_usd": <number>,
  "worst_trade_usd": <number>,
  "risk_classification": "<Conservative|Moderate|Aggressive|Degenerate>",
  "is_smart_money": <true|false>,
  "reasoning": "<one sentence>"
}}

Smart money criteria (BOTH must be true for is_smart_money = true):
- win_rate_percentage >= {min_win_rate}
- total_realized_pnl_usd >= {min_pnl}

Wallet data to analyze:
{wallet_data}
"""


def setup_gemini():
    """Initialize Gemini client."""
    if not GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/app/apikey\n"
            "Then add it to your .env file: GEMINI_API_KEY=your_key_here"
        )
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=SYSTEM_PROMPT
    )


def analyze_wallet(wallet_address: str, trade_data: dict, model=None) -> dict:
    """
    Analyze a single wallet's trading history using Gemini.
    
    trade_data format (from DEXScreener/Birdeye):
    {
        "address": "0x...",
        "trades": [
            {"token": "PEPE", "buy_price": 0.000001, "sell_price": 0.000003, 
             "amount_usd": 5000, "pnl_usd": 10000, "timestamp": "..."},
            ...
        ],
        "total_volume_usd": 500000,
    }
    """
    if model is None:
        model = setup_gemini()
    
    prompt = ANALYSIS_PROMPT.format(
        min_win_rate=SMART_MONEY_CRITERIA["min_win_rate"],
        min_pnl=SMART_MONEY_CRITERIA["min_realized_pnl"],
        wallet_data=json.dumps(trade_data, indent=2)
    )
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        # Strip any accidental markdown fences
        text = re.sub(r'^```(?:json)?\n?', '', text)
        text = re.sub(r'\n?```$', '', text)
        
        result = json.loads(text)
        result["wallet_address"] = wallet_address
        result["analyzed_at"] = datetime.utcnow().isoformat()
        result["model"] = "gemini-1.5-flash"
        
        storage.save_wallet_analysis(wallet_address, result)
        return result
        
    except json.JSONDecodeError as e:
        print(f"[gemini] JSON parse error for {wallet_address}: {e}")
        print(f"[gemini] raw response: {text[:500]}")
        return _fallback_analysis(wallet_address, trade_data)
    except Exception as e:
        print(f"[gemini] API error for {wallet_address}: {e}")
        return _fallback_analysis(wallet_address, trade_data)


def analyze_multiple_wallets(wallets: list[dict]) -> list[dict]:
    """
    Analyze multiple wallets. Respects Gemini's 15 req/min free tier.
    """
    import time
    model = setup_gemini()
    results = []
    
    for i, wallet in enumerate(wallets):
        address = wallet.get("address", f"wallet_{i}")
        print(f"[gemini] analyzing wallet {i+1}/{len(wallets)}: {address[:12]}...")
        
        result = analyze_wallet(address, wallet, model)
        results.append(result)
        
        # Rate limit: 15 req/min = 1 req per 4 seconds
        if i < len(wallets) - 1:
            time.sleep(4)
    
    smart_count = sum(1 for r in results if r.get("is_smart_money"))
    print(f"[gemini] analysis complete: {smart_count}/{len(results)} smart money wallets")
    return results


def _fallback_analysis(wallet_address: str, trade_data: dict) -> dict:
    """
    Fallback: calculate basic metrics without AI if Gemini fails.
    Less sophisticated but always works.
    """
    trades = trade_data.get("trades", [])
    
    if not trades:
        return {
            "wallet_address": wallet_address,
            "total_realized_pnl_usd": 0,
            "win_rate_percentage": 0,
            "total_trades": 0,
            "avg_roi_per_trade": 0,
            "best_trade_usd": 0,
            "worst_trade_usd": 0,
            "risk_classification": "Unknown",
            "is_smart_money": False,
            "reasoning": "Insufficient data for analysis",
            "analyzed_at": datetime.utcnow().isoformat(),
            "model": "fallback_calculator",
        }
    
    pnls = [t.get("pnl_usd", 0) for t in trades]
    total_pnl = sum(pnls)
    winning = sum(1 for p in pnls if p > 0)
    win_rate = (winning / len(trades)) * 100 if trades else 0
    avg_roi = total_pnl / len(trades) if trades else 0
    
    is_smart = win_rate >= SMART_MONEY_CRITERIA["min_win_rate"] and total_pnl >= SMART_MONEY_CRITERIA["min_realized_pnl"]
    
    return {
        "wallet_address": wallet_address,
        "total_realized_pnl_usd": round(total_pnl, 2),
        "win_rate_percentage": round(win_rate, 1),
        "total_trades": len(trades),
        "avg_roi_per_trade": round(avg_roi, 2),
        "best_trade_usd": max(pnls) if pnls else 0,
        "worst_trade_usd": min(pnls) if pnls else 0,
        "risk_classification": "Aggressive" if win_rate < 50 else "Moderate",
        "is_smart_money": is_smart,
        "reasoning": f"Win rate {win_rate:.0f}%, PnL ${total_pnl:,.0f}",
        "analyzed_at": datetime.utcnow().isoformat(),
        "model": "fallback_calculator",
    }


if __name__ == "__main__":
    # Test with mock wallet data
    mock_wallet = {
        "address": "0x3aF7b291example",
        "trades": [
            {"token": "PEPE", "buy_price": 0.000001, "sell_price": 0.000004, "amount_usd": 10000, "pnl_usd": 30000},
            {"token": "WIF", "buy_price": 1.2, "sell_price": 3.4, "amount_usd": 5000, "pnl_usd": 9167},
            {"token": "BONK", "buy_price": 0.00002, "sell_price": 0.00001, "amount_usd": 3000, "pnl_usd": -1500},
            {"token": "TURBO", "buy_price": 0.003, "sell_price": 0.009, "amount_usd": 8000, "pnl_usd": 16000},
            {"token": "FLOKI", "buy_price": 0.0002, "sell_price": 0.00015, "amount_usd": 2000, "pnl_usd": -500},
        ],
        "total_volume_usd": 28000,
    }
    
    result = analyze_wallet("0x3aF7b291example", mock_wallet)
    print(json.dumps(result, indent=2))
