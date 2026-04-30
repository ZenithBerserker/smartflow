// pages/index.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

const TICKERS = ["PEPE","WIF","BONK","TURBO","FLOKI","DOGE","SOL","ARB","LINK","INJ"];

const SIGNAL_COLORS = {
  HIGH_CONVICTION_BUY: "#16a34a",
  BUY: "#2563eb",
  NO_SIGNAL: "#6b7280",
};

export default function Home() {
  const [selected, setSelected] = useState("TURBO");
  const [zscores, setZscores] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState(["System initialized. Select a ticker and run the pipeline."]);
  const [tick, setTick] = useState(0);

  const addLog = useCallback((msg, type = "") => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLog(prev => [...prev.slice(-50), `[${ts}] ${msg}`]);
  }, []);

  // Fetch Z-scores on mount and every 8s
  useEffect(() => {
    const fetchZ = async () => {
      try {
        const res = await fetch("/api/zscores");
        const data = await res.json();
        setZscores(data.tickers || []);
      } catch (e) {}
    };
    fetchZ();
    const iv = setInterval(() => { fetchZ(); setTick(t => t+1); }, 8000);
    return () => clearInterval(iv);
  }, []);

  const runPipeline = async () => {
    if (loading) return;
    setLoading(true);
    setResult(null);
    addLog(`Initiating pipeline for ${selected}...`);

    try {
      const res = await fetch(`/api/pipeline?ticker=${selected}`);
      const data = await res.json();
      setResult(data);

      data.steps.forEach(s => {
        const status = s.passed ? "PASS" : (s.passed === false ? "FAIL" : "");
        if (s.name === "social_momentum")
          addLog(`Social Z=${s.zscore} — ${status}`, s.passed ? "ok" : "warn");
        if (s.name === "technical_confluence")
          addLog(`RSI=${s.rsi} OBV=${s.obv_signal} — ${status}`, s.passed ? "ok" : "warn");
        if (s.name === "wallet_analysis")
          addLog(`${s.smart_money_count}/${s.wallets_analyzed} smart money wallets — ${status}`, s.passed ? "ok" : "warn");
        if (s.name === "signal_generation")
          addLog(`Signal: ${s.signal} (${s.confidence}%)`, s.passed ? "ok" : "");
      });
    } catch (e) {
      addLog(`Error: ${e.message}`, "err");
    }
    setLoading(false);
  };

  const getStep = (name) => result?.steps?.find(s => s.name === name);
  const s1 = getStep("social_momentum");
  const s2 = getStep("technical_confluence");
  const s3 = getStep("wallet_analysis");
  const s4 = getStep("signal_generation");

  const zscore = zscores.find(z => z.ticker === selected);

  return (
    <>
      <Head>
        <title>SmartFlow — Altcoin Momentum Engine</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={styles.page}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <span style={styles.logo}>SMARTFLOW</span>
            <span style={styles.logoSub}> / altcoin momentum engine</span>
          </div>
          <div style={styles.liveTag}>
            <span style={styles.dot} />
            live · {new Date().toLocaleTimeString()}
          </div>
        </div>

        {/* Ticker bar */}
        <div style={styles.tickerBar}>
          {TICKERS.map(t => {
            const z = zscores.find(z => z.ticker === t);
            const alert = z && z.zscore > 2.0;
            return (
              <button
                key={t}
                style={{
                  ...styles.pill,
                  ...(selected === t ? styles.pillActive : {}),
                  ...(alert && selected !== t ? styles.pillAlert : {}),
                }}
                onClick={() => { setSelected(t); setResult(null); }}
              >
                {t}{alert ? " ▲" : ""}
              </button>
            );
          })}
        </div>

        {/* Metric cards */}
        <div style={styles.grid4}>
          <MetricCard label="Z-score" value={s1 ? s1.zscore.toFixed(2) : (zscore?.zscore?.toFixed(2) || "—")} sub={s1 ? (s1.passed ? "⚡ anomalous" : "normal") : "7d rolling"} accent={s1?.passed} />
          <MetricCard label="mentions/hr" value={s1 ? s1.mentions_1h.toLocaleString() : (zscore ? Math.round(zscore.mentions_1h) : "—")} sub="4chan + reddit + tg" />
          <MetricCard label="RSI" value={s2 ? s2.rsi.toFixed(0) : "—"} sub={s2 ? (s2.rsi > 70 ? "overbought" : "healthy") : "awaiting"} accent={s2 && s2.rsi < 75 && s2.rsi > 40} />
          <MetricCard label="OBV" value={s2 ? (s2.obv_signal === "rising" ? "↑ rising" : "↓ flat") : "—"} sub={s2 ? (s2.obv_signal === "rising" ? "accumulation" : "distribution risk") : "awaiting"} accent={s2?.obv_signal === "rising"} />
        </div>

        {/* Step cards */}
        <div style={styles.grid4}>
          <StepCard num={1} title="social momentum" step={s1} loading={loading && !s1} />
          <StepCard num={2} title="technical confluence" step={s2} loading={loading && s1 && !s2} />
          <StepCard num={3} title="wallet AI analysis" step={s3} loading={loading && s2 && !s3} />
          <StepCard num={4} title="signal generation" step={s4} loading={loading && s3 && !s4} />
        </div>

        {/* Wallet table */}
        {s3 && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>top trader wallets — ai validated</div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.thead}>
                    <th style={styles.th}>wallet</th>
                    <th style={styles.th}>win rate</th>
                    <th style={styles.th}>total pnl</th>
                    <th style={styles.th}>trades</th>
                    <th style={styles.th}>risk</th>
                    <th style={styles.th}>verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {s3.wallet_results.map((w, i) => (
                    <tr key={i} style={styles.tr}>
                      <td style={{...styles.td, fontFamily: "monospace", fontSize: 11, color: "#6b7280"}}>{w.wallet_address}</td>
                      <td style={{...styles.td, color: w.is_smart_money ? "#16a34a" : "inherit"}}>{w.win_rate_percentage}%</td>
                      <td style={{...styles.td, color: w.is_smart_money ? "#16a34a" : "inherit"}}>{w.total_realized_pnl_usd >= 1e6 ? `$${(w.total_realized_pnl_usd/1e6).toFixed(1)}M` : `$${Math.round(w.total_realized_pnl_usd/1000)}K`}</td>
                      <td style={styles.td}>{w.total_trades}</td>
                      <td style={{...styles.td, fontSize: 11}}>{w.risk_classification}</td>
                      <td style={styles.td}>
                        {w.is_smart_money
                          ? <span style={styles.badgeGreen}>smart money ✓</span>
                          : <span style={styles.badgeGray}>unverified</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Signal box + run button */}
        <div style={{
          ...styles.card,
          ...(s4?.passed ? {borderColor: "#16a34a", background: "#f0fdf4"} : {}),
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 16,
        }}>
          <div>
            <div style={styles.sigLabel}>current signal</div>
            <div style={{fontSize: 26, fontWeight: 600, color: SIGNAL_COLORS[s4?.signal] || "#111"}}>
              {s4?.signal?.replace(/_/g, " ") || "—"}
            </div>
            <div style={{fontSize: 12, color: "#6b7280", marginTop: 4, maxWidth: 480}}>
              {s4?.reason || "Select a ticker and run the pipeline to generate a signal."}
            </div>
          </div>
          <div style={{textAlign: "right"}}>
            <div style={styles.sigLabel}>confidence</div>
            <div style={{fontSize: 26, fontWeight: 600}}>{s4 ? `${s4.confidence}%` : "—"}</div>
            <div style={styles.progressWrap}>
              <div style={{...styles.progressFill, width: `${s4?.confidence || 0}%`, background: (s4?.confidence || 0) > 70 ? "#16a34a" : "#2563eb"}} />
            </div>
          </div>
          <button style={{...styles.runBtn, opacity: loading ? 0.6 : 1}} onClick={runPipeline} disabled={loading}>
            {loading ? "running..." : "run pipeline ↗"}
          </button>
        </div>

        {/* Log */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>execution log</div>
          <div style={styles.log}>
            {log.map((l, i) => (
              <div key={i} style={{color: l.includes("PASS") || l.includes("smart money") ? "#16a34a" : l.includes("FAIL") || l.includes("Error") ? "#dc2626" : l.includes("WARN") ? "#d97706" : "#6b7280"}}>
                {l}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          SmartFlow is for research and educational purposes only. Not financial advice. Crypto trading involves substantial risk of loss.
        </div>
      </div>
    </>
  );
}

function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={styles.mcard}>
      <div style={styles.mcardLabel}>{label}</div>
      <div style={{...styles.mcardVal, color: accent ? "#16a34a" : "inherit"}}>{value}</div>
      <div style={styles.mcardSub}>{sub}</div>
    </div>
  );
}

function StepCard({ num, title, step, loading }) {
  const status = !step ? (loading ? "active" : "idle") : step.passed ? "pass" : "fail";
  const borderColor = {pass: "#16a34a", fail: "#dc2626", active: "#2563eb", idle: "#e5e7eb"}[status];

  return (
    <div style={{...styles.stepCard, borderColor}}>
      <div style={styles.stepNum}>step {num}</div>
      <div style={styles.stepTitle}>{title}</div>
      {loading && <div style={{fontSize: 12, color: "#2563eb"}}>analyzing...</div>}
      {step && (
        <>
          <div style={{fontSize: 18, fontWeight: 600, color: status === "pass" ? "#16a34a" : status === "fail" ? "#dc2626" : "inherit"}}>
            {num === 1 && `Z = ${step.zscore}`}
            {num === 2 && `RSI ${step.rsi?.toFixed(0)}`}
            {num === 3 && `${step.smart_money_count}/${step.wallets_analyzed} wallets`}
            {num === 4 && step.signal?.replace(/_/g, " ")}
          </div>
          <div style={{fontSize: 10, color: "#9ca3af", marginTop: 2}}>
            {num === 1 && `${step.mentions_1h} mentions/hr`}
            {num === 2 && `OBV ${step.obv_signal}`}
            {num === 3 && `${Math.round(step.smart_money_ratio * 100)}% smart money`}
            {num === 4 && `${step.confidence}% confidence`}
          </div>
          <span style={{
            display: "inline-block", marginTop: 6, fontSize: 10, padding: "2px 8px",
            borderRadius: 10,
            background: step.passed ? "#dcfce7" : "#fee2e2",
            color: step.passed ? "#16a34a" : "#dc2626",
          }}>
            {step.passed ? "pass ✓" : "fail ✗"}
          </span>
        </>
      )}
    </div>
  );
}

const styles = {
  page: { maxWidth: 960, margin: "0 auto", padding: "20px 16px", fontFamily: "'Courier New', monospace" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 },
  logo: { fontSize: 15, fontWeight: 700, letterSpacing: "0.1em" },
  logoSub: { fontSize: 12, color: "#6b7280" },
  liveTag: { fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 1.8s infinite" },
  tickerBar: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  pill: { padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151" },
  pillActive: { background: "#1e3a8a", borderColor: "#1e3a8a", color: "#dbeafe" },
  pillAlert: { borderColor: "#d97706", color: "#d97706" },
  grid4: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 14 },
  mcard: { background: "#f9fafb", borderRadius: 8, padding: "12px 14px" },
  mcardLabel: { fontSize: 11, color: "#6b7280", marginBottom: 4 },
  mcardVal: { fontSize: 22, fontWeight: 600 },
  mcardSub: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  stepCard: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 },
  stepNum: { fontSize: 10, color: "#9ca3af", marginBottom: 4 },
  stepTitle: { fontSize: 12, fontWeight: 600, marginBottom: 8 },
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  thead: { borderBottom: "1px solid #e5e7eb" },
  th: { padding: "6px 8px", textAlign: "left", fontSize: 10, color: "#9ca3af", fontWeight: 600 },
  tr: { borderBottom: "1px solid #f3f4f6" },
  td: { padding: "8px 8px" },
  badgeGreen: { background: "#dcfce7", color: "#16a34a", fontSize: 10, padding: "2px 8px", borderRadius: 10 },
  badgeGray: { background: "#f3f4f6", color: "#6b7280", fontSize: 10, padding: "2px 8px", borderRadius: 10 },
  sigLabel: { fontSize: 11, color: "#6b7280", marginBottom: 4 },
  progressWrap: { height: 3, background: "#e5e7eb", borderRadius: 2, overflow: "hidden", marginTop: 6, minWidth: 120 },
  progressFill: { height: "100%", borderRadius: 2, transition: "width 0.4s ease" },
  runBtn: { padding: "10px 22px", background: "#1e3a8a", color: "#dbeafe", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  log: { fontFamily: "monospace", fontSize: 11, lineHeight: 1.8, maxHeight: 120, overflowY: "auto", color: "#6b7280" },
  footer: { fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 16, paddingTop: 12, borderTop: "1px solid #f3f4f6" },
};
