// Positions tab — institutional low-frequency sniper system
// Drop this into your BlackCat dashboard as a new tab

import { useState, useEffect, useRef } from "react";

// ── Mock data engines ─────────────────────────────────────────────────────────

function computeMacroRegime() {
  // Simulates NH-HMM + monthly candle exhaustion logic
  const regimes = [
    { state: "BULLISH_EXPANSION", label: "Bullish Expansion", color: "#00ff88", risk: "MODERATE", trend: "STRONG UP", rsi: 61.4, mvrv: 2.1, consecutive_red: 0, valid: true },
    { state: "CAPITULATION_RECOVERY", label: "Capitulation Recovery", color: "#00cfff", risk: "LOW", trend: "RECOVERING", rsi: 34.2, mvrv: 0.3, consecutive_red: 5, valid: true },
    { state: "EQUILIBRIUM_ACCUMULATION", label: "Equilibrium Accumulation", color: "#ffaa00", risk: "LOW-MEDIUM", trend: "SIDEWAYS", rsi: 48.7, mvrv: 1.2, consecutive_red: 1, valid: true },
    { state: "BEAR_EXPANSION", label: "Bear Expansion", color: "#ff4466", risk: "EXTREME", trend: "STRONG DOWN", rsi: 28.1, mvrv: 0.8, consecutive_red: 4, valid: false },
    { state: "DISTRIBUTION", label: "Distribution", color: "#ff4466", risk: "HIGH", trend: "TOPPING", rsi: 77.3, mvrv: 3.8, consecutive_red: 0, valid: false },
  ];
  // Deterministic based on current hour
  const idx = Math.floor(Date.now() / (1000 * 60 * 60 * 3)) % regimes.length;
  return regimes[1]; // Show capitulation recovery for demo
}

function computeSmartMoney() {
  const seed = Math.floor(Date.now() / (1000 * 60 * 10));
  const rng = (s) => ((seed * s * 9301 + 49297) % 233280) / 233280;
  const longBias = Math.round(55 + rng(1) * 20);
  const shortBias = 100 - longBias;
  const battleScore = Math.round((longBias - 50) * 2 + rng(2) * 20 - 10);
  const conviction = Math.min(95, Math.round(Math.abs(battleScore) * 0.8 + rng(3) * 20 + 40));

  let status, statusColor;
  if (battleScore > 50) { status = "STRONG LONG"; statusColor = "#00ff88"; }
  else if (battleScore > 20) { status = "LONG"; statusColor = "#00cfff"; }
  else if (battleScore > -20) { status = "NEUTRAL"; statusColor = "#ffaa00"; }
  else if (battleScore > -50) { status = "SHORT"; statusColor = "#ff8844"; }
  else { status = "STRONG SHORT"; statusColor = "#ff4466"; }

  const traders = [
    { name: "0x9aK...f3", roi: 847, sortino: 3.2, wr: 72, bias: "LONG", weight: 0.18 },
    { name: "ByBt...m7", roi: 621, sortino: 2.8, wr: 68, bias: "LONG", weight: 0.15 },
    { name: "OKX...r9", roi: 534, sortino: 4.1, wr: 74, bias: "LONG", weight: 0.22 },
    { name: "0xE2...b4", roi: 389, sortino: 2.1, wr: 65, bias: "NEUTRAL", weight: 0.09 },
    { name: "Bnc...p1", roi: 712, sortino: 3.7, wr: 71, bias: "LONG", weight: 0.19 },
    { name: "0x7c...d8", roi: 298, sortino: 1.9, wr: 61, bias: "SHORT", weight: 0.08 },
  ];

  return { longBias, shortBias, battleScore, conviction, status, statusColor, traders };
}

const MOCK_TRADERS = computeSmartMoney().traders;

