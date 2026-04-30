"""
Simple file-based storage — no database needed, works for free hosting.
Saves everything as JSON files in a data/ directory.
"""
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"


class Storage:
    def __init__(self):
        DATA_DIR.mkdir(exist_ok=True)
        (DATA_DIR / "snapshots").mkdir(exist_ok=True)
        (DATA_DIR / "onchain").mkdir(exist_ok=True)
        (DATA_DIR / "wallets").mkdir(exist_ok=True)
        (DATA_DIR / "signals").mkdir(exist_ok=True)

    # ── Mention snapshots ──────────────────────────────────────────────

    def append_mention_snapshot(self, snapshot: dict):
        """Append a scraper snapshot to today's file."""
        date_str = datetime.utcnow().strftime("%Y-%m-%d")
        path = DATA_DIR / "snapshots" / f"{date_str}.json"
        
        existing = self._read_json(path, default=[])
        existing.append(snapshot)
        self._write_json(path, existing)

    def get_mention_snapshots(self, hours_back: int = 168) -> list[dict]:
        """Read all snapshots within the lookback window."""
        cutoff = datetime.utcnow() - timedelta(hours=hours_back)
        snapshots = []
        
        # Read last N day files
        days_back = (hours_back // 24) + 2
        for i in range(days_back):
            date = (datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d")
            path = DATA_DIR / "snapshots" / f"{date}.json"
            day_snaps = self._read_json(path, default=[])
            snapshots.extend(day_snaps)
        
        # Filter to window
        result = []
        for s in snapshots:
            try:
                ts = datetime.fromisoformat(s["timestamp"])
                if ts >= cutoff:
                    result.append(s)
            except Exception:
                pass
        
        return sorted(result, key=lambda s: s["timestamp"])

    # ── On-chain data ──────────────────────────────────────────────────

    def save_onchain_data(self, ticker: str, data: dict):
        path = DATA_DIR / "onchain" / f"{ticker.upper()}.json"
        self._write_json(path, data)

    def get_onchain_data(self, ticker: str) -> dict | None:
        path = DATA_DIR / "onchain" / f"{ticker.upper()}.json"
        return self._read_json(path)

    # ── Wallet analysis ────────────────────────────────────────────────

    def save_wallet_analysis(self, address: str, analysis: dict):
        safe_addr = address.replace("/", "_").replace("\\", "_")[:20]
        path = DATA_DIR / "wallets" / f"{safe_addr}.json"
        self._write_json(path, analysis)

    def get_wallet_analysis(self, address: str) -> dict | None:
        safe_addr = address.replace("/", "_").replace("\\", "_")[:20]
        path = DATA_DIR / "wallets" / f"{safe_addr}.json"
        return self._read_json(path)

    def get_all_wallet_analyses(self) -> list[dict]:
        results = []
        wallet_dir = DATA_DIR / "wallets"
        for f in wallet_dir.glob("*.json"):
            data = self._read_json(f)
            if data:
                results.append(data)
        return results

    # ── Signals ────────────────────────────────────────────────────────

    def save_signal(self, signal: dict):
        path = DATA_DIR / "signals" / "history.json"
        existing = self._read_json(path, default=[])
        existing.append(signal)
        # Keep last 500 signals
        if len(existing) > 500:
            existing = existing[-500:]
        self._write_json(path, existing)

    def get_signals(self, limit: int = 50) -> list[dict]:
        path = DATA_DIR / "signals" / "history.json"
        signals = self._read_json(path, default=[])
        return signals[-limit:]

    # ── Dashboard state ────────────────────────────────────────────────

    def save_dashboard_state(self, state: dict):
        path = DATA_DIR / "dashboard_state.json"
        self._write_json(path, state)

    def get_dashboard_state(self) -> dict:
        path = DATA_DIR / "dashboard_state.json"
        return self._read_json(path, default={})

    # ── Helpers ────────────────────────────────────────────────────────

    def _read_json(self, path: Path, default=None):
        try:
            if path.exists():
                with open(path, "r") as f:
                    return json.load(f)
        except Exception:
            pass
        return default

    def _write_json(self, path: Path, data):
        try:
            with open(path, "w") as f:
                json.dump(data, f, indent=2, default=str)
        except Exception as e:
            print(f"[storage] write error {path}: {e}")
