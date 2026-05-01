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
      <div style={{ fontSize: 10, color: "#335566", fontFamily: "'Share Tech Mono',monospace", marginBottom: 4 }}>Step {num}</div>
      <div style={{ fontSize: 11, color: "#446688", marginBottom: 8 }}>{title}</div>
      {loading && <div style={{ fontSize: 11, color: "#00cfff", fontFamily: "'Share Tech Mono',monospace" }}>scanning...</div>}
      {step && (
        <>
          <div style={{ fontSize: 17, fontWeight: 700, color: vc, textShadow: `0 0 8px ${vc}66` }}>
            {num === 1 && `Z = ${step.zscore}`}
            {num === 2 && `RSI ${step.rsi?.toFixed(0)}`}
            {num === 3 && (step.signal || "--")}
            {num === 4 && (step.signal?.replace(/_/g, " ") || "--")}
          </div>
          <div style={{ fontSize: 10, color: "#335566", marginTop: 2 }}>
            {num === 1 && `${step.mentions_1h} mentions/hr`}
            {num === 2 && `OBV ${step.obv_signal}`}
            {num === 3 && `${step.bias_score || 0}% long bias`}
            {num === 4 && `${step.confidence}% confidence`}
          </div>
          <span style={{ display: "inline-block", marginTop: 6, fontSize: 10, padding: "2px 8px", borderRadius: 10, fontFamily: "'Share Tech Mono',monospace", background: step.passed ? "#00ff8811" : "#ff446611", color: step.passed ? "#00ff88" : "#ff4466" }}>{step.passed ? "pass" : "fail"}</span>
        </>
      )}
    </div>
  );
}

export function LongShortPanel({ data, loading, onRefresh }) {
  const rows = data?.rows || [];
  const signalColor = data?.signal === "BULLISH" ? "#00ff88" : data?.signal === "BEARISH" ? "#ff4466" : "#00cfff";
  return (
    <div className="longshort-panel" style={{ background: "#0a0f16", border: "1px solid #0d2030", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: "#336688", fontFamily: "'Share Tech Mono',monospace", letterSpacing: ".08em" }}>Futures sentiment</div>
          {loading && <div style={{ fontSize: 9, color: "#00cfff", fontFamily: "'Share Tech Mono',monospace", marginTop: 3 }}>Loading derivatives...</div>}
        </div>
        {onRefresh && <button onClick={onRefresh} disabled={loading} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #1a2a3a", color: "#446688", fontFamily: "'Share Tech Mono',monospace", fontSize: 10, cursor: loading ? "not-allowed" : "pointer", borderRadius: 3 }}>Refresh</button>}
      </div>
      {!loading && !data?.available && (
        <div style={{ padding: "10px 0", color: "#335566", fontFamily: "'Share Tech Mono',monospace", fontSize: 10 }}>
          {data?.reason || "Futures data unavailable."}
        </div>
      )}
      {data?.available && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
            {[
              ["Signal", data.signal, signalColor],
              ["Longs", formatPct(data.account_long_pct), "#00ff88"],
              ["Shorts", formatPct(data.account_short_pct), "#ff4466"],
              ["Funding", `${formatFundingRate(data.funding_rate_pct)}`, fundingColor(data.funding_rate_pct)],
            ].map(([label, value, color]) => (
              <div key={label} style={{ background: "#070a0f", border: "1px solid #0d2030", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 9, color: "#335566", fontFamily: "'Share Tech Mono',monospace", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 15, color, fontWeight: 700, fontFamily: "'Share Tech Mono',monospace" }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "end", gap: 3, height: 58, padding: "8px 0 4px", borderTop: "1px solid #0d2030" }}>
            {rows.map((row) => (
              <div key={row.t} title={`${new Date(row.t).toLocaleString()} long ${row.long_pct}%`} style={{ flex: 1, minWidth: 4, height: `${Math.max(3, row.long_pct)}%`, background: row.long_pct >= 50 ? "#00ff88aa" : "#ff4466aa", borderRadius: "2px 2px 0 0" }} />
            ))}
          </div>
          <div style={{ fontSize: 9, color: "#335566", fontFamily: "'Share Tech Mono',monospace", marginTop: 6 }}>
            {data.symbol} · Binance futures · trend {data.account_trend_pct >= 0 ? "+" : ""}{data.account_trend_pct}%
          </div>
        </>
      )}
      </div>
  );
}

function formatPct(value) {
  return Number.isFinite(value) ? `${value}%` : "--";
}

function formatFundingRate(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(4)}%` : "--";
}

function fundingColor(value) {
  if (!Number.isFinite(value)) return "#00cfff";
  return value > 0 ? "#00ff88" : value < 0 ? "#ff4466" : "#00cfff";
}

export function ChainBadge({ chain }) {
  const label = { ETHEREUM: "ETH", SOLANA: "SOL", POLYGON: "POLY" }[chain] || chain;
  const m = { ETH: ["#627eea22", "#627eea"], ETHEREUM: ["#627eea22", "#627eea"], SOL: ["#9945ff22", "#9945ff"], SOLANA: ["#9945ff22", "#9945ff"], BASE: ["#0052ff22", "#0052ff"], BSC: ["#f3ba2f22", "#f3ba2f"], NATIVE: ["#00cfff22", "#00cfff"] };
  const [bg, col] = m[chain] || ["#33445522", "#446688"];
  return <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: bg, color: col, fontFamily: "'Share Tech Mono',monospace", border: `1px solid ${col}44` }}>{label}</span>;
}