function computeFibonacci(btcPrice = 96400) {
  // HTF swing: Oct 2023 low → Nov 2021 high (major cycle)
  const htfLow = 15479, htfHigh = 108353;
  const htfRange = htfHigh - htfLow;
  const htfLevels = {
    "0.236": htfHigh - 0.236 * htfRange,
    "0.382": htfHigh - 0.382 * htfRange,
    "0.500": htfHigh - 0.500 * htfRange,
    "0.618": htfHigh - 0.618 * htfRange,
    "0.705": htfHigh - 0.705 * htfRange,
    "0.786": htfHigh - 0.786 * htfRange,
  };

  // LTF swing: Jan 2025 low → Mar 2025 high
  const ltfLow = 74508, ltfHigh = 109356;
  const ltfRange = ltfHigh - ltfLow;
  const ltfLevels = {
    "0.236": ltfHigh - 0.236 * ltfRange,
    "0.382": ltfHigh - 0.382 * ltfRange,
    "0.500": ltfHigh - 0.500 * ltfRange,
    "0.618": ltfHigh - 0.618 * ltfRange,
    "0.705": ltfHigh - 0.705 * ltfRange,
    "0.786": ltfHigh - 0.786 * ltfRange,
  };

  // Find confluence zones (HTF and LTF within 2% of each other)
  const confluenceZones = [];
  for (const [htfKey, htfVal] of Object.entries(htfLevels)) {
    for (const [ltfKey, ltfVal] of Object.entries(ltfLevels)) {
      const pctDiff = Math.abs(htfVal - ltfVal) / htfVal * 100;
      if (pctDiff < 3.5 && htfKey === ltfKey) {
        const isOTE = ["0.618","0.705","0.786"].includes(htfKey);
        confluenceZones.push({
          level: htfKey, price: (htfVal + ltfVal) / 2,
          htfPrice: htfVal, ltfPrice: ltfVal, isOTE,
          pctFromCurrent: ((htfVal + ltfVal) / 2 - btcPrice) / btcPrice * 100,
        });
      }
    }
  }

  // Find nearest zone
  const sortedZones = [...confluenceZones].sort((a, b) =>
    Math.abs(a.price - btcPrice) - Math.abs(b.price - btcPrice)
  );
  const nearestZone = sortedZones[0];
  const inOTE = nearestZone && ["0.618","0.705","0.786"].includes(nearestZone.level) &&
    Math.abs(nearestZone.price - btcPrice) / btcPrice < 0.05;

  const confluenceScore = confluenceZones.length >= 3 ? 2 : confluenceZones.length >= 1 ? 1 : 0;

  return {
    btcPrice, htfLow, htfHigh, ltfLow, ltfHigh,
    htfLevels, ltfLevels, confluenceZones,
    nearestZone, inOTE, confluenceScore,
    entryQuality: inOTE ? "OPTIMAL" : nearestZone && Math.abs(nearestZone.pctFromCurrent) < 8 ? "APPROACHING" : "OUT OF ZONE",
  };
}

function computeReadiness(regime, smartMoney, fib) {
  if (!regime.valid) return { score: 0, label: "BLOCKED", color: "#ff4466", reason: "Macro regime invalid" };

  const macroScore = regime.valid ? 35 : 0;
  const smScore = smartMoney.conviction > 70 ? 35 : smartMoney.conviction > 50 ? 20 : 10;
  const fibScore = fib.inOTE ? 30 : fib.entryQuality === "APPROACHING" ? 15 : 0;
  const total = macroScore + smScore + fibScore;

  let label, color;
  if (total >= 85) { label = "EXECUTE"; color = "#00ff88"; }
  else if (total >= 65) { label = "STANDBY"; color = "#00cfff"; }
  else if (total >= 40) { label = "WATCHING"; color = "#ffaa00"; }
  else { label = "WAIT"; color: "#ff4466"; color = "#ff4466"; }

  return { score: total, label, color,
    breakdown: { macro: macroScore, smartMoney: smScore, fib: fibScore }
  };
}

function normalizeRegime(data) {
  const fallback = computeMacroRegime();
  return {
    ...fallback,
    ...data,
    rsi: Number.isFinite(data?.rsi) ? data.rsi : fallback.rsi,
    mvrv: Number.isFinite(data?.mvrv) ? data.mvrv : fallback.mvrv,
    consecutive_red: Number.isFinite(data?.consecutive_red) ? data.consecutive_red : fallback.consecutive_red,
    valid: typeof data?.valid === "boolean" ? data.valid : fallback.valid,
    color: data?.color || fallback.color,
    label: data?.label || fallback.label,
    risk: data?.risk || fallback.risk,
    trend: data?.trend || fallback.trend,
  };
}

