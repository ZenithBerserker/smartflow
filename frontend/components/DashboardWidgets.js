import { fmtNum, fmtWalletAddress } from "../lib/format";

export function NCard({ label, value, sub, accent }) {
  const c = accent === "green" ? "#00ff88" : accent === "cyan" ? "#00cfff" : accent === "amber" ? "#ffaa00" : null;
  return (
    <div className="metric-card" style={{ background: "#0a0f16", border: `1px solid ${c ? c + "33" : "#0d2030"}`, borderRadius: 8, padding: "10px 12px", boxShadow: c ? `0 0 12px ${c}11` : "none" }}>
      <div className="metric-card-label" style={{ fontSize: 10, color: "#335566", fontFamily: "'Share Tech Mono',monospace", marginBottom: 4, letterSpacing: ".08em" }}>{label}</div>
      <div className="metric-card-value" style={{ fontSize: 20, fontWeight: 700, color: c || "#99bbcc", textShadow: c ? `0 0 8px ${c}66` : "none" }}>{value}</div>
      <div className="metric-card-sub" style={{ fontSize: 10, color: "#335566", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export function SCard({ num, title, step, loading }) {
  const status = !step ? (loading ? "active" : "idle") : step.passed ? "pass" : "fail";
  const bc = { pass: "#00ff8844", fail: "#ff446633", active: "#00cfff44", idle: "#0d2030" }[status];
  const vc = { pass: "#00ff88", fail: "#ff4466", active: "#00cfff", idle: "#335566" }[status];
  return (
    <div className="step-card" style={{ background: "#0a0f16", border: `1px solid ${bc}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 10, color: "#335566", fontFamily: "'Share Tech Mono',monospace", marginBottom: 4 }}>STEP {num}</div>
      <div style={{ fontSize: 11, color: "#446688", marginBottom: 8 }}>{title}</div>
      {loading && <div style={{ fontSize: 11, color: "#00cfff", fontFamily: "'Share Tech Mono',monospace" }}>scanning...</div>}
      {step && (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, color: vc, textShadow: `0 0 8px ${vc}66` }}>
            {num === 1 && `Z = ${step.zscore}`}
            {num === 2 && `RSI ${step.rsi?.toFixed(0)}`}
            {num === 3 && `${step.smart_money_count}/${step.wallets_analyzed}`}
            {num === 4 && (step.signal?.replace(/_/g, " ") || "--")}
          </div>
          <div style={{ fontSize: 10, color: "#335566", marginTop: 2 }}>
            {num === 1 && `${step.mentions_1h} mentions/hr`}
            {num === 2 && `OBV ${step.obv_signal}`}
            {num === 3 && `${Math.round(step.smart_money_ratio * 100)}% smart money`}
            {num === 4 && `${step.confidence}% confidence`}
          </div>
          <span style={{ display: "inline-block", marginTop: 6, fontSize: 10, padding: "2px 8px", borderRadius: 10, fontFamily: "'Share Tech Mono',monospace", background: step.passed ? "#00ff8811" : "#ff446611", color: step.passed ? "#00ff88" : "#ff4466" }}>{step.passed ? "pass" : "fail"}</span>
        </>
      )}
    </div>
  );
}

export function WalletTable({ wallets, loading, onRefresh }) {
  const data = wallets || [];
  return (
    <div className="wallet-panel" style={{ background: "#0a0f16", border: "1px solid #0d2030", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: "#336688", fontFamily: "'Share Tech Mono',monospace", letterSpacing: ".1em" }}>TOP TRADER WALLETS - AI VALIDATED</div>
          {loading && <div style={{ fontSize: 9, color: "#00cfff", fontFamily: "'Share Tech Mono',monospace", marginTop: 3 }}>loading wallets...</div>}
        </div>
        {onRefresh && <button onClick={onRefresh} disabled={loading} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #1a2a3a", color: "#446688", fontFamily: "'Share Tech Mono',monospace", fontSize: 10, cursor: loading ? "not-allowed" : "pointer", borderRadius: 3 }}>refresh</button>}
      </div>
      <div className="wallet-table-wrap" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #0d2030" }}>
              {["WALLET", "VOLUME", "BUYS/SELLS", "WIN EST.", "TRADES", "VERDICT"].map((h) => <th key={h} style={{ padding: "4px 8px", textAlign: "left", fontSize: 9, color: "#335566", fontFamily: "'Share Tech Mono',monospace", fontWeight: 400 }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: "12px 8px", color: "#335566", fontFamily: "'Share Tech Mono',monospace", fontSize: 10 }}>
                  {loading ? "loading live wallet data..." : "no live wallet data available"}
                </td>
              </tr>
            )}
            {data.map((w, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #0a1520" }}>
                <td style={{ padding: "8px", fontFamily: "'Share Tech Mono',monospace", fontSize: 10, color: "#335566" }} title={w.wallet_address}>{fmtWalletAddress(w.wallet_address)}</td>
                <td style={{ padding: "8px", color: w.is_smart_money ? "#00ff88" : "#99bbcc", fontWeight: w.is_smart_money ? 700 : 400 }}>{fmtNum(w.volume_usd || w.total_realized_pnl_usd || 0)}</td>
                <td style={{ padding: "8px", color: "#446688" }}>{w.buy_count !== undefined || w.sell_count !== undefined ? `${w.buy_count || 0}/${w.sell_count || 0}` : "--"}</td>
                <td style={{ padding: "8px", color: w.is_smart_money ? "#00ff88" : "#446688" }}>{w.win_rate_percentage !== undefined ? `${w.win_rate_percentage}%` : "--"}</td>
                <td style={{ padding: "8px", color: "#446688" }}>{w.total_trades}</td>
                <td style={{ padding: "8px" }}><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, fontFamily: "'Share Tech Mono',monospace", background: w.is_smart_money ? "#00ff8811" : "#1a2a3a", color: w.is_smart_money ? "#00ff88" : "#446688", border: `1px solid ${w.is_smart_money ? "#00ff8833" : "#1a2a3a"}` }}>{w.is_smart_money ? "smart money" : "unverified"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChainBadge({ chain }) {
  const label = { ETHEREUM: "ETH", SOLANA: "SOL", POLYGON: "POLY" }[chain] || chain;
  const m = { ETH: ["#627eea22", "#627eea"], ETHEREUM: ["#627eea22", "#627eea"], SOL: ["#9945ff22", "#9945ff"], SOLANA: ["#9945ff22", "#9945ff"], BASE: ["#0052ff22", "#0052ff"], BSC: ["#f3ba2f22", "#f3ba2f"], NATIVE: ["#00cfff22", "#00cfff"] };
  const [bg, col] = m[chain] || ["#33445522", "#446688"];
  return <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: bg, color: col, fontFamily: "'Share Tech Mono',monospace", border: `1px solid ${col}44` }}>{label}</span>;
}