function normalizeSmartMoney(data) {
  const fallback = computeSmartMoney();
  const longBias = Number.isFinite(data?.longBias)
    ? data.longBias
    : Number.isFinite(data?.globalLong)
      ? data.globalLong
      : fallback.longBias;
  const shortBias = Number.isFinite(data?.shortBias)
    ? data.shortBias
    : Number.isFinite(data?.globalShort)
      ? data.globalShort
      : 100 - longBias;
  return {
    ...fallback,
    ...data,
    longBias,
    shortBias,
    battleScore: Number.isFinite(data?.battleScore) ? data.battleScore : fallback.battleScore,
    conviction: Number.isFinite(data?.conviction) ? data.conviction : fallback.conviction,
    status: data?.status || fallback.status,
    statusColor: data?.statusColor || fallback.statusColor,
    traders: Array.isArray(data?.traders) && data.traders.length > 0 ? data.traders : MOCK_TRADERS,
  };
}

function normalizeFib(data) {
  const fallback = computeFibonacci();
  const btcPrice = Number.isFinite(data?.btcPrice)
    ? data.btcPrice
    : Number.isFinite(data?.currentPrice)
      ? data.currentPrice
      : fallback.btcPrice;
  return {
    ...fallback,
    ...data,
    btcPrice,
    htfLevels: data?.htfLevels && Object.keys(data.htfLevels).length ? data.htfLevels : fallback.htfLevels,
    ltfLevels: data?.ltfLevels && Object.keys(data.ltfLevels).length ? data.ltfLevels : fallback.ltfLevels,
    confluenceZones: Array.isArray(data?.confluenceZones) ? data.confluenceZones : fallback.confluenceZones,
    nearestZone: data?.nearestZone || null,
    inOTE: Boolean(data?.inOTE),
    confluenceScore: Number.isFinite(data?.confluenceScore) ? data.confluenceScore : fallback.confluenceScore,
    entryQuality: data?.entryQuality || fallback.entryQuality,
  };
}

function fmtUSD(n) {
  if (!Number.isFinite(n)) return "--";
  if (n >= 1e6) return "$" + (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + Math.round(n).toLocaleString();
  return "$" + n.toFixed(2);
}

function buildLivePositionPlan(regime, smartMoney, fib, readiness) {
  const current = fib.btcPrice;
  const nearest = fib.nearestZone;
  const longBias = smartMoney.battleScore >= -20;
  const direction = longBias ? "LONG" : "SHORT";
  const entry = nearest?.price || current;
  const riskDistance = Math.max(Math.abs(current - entry), current * 0.025);
  const stop = direction === "LONG" ? entry - riskDistance : entry + riskDistance;
  const target = direction === "LONG"
    ? Math.max(fib.ltfHigh || current * 1.08, entry + riskDistance * 2.5)
    : Math.min(fib.ltfLow || current * 0.92, entry - riskDistance * 2.5);
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  const rr = risk > 0 ? `1:${Math.max(0.1, reward / risk).toFixed(1)}` : "--";

  return {
    active: readiness.score >= 85,
    direction,
    asset: "BTC/USDT",
    entry,
    stop,
    target,
    leverage: readiness.score >= 65 ? 2 : 1,
    rr,
    fibEntry: nearest?.level || "nearest",
    regime: regime.state || regime.label,
    currentPrice: current,
    distanceToEntryPct: Number.isFinite(entry) && Number.isFinite(current) && current > 0
      ? ((entry - current) / current) * 100
      : null,
  };
}

// ── Main Positions Component ───────────────────────────────────────────────

export default function PositionsTab() {
  const [regime, setRegime] = useState(() => normalizeRegime());
  const [smartMoney, setSmartMoney] = useState(() => normalizeSmartMoney());
  const [fib, setFib] = useState(() => normalizeFib());
  const [readiness, setReadiness] = useState(() => computeReadiness(normalizeRegime(), normalizeSmartMoney(), normalizeFib()));
  const [position, setPosition] = useState(() => buildLivePositionPlan(normalizeRegime(), normalizeSmartMoney(), normalizeFib(), computeReadiness(normalizeRegime(), normalizeSmartMoney(), normalizeFib())));
  const cooldownDays = null;
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState("loading...");
  const fibCanvasRef = useRef(null);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      try {
        const [regimeRes, smRes, fibRes] = await Promise.all([
          fetch("/api/regime").then(r => r.json()),
          fetch("/api/smartmoney").then(r => r.json()),
          fetch("/api/fibonacci").then(r => r.json()),
        ]);
        const nextRegime = normalizeRegime(regimeRes);
        const nextSmartMoney = normalizeSmartMoney(smRes);
        const nextFib = normalizeFib(fibRes);
        setRegime(nextRegime);
        setSmartMoney(nextSmartMoney);
        setFib(nextFib);
        const nextReadiness = computeReadiness(nextRegime, nextSmartMoney, nextFib);
        setReadiness(nextReadiness);
        setPosition(buildLivePositionPlan(nextRegime, nextSmartMoney, nextFib, nextReadiness));
        setDataSource([regimeRes.source, smRes.source, fibRes.source].every(source => source && !String(source).includes("mock")) ? "live" : "partial");
      } catch (e) {
        console.error("positions data fetch failed:", e);
        setDataSource("mock");
      }
      setLoading(false);
    }
    fetchAll();
    const iv = setInterval(fetchAll, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(iv);
  }, []);

  // Draw Fibonacci visualization
  useEffect(() => {
    const canvas = fibCanvasRef.current;
    if (!canvas) return;
    const timer = setTimeout(() => drawFib(canvas, fib), 100);
    return () => clearTimeout(timer);
  }, [fib]);

  function drawFib(canvas, fib) {
    if (!fib?.htfLevels || !fib?.ltfLevels || !Number.isFinite(fib.btcPrice)) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement?.offsetWidth || 500;
    const H = 220;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#070a0f";
    ctx.fillRect(0, 0, W, H);

    const pad = { top: 14, bottom: 14, left: 64, right: 80 };
    const cw = W - pad.left - pad.right;
    const ch = H - pad.top - pad.bottom;

    const allPrices = [...Object.values(fib.htfLevels), ...Object.values(fib.ltfLevels), fib.btcPrice];
    const minP = Math.min(...allPrices) * 0.98;
    const maxP = Math.max(...allPrices) * 1.02;
    const toY = p => pad.top + ch - ((p - minP) / (maxP - minP)) * ch;

    // OTE zone fill
    const ote618Y = toY(fib.htfLevels["0.618"]);
    const ote786Y = toY(fib.htfLevels["0.786"]);
    const grad = ctx.createLinearGradient(0, ote618Y, 0, ote786Y);
    grad.addColorStop(0, "#00ff8811");
    grad.addColorStop(1, "#00ff8822");
    ctx.fillStyle = grad;
    ctx.fillRect(pad.left, Math.min(ote618Y, ote786Y), cw, Math.abs(ote786Y - ote618Y));

    // OTE label
    ctx.font = "9px 'Share Tech Mono', monospace";
    ctx.fillStyle = "#00ff8866";
    ctx.textAlign = "left";
    ctx.fillText("OTE ZONE", pad.left + 4, Math.min(ote618Y, ote786Y) - 3);

    // HTF levels
    const htfColors = { "0.236":"#335566","0.382":"#446688","0.500":"#4488aa","0.618":"#00ff88","0.705":"#00ff88","0.786":"#00cfff" };
    for (const [key, price] of Object.entries(fib.htfLevels)) {
      const y = toY(price);
      ctx.strokeStyle = htfColors[key] || "#335566";
      ctx.lineWidth = key === "0.618" || key === "0.786" ? 1.5 : 0.5;
      ctx.setLineDash(key === "0.618" || key === "0.786" ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = htfColors[key] || "#335566";
      ctx.font = "9px 'Share Tech Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(key, pad.left - 4, y + 3);
      ctx.textAlign = "left";
      ctx.fillStyle = "#446688";
      ctx.fillText(fmtUSD(price), W - pad.right + 4, y + 3);
    }

    // Current price line
    const cpY = toY(fib.btcPrice);
    ctx.strokeStyle = "#ffaa00";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(pad.left, cpY); ctx.lineTo(W - pad.right, cpY); ctx.stroke();
    ctx.setLineDash([]);

    // Price label
    ctx.fillStyle = "#ffaa00";
    ctx.font = "bold 10px 'Share Tech Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText("▶ " + fmtUSD(fib.btcPrice), W - pad.right + 72, cpY + 3);

    // Confluence dots
    for (const zone of fib.confluenceZones) {
      const y = toY(zone.price);
      ctx.beginPath();
      ctx.arc(pad.left + cw / 2, y, zone.isOTE ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = zone.isOTE ? "#00ff88" : "#00cfff";
      ctx.fill();
      if (zone.isOTE) {
        ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
      }
    }
  }

  const mono = "'Share Tech Mono', monospace";

  return (
    <div style={{ fontFamily: mono }}>

      {/* Data source badge */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontFamily: mono, color: dataSource === "live" ? "#00ff88" : dataSource === "loading..." ? "#ffaa00" : "#446688", padding: "2px 8px", border: `1px solid ${dataSource === "live" ? "#00ff8833" : "#1a2a3a"}`, borderRadius: 4 }}>
          {loading ? "⟳ fetching live data..." : dataSource === "live" ? "◉ live — public market data" : "◎ partial live data"}
        </span>
      </div>

      {/* Trade Readiness Banner */}
      <div className="positions-readiness" style={{ background: readiness.score >= 85 ? "#00ff8811" : "#0a0f16", border: `1px solid ${readiness.color}44`, borderRadius: 8, padding: "14px 20px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "#335566", marginBottom: 4, letterSpacing: ".12em" }}>TRADE READINESS METER</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: readiness.color, textShadow: `0 0 20px ${readiness.color}66`, lineHeight: 1 }}>{readiness.score}<span style={{ fontSize: 16, color: "#446688" }}>/100</span></div>
          <div style={{ fontSize: 11, color: readiness.color, marginTop: 4, letterSpacing: ".08em" }}>{readiness.score >= 85 ? "⚡ EXECUTION THRESHOLD REACHED" : readiness.score >= 65 ? "◉ MONITORING — APPROACHING SETUP" : "◎ WAITING FOR HIGH-CONVICTION SETUP"}</div>
        </div>
        <div className="positions-readiness-bars" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ReadinessBar label="MACRO" score={readiness.breakdown?.macro || 0} max={35} color="#00cfff" />
          <ReadinessBar label="SMART MONEY" score={readiness.breakdown?.smartMoney || 0} max={35} color="#ffaa00" />
          <ReadinessBar label="FIB ZONE" score={readiness.breakdown?.fib || 0} max={30} color="#00ff88" />
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#335566", marginBottom: 4 }}>COOLDOWN</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#446688" }}>{cooldownDays === null ? "--" : `${cooldownDays}d`}</div>
          <div style={{ fontSize: 10, color: "#335566" }}>account not connected</div>
          <div style={{ fontSize: 10, color: "#335566", marginTop: 4 }}>quota: live signal only</div>
        </div>
      </div>

      <div className="positions-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>

        {/* Macro Regime */}
        <div style={{ background: "#0a0f16", border: `1px solid ${regime.valid ? "#0d2030" : "#ff446633"}`, borderRadius: 8, padding: 14 }}>
          <SectionHeader title="MACRO REGIME" />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: regime.color, boxShadow: `0 0 10px ${regime.color}` }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: regime.color, textShadow: `0 0 10px ${regime.color}55` }}>{regime.label}</div>
            {!regime.valid && <span style={{ fontSize: 9, padding: "2px 8px", background: "#ff446622", color: "#ff4466", borderRadius: 4, border: "1px solid #ff446644" }}>ENTRIES BLOCKED</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              ["MONTHLY RSI", regime.rsi.toFixed(1), regime.rsi < 35 ? "#00ff88" : regime.rsi > 70 ? "#ff4466" : "#99bbcc"],
              ["MVRV Z-SCORE", regime.mvrv.toFixed(2), regime.mvrv < 1 ? "#00ff88" : regime.mvrv > 3.5 ? "#ff4466" : "#99bbcc"],
              ["RISK LEVEL", regime.risk, regime.risk === "LOW" ? "#00ff88" : regime.risk === "EXTREME" ? "#ff4466" : "#ffaa00"],
              ["CONSEC RED", regime.consecutive_red + " months", regime.consecutive_red >= 5 ? "#00ff88" : "#99bbcc"],
              ["TREND", regime.trend, regime.trend.includes("UP") || regime.trend.includes("RECOV") ? "#00ff88" : regime.trend.includes("DOWN") ? "#ff4466" : "#ffaa00"],
              ["REGIME VALID", regime.valid ? "YES ✓" : "NO ✗", regime.valid ? "#00ff88" : "#ff4466"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: "#070a0f", borderRadius: 4, padding: "6px 8px" }}>
                <div style={{ fontSize: 9, color: "#335566", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: c }}>{v}</div>
              </div>
            ))}
          </div>
          {regime.consecutive_red >= 5 && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "#00ff8811", border: "1px solid #00ff8833", borderRadius: 4, fontSize: 10, color: "#00ff88" }}>
              ⚡ {regime.consecutive_red} consecutive red months — historical capitulation signal
            </div>
          )}
        </div>

        {/* Smart Money */}
        <div style={{ background: "#0a0f16", border: "1px solid #0d2030", borderRadius: 8, padding: 14 }}>
          <SectionHeader title="SMART MONEY POSITIONING" />
          <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: "#335566", marginBottom: 4 }}>LONG / SHORT DISTRIBUTION</div>
              <div style={{ height: 8, background: "#0d2030", borderRadius: 4, overflow: "hidden", marginBottom: 3 }}>
                <div style={{ height: "100%", width: smartMoney.longBias + "%", background: "linear-gradient(90deg, #00ff88, #00cfff)", borderRadius: 4, transition: "width .4s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                <span style={{ color: "#00ff88" }}>LONG {smartMoney.longBias}%</span>
                <span style={{ color: "#ff4466" }}>SHORT {smartMoney.shortBias}%</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
            {[
              ["BATTLE SCORE", (smartMoney.battleScore > 0 ? "+" : "") + smartMoney.battleScore, smartMoney.battleScore > 20 ? "#00ff88" : smartMoney.battleScore < -20 ? "#ff4466" : "#ffaa00"],
              ["CONVICTION", smartMoney.conviction + "%", smartMoney.conviction > 70 ? "#00ff88" : "#ffaa00"],
              ["TRADERS TRACKED", "28 qualified", "#99bbcc"],
              ["SORTINO FILTER", "≥ 2.0", "#99bbcc"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: "#070a0f", borderRadius: 4, padding: "6px 8px" }}>
                <div style={{ fontSize: 9, color: "#335566", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: c }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 10px", background: `${smartMoney.statusColor}11`, border: `1px solid ${smartMoney.statusColor}33`, borderRadius: 4, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#335566", marginBottom: 2 }}>SMART MONEY STATUS</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: smartMoney.statusColor, textShadow: `0 0 12px ${smartMoney.statusColor}66`, letterSpacing: ".1em" }}>{smartMoney.status}</div>
          </div>
          {/* Top traders mini table */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 9, color: "#335566", marginBottom: 4, display: "grid", gridTemplateColumns: "1fr 50px 50px 40px 50px", gap: 4 }}>
              <span>TRADER</span><span>ROI</span><span>SORTINO</span><span>WR</span><span>BIAS</span>
            </div>
            {(smartMoney.traders || MOCK_TRADERS).slice(0, 4).map((t, i) => (
              <div key={i} style={{ fontSize: 10, display: "grid", gridTemplateColumns: "1fr 50px 50px 40px 50px", gap: 4, padding: "3px 0", borderBottom: "1px solid #0a1520" }}>
                <span style={{ color: "#446688" }}>{t.name}</span>
                <span style={{ color: "#00cfff" }}>+{t.roi}%</span>
                <span style={{ color: t.sortino >= 3 ? "#00ff88" : "#99bbcc" }}>{t.sortino.toFixed(1)}</span>
                <span style={{ color: "#99bbcc" }}>{t.wr}%</span>
                <span style={{ color: t.bias === "LONG" ? "#00ff88" : t.bias === "SHORT" ? "#ff4466" : "#ffaa00", fontSize: 9 }}>{t.bias}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fibonacci Strike Zone — full width */}
      <div style={{ background: "#0a0f16", border: "1px solid #0d2030", borderRadius: 8, padding: 14, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <SectionHeader title="FIBONACCI STRIKE ZONE" />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ padding: "4px 12px", borderRadius: 4, fontSize: 11, fontFamily: mono, background: `${fib.entryQuality === "OPTIMAL" ? "#00ff88" : fib.entryQuality === "APPROACHING" ? "#ffaa00" : "#ff4466"}11`, border: `1px solid ${fib.entryQuality === "OPTIMAL" ? "#00ff8844" : fib.entryQuality === "APPROACHING" ? "#ffaa0044" : "#ff446644"}`, color: fib.entryQuality === "OPTIMAL" ? "#00ff88" : fib.entryQuality === "APPROACHING" ? "#ffaa00" : "#ff4466" }}>
              {fib.entryQuality}
            </div>
            <div style={{ padding: "4px 12px", borderRadius: 4, fontSize: 11, background: "#0d2030", color: "#99bbcc" }}>
              CONFLUENCE: {fib.confluenceScore === 2 ? "STRONG" : fib.confluenceScore === 1 ? "WEAK" : "NONE"}
            </div>
          </div>
        </div>
        <div className="positions-fib-grid" style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 12 }}>
          <div>
            <canvas className="positions-canvas" ref={fibCanvasRef} width={500} height={220} style={{ width: "100%", height: "220px", display: "block" }} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#335566", marginBottom: 8 }}>CONFLUENCE ZONES</div>
            {fib.confluenceZones.length > 0 ? fib.confluenceZones.map((z, i) => (
              <div key={i} style={{ padding: "6px 10px", marginBottom: 4, borderRadius: 4, background: z.isOTE ? "#00ff8811" : "#070a0f", border: `1px solid ${z.isOTE ? "#00ff8833" : "#0d2030"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: z.isOTE ? "#00ff88" : "#446688", fontWeight: z.isOTE ? 700 : 400 }}>{z.level} {z.isOTE ? "⟵ OTE" : ""}</span>
                  <span style={{ fontSize: 10, color: "#99bbcc" }}>{fmtUSD(z.price)}</span>
                </div>
                <div style={{ fontSize: 9, color: z.pctFromCurrent > 0 ? "#ff4466" : "#00ff88", marginTop: 2 }}>
                  {z.pctFromCurrent > 0 ? "↑ " : "↓ "}{Math.abs(z.pctFromCurrent).toFixed(1)}% from current
                </div>
              </div>
            )) : (
              <div style={{ fontSize: 10, color: "#335566", padding: "12px 0" }}>No confluence zones identified</div>
            )}
            <div style={{ marginTop: 8, padding: "6px 10px", background: "#070a0f", borderRadius: 4, border: "1px solid #0d2030" }}>
              <div style={{ fontSize: 9, color: "#335566", marginBottom: 2 }}>NEAREST ZONE</div>
              {fib.nearestZone ? (
                <>
                  <div style={{ fontSize: 12, color: "#00cfff" }}>{fmtUSD(fib.nearestZone.price)} ({fib.nearestZone.level})</div>
                  <div style={{ fontSize: 9, color: "#446688" }}>{Math.abs(fib.nearestZone.pctFromCurrent).toFixed(1)}% {fib.nearestZone.pctFromCurrent > 0 ? "above" : "below"} price</div>
                </>
              ) : <div style={{ fontSize: 10, color: "#446688" }}>—</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="positions-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>

        {/* Live Position Plan */}
        <div style={{ background: "#0a0f16", border: `1px solid ${position.active ? "#00ff8833" : "#0d2030"}`, borderRadius: 8, padding: 14, boxShadow: position.active ? "0 0 20px #00ff8811" : "none" }}>
          <SectionHeader title="LIVE POSITION PLAN" />
          <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ padding: "3px 10px", background: position.active ? "#00ff8811" : "#070a0f", border: `1px solid ${position.active ? "#00ff8833" : "#0d2030"}`, borderRadius: 4, fontSize: 12, fontWeight: 700, color: position.active ? "#00ff88" : "#446688" }}>{position.active ? position.direction : "NO LIVE ENTRY"}</span>
                <span style={{ fontSize: 14, color: "#c8d8e8" }}>{position.asset}</span>
                <span style={{ fontSize: 11, color: "#446688" }}>×{position.leverage}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  ["ENTRY", fmtUSD(position.entry), "#99bbcc"],
                  ["STOP LOSS", fmtUSD(position.stop), "#ff4466"],
                  ["TARGET", fmtUSD(position.target), "#00ff88"],
                  ["RISK/REWARD", position.rr, "#00cfff"],
                  ["CURRENT", fmtUSD(position.currentPrice), "#ffaa00"],
                  ["ENTRY DIST", Number.isFinite(position.distanceToEntryPct) ? `${position.distanceToEntryPct > 0 ? "+" : ""}${position.distanceToEntryPct.toFixed(1)}%` : "--", "#ffaa00"],
                  ["FIB ENTRY", position.fibEntry + " level", "#00cfff"],
                  ["REGIME", position.regime.replace(/_/g," "), "#99bbcc"],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: "#070a0f", borderRadius: 4, padding: "6px 8px" }}>
                    <div style={{ fontSize: 9, color: "#335566", marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
              {!position.active && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "#070a0f", border: "1px solid #0d2030", borderRadius: 4, fontSize: 10, color: "#446688" }}>
                  No exchange account is connected, so this panel shows the live BTC setup plan only. An entry becomes active here when all signal gates reach execution threshold.
                </div>
              )}
            </>
        </div>

        {/* Signal gate status */}
        <div style={{ background: "#0a0f16", border: "1px solid #0d2030", borderRadius: 8, padding: 14 }}>
          <SectionHeader title="SIGNAL GATE STATUS" />
          <div style={{ marginBottom: 10 }}>
            {[
              ["GATEWAY 1", "Macro Regime Valid", regime.valid, regime.valid ? "NH-HMM: CAPITULATION_RECOVERY" : "BLOCKED — BEAR EXPANSION"],
              ["GATEWAY 2", "Smart Money Aligned", smartMoney.battleScore > 20, `Battle Score: ${smartMoney.battleScore > 0 ? "+" : ""}${smartMoney.battleScore}`],
              ["GATEWAY 3", "Fibonacci Strike Zone", fib.inOTE, fib.inOTE ? "Price in OTE zone" : `${Math.abs(fib.nearestZone?.pctFromCurrent || 0).toFixed(1)}% from nearest zone`],
              ["GATEWAY 4", "Account Position", position.active, position.active ? "Signal plan is executable" : "No connected exchange position"],
            ].map(([id, label, pass, detail]) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginBottom: 4, borderRadius: 4, background: pass ? "#00ff8808" : "#070a0f", border: `1px solid ${pass ? "#00ff8822" : "#0d2030"}` }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: pass ? "#00ff88" : "#335566", boxShadow: pass ? "0 0 6px #00ff88" : "none", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, color: pass ? "#c8d8e8" : "#446688" }}>{label}</span>
                    <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: pass ? "#00ff8811" : "#1a2a3a", color: pass ? "#00ff88" : "#446688" }}>{pass ? "PASS" : "WAIT"}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "#335566", marginTop: 1 }}>{detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: "10px 12px", borderRadius: 4, background: readiness.score >= 85 ? "#00ff8811" : "#070a0f", border: `1px solid ${readiness.score >= 85 ? "#00ff8833" : "#0d2030"}`, textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#335566", marginBottom: 4 }}>SYSTEM STATUS</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: readiness.score >= 85 ? "#00ff88" : "#446688", letterSpacing: ".08em" }}>
              {readiness.score >= 85 ? "⚡ READY TO EXECUTE" : "◎ WAITING FOR HIGH-CONVICTION SETUP"}
            </div>
            <div style={{ fontSize: 9, color: "#335566", marginTop: 4 }}>max 1 trade / month · 2x–3x leverage only</div>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ fontSize: 10, color: "#1a2a3a", textAlign: "center", padding: "8px 0", fontFamily: mono }}>
        POSITIONS TAB — for research only · not financial advice · market signals use public live data, account positions require exchange integration
      </div>
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div style={{ fontSize: 10, color: "#336688", fontFamily: "'Share Tech Mono', monospace", letterSpacing: ".1em", marginBottom: 10, borderBottom: "1px solid #0d2030", paddingBottom: 6 }}>
      {title}
    </div>
  );
}

function ReadinessBar({ label, score, max, color }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div style={{ textAlign: "center", minWidth: 60 }}>
      <div style={{ fontSize: 8, color: "#335566", marginBottom: 4 }}>{label}</div>
      <div style={{ position: "relative", width: 44, height: 44, margin: "0 auto" }}>
        <svg width={44} height={44} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={22} cy={22} r={18} fill="none" stroke="#0d2030" strokeWidth={3} />
          <circle cx={22} cy={22} r={18} fill="none" stroke={color} strokeWidth={3}
            strokeDasharray={`${2 * Math.PI * 18 * pct / 100} ${2 * Math.PI * 18 * (1 - pct / 100)}`}
            style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color, fontFamily: "'Share Tech Mono', monospace" }}>
          {score}
        </div>
      </div>
      <div style={{ fontSize: 8, color: "#335566", marginTop: 2 }}>/{max}</div>
    </div>
  );
}
