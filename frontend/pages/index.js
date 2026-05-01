import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import { ChainBadge, LongShortPanel, NCard, SCard } from "../components/DashboardWidgets";
import { fmtNum, fmtPrice } from "../lib/format";
import { TRACKED_TICKERS } from "../lib/tokens";

const SIGNAL_COLORS = { HIGH_CONVICTION_BUY:"#00ff88", BUY:"#00cfff", NO_SIGNAL:"#334455" };
const FIB_COLORS = { BUY:"#00ff88", SELL:"#ff4466", NEUTRAL:"#00cfff" };

export default function Home() {
  const [selected,setSelected]=useState("TURBO");
  const [zscores,setZscores]=useState([]);
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [log,setLog]=useState(["system initialized. select ticker and run pipeline."]);
  const [tab,setTab]=useState("pipeline");
  const [lookupQuery,setLookupQuery]=useState("");
  const [lookupResult,setLookupResult]=useState(null);
  const [lookupLoading,setLookupLoading]=useState(false);
  const [newTokens,setNewTokens]=useState([]);
  const [mentionData,setMentionData]=useState(null);
  const [mentionLoading,setMentionLoading]=useState(false);
  const [priceData,setPriceData]=useState(null);
  const [priceLoading,setPriceLoading]=useState(false);
  const [longShortData,setLongShortData]=useState(null);
  const [longShortLoading,setLongShortLoading]=useState(false);
  const [chartTf,setChartTf]=useState("24h");
  const [chartDrawMode,setChartDrawMode]=useState(false);
  const [chartRevision,setChartRevision]=useState(0);
  const logRef=useRef(null);
  const chartRef=useRef(null);
  const chartGeomRef=useRef(null);
  const chartHoverRef=useRef(null);
  const chartLinesRef=useRef([]);
  const chartDraftRef=useRef(null);

  const addLog=useCallback((msg)=>{
    const ts=new Date().toLocaleTimeString("en-US",{hour12:false});
    setLog(p=>[...p.slice(-60),`[${ts}] ${msg}`]);
  },[]);

  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },[log]);

  useEffect(()=>{
    const f=async()=>{ try{ const r=await fetch("/api/zscores"); const d=await r.json(); setZscores(d.tickers||[]); }catch{} };
    f(); const iv=setInterval(f,15000); return()=>clearInterval(iv);
  },[]);

  useEffect(()=>{
    const f=async()=>{ try{ const r=await fetch("/api/discover"); const d=await r.json(); setNewTokens(d.tokens||[]); }catch{} };
    f(); const iv=setInterval(f,60000); return()=>clearInterval(iv);
  },[]);

  useEffect(()=>{
    setResult(null);
    chartLinesRef.current=[];
    chartDraftRef.current=null;
    chartHoverRef.current=null;
    setChartRevision(v=>v+1);
    fetchPrice(selected);
    fetchLongShort(selected);
    fetchMentions(selected);
  },[selected]);

  useEffect(()=>{
    chartLinesRef.current=[];
    chartDraftRef.current=null;
    chartHoverRef.current=null;
    setChartRevision(v=>v+1);
  },[chartTf]);

  const fetchPrice=async(ticker, timeframe)=>{
    setPriceLoading(true);
    const tf = timeframe || chartTf;
    try{
      const r=await fetch(`/api/price?ticker=${ticker}&tf=${tf}`);
      const d=await r.json();
      setPriceData(d);
    }catch(e){ console.error(e); }
    setPriceLoading(false);
  };

  const fetchLongShort=async(ticker)=>{
    setLongShortLoading(true);
    try{
      const r=await fetch(`/api/longshort?ticker=${ticker}`);
      const d=await r.json();
      setLongShortData(d);
      addLog(`long/short loaded for ${ticker}`);
    }catch(e){
      setLongShortData({available:false,source:"error",reason:e.message});
      addLog(`long/short error: ${e.message}`);
    }
    setLongShortLoading(false);
  };

  const fetchMentions=async(ticker, force=false)=>{
    setMentionLoading(true);
    try{
      const r=await fetch(`/api/mentions${force?"?force=1":""}`);
      const d=await r.json();
      const normalized=ticker.toUpperCase();
      const sourceCounts=Object.fromEntries((d.sources||[]).map(source=>[source.source, source.counts?.[normalized]||0]));
      setMentionData({
        ticker: normalized,
        total: d.counts?.[normalized]||0,
        source_counts: sourceCounts,
        sources: d.sources||[],
        source: d.source,
        timestamp: d.timestamp,
        error: d.error,
      });
    }catch(e){
      setMentionData({ticker:ticker.toUpperCase(),total:0,source_counts:{},error:e.message});
      addLog(`mentions error: ${e.message}`);
    }
    setMentionLoading(false);
  };

  // Draw candlestick chart using canvas
  useEffect(()=>{
    if(!priceData?.candles||!chartRef.current) return;
    // Small delay to ensure DOM is laid out
    const timer = setTimeout(drawChart, 50);
    return () => clearTimeout(timer);
  },[priceData,chartTf,chartRevision,chartDrawMode]);

  const drawChart = () => {
    if(!priceData?.candles||!chartRef.current) return;
    const canvas=chartRef.current;
    const dpr=window.devicePixelRatio||1;
    const W=canvas.parentElement?.offsetWidth||600;
    const H=parseInt(getComputedStyle(canvas).height,10)||200;
    canvas.width=W*dpr; canvas.height=H*dpr;
    canvas.style.width=W+"px"; canvas.style.height=H+"px";
    const ctx=canvas.getContext("2d");
    ctx.scale(dpr,dpr);

    const candles=priceData.candles;
    if(candles.length===0){
      ctx.fillStyle="#070a0f";
      ctx.fillRect(0,0,W,H);
      ctx.fillStyle="#335566";
      ctx.font="11px 'Share Tech Mono',monospace";
      ctx.textAlign="center";
      ctx.fillText("live candle data unavailable",W/2,H/2);
      return;
    }
    const pad={top:16,right:60,bottom:28,left:8};
    const cw=W-pad.left-pad.right, ch=H-pad.top-pad.bottom;

    const prices=candles.flatMap(c=>[c.h,c.l]);
    const minP=Math.min(...prices), maxP=Math.max(...prices);
    const range=maxP-minP||maxP*0.01;

    const toY=p=>pad.top+ch-(((p-minP)/range)*ch);
    const toX=i=>pad.left+(i/candles.length)*cw+(cw/candles.length)*0.5;
    const priceFromY=y=>maxP-(((y-pad.top)/ch)*(maxP-minP));
    const candleW=Math.max(2,(cw/candles.length)*0.65);
    chartGeomRef.current={W,H,pad,cw,ch,minP,maxP,toX,toY,priceFromY,candleCount:candles.length};

    // Background grid
    ctx.fillStyle="#070a0f";
    ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#0d2030";
    ctx.lineWidth=0.5;
    for(let i=0;i<=4;i++){
      const y=pad.top+(ch/4)*i;
      ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
      const p=maxP-((maxP-minP)/4)*i;
      ctx.fillStyle="#335566";
      ctx.font="9px 'Share Tech Mono',monospace";
      ctx.textAlign="left";
      ctx.fillText(fmtPrice(p),W-pad.right+4,y+3);
    }

    // Candles
    candles.forEach((c,i)=>{
      const x=toX(i);
      const isGreen=c.c>=c.o;
      const color=isGreen?"#00ff88":"#ff4466";
      const glow=isGreen?"#00ff8844":"#ff446644";

      ctx.shadowBlur=4; ctx.shadowColor=glow;
      ctx.strokeStyle=color; ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(x,toY(c.h)); ctx.lineTo(x,toY(c.l));
      ctx.stroke();

      const bodyTop=toY(Math.max(c.o,c.c));
      const bodyH=Math.max(1,Math.abs(toY(c.o)-toY(c.c)));
      ctx.fillStyle=color;
      ctx.shadowBlur=6; ctx.shadowColor=glow;
      ctx.fillRect(x-candleW/2,bodyTop,candleW,bodyH);
    });

    ctx.shadowBlur=0;

    // User drawings
    const drawLine=(line,isDraft=false)=>{
      const x1=toX(line.i1), y1=toY(line.p1), x2=toX(line.i2), y2=toY(line.p2);
      ctx.strokeStyle=isDraft?"#ffaa00":"#00cfff";
      ctx.lineWidth=isDraft?1:1.5;
      ctx.setLineDash(isDraft?[4,4]:[]);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle=isDraft?"#ffaa00":"#00cfff";
      [[x1,y1],[x2,y2]].forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();});
    };
    chartLinesRef.current.forEach(line=>drawLine(line,false));
    if(chartDraftRef.current) drawLine(chartDraftRef.current,true);

    // Hover crosshair and tooltip
    const hover=chartHoverRef.current;
    if(hover&&hover.index>=0&&hover.index<candles.length){
      const c=candles[hover.index];
      const x=toX(hover.index), y=toY(c.c);
      ctx.strokeStyle="#446688";
      ctx.lineWidth=0.75;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(x,pad.top); ctx.lineTo(x,H-pad.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
      ctx.setLineDash([]);

      const d=new Date(c.t);
      const lines=[
        d.toLocaleString(undefined,{month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}),
        `O ${fmtPrice(c.o)}  H ${fmtPrice(c.h)}`,
        `L ${fmtPrice(c.l)}  C ${fmtPrice(c.c)}`,
        `V ${fmtNum(c.v)}`,
      ];
      const boxW=178, boxH=68;
      const boxX=Math.min(Math.max(hover.x+12,8),W-boxW-8);
      const boxY=Math.min(Math.max(hover.y-10,8),H-boxH-8);
      ctx.fillStyle="#070a0fee";
      ctx.strokeStyle="#1a2a3a";
      ctx.lineWidth=1;
      ctx.fillRect(boxX,boxY,boxW,boxH);
      ctx.strokeRect(boxX,boxY,boxW,boxH);
      ctx.font="10px 'Share Tech Mono',monospace";
      ctx.textAlign="left";
      lines.forEach((line,i)=>{
        ctx.fillStyle=i===0?"#00cfff":"#99bbcc";
        ctx.fillText(line,boxX+8,boxY+16+i*13);
      });
    }

    // Time labels
    ctx.fillStyle="#335566";
    ctx.font="9px 'Share Tech Mono',monospace";
    ctx.textAlign="center";
    const step=Math.max(1,Math.floor(candles.length/6));
    for(let i=0;i<candles.length;i+=step){
      const x=toX(i);
      const d=new Date(candles[i].t);
      ctx.fillText(`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`,x,H-8);
    }
    };

  const getCanvasPoint=(event)=>{
    const canvas=chartRef.current;
    const geom=chartGeomRef.current;
    if(!canvas||!geom||!priceData?.candles?.length) return null;
    const rect=canvas.getBoundingClientRect();
    const x=event.clientX-rect.left;
    const y=event.clientY-rect.top;
    const raw=((x-geom.pad.left)/geom.cw)*priceData.candles.length;
    const index=Math.min(priceData.candles.length-1,Math.max(0,Math.floor(raw)));
    const price=geom.priceFromY(Math.min(geom.H-geom.pad.bottom,Math.max(geom.pad.top,y)));
    return {x,y,index,price};
  };

  const handleChartMove=(event)=>{
    const point=getCanvasPoint(event);
    if(!point) return;
    chartHoverRef.current=point;
    if(chartDraftRef.current){
      chartDraftRef.current={...chartDraftRef.current,i2:point.index,p2:point.price};
    }
    drawChart();
  };

  const handleChartLeave=()=>{
    chartHoverRef.current=null;
    if(!chartDraftRef.current) drawChart();
  };

  const handleChartClick=(event)=>{
    if(!chartDrawMode) return;
    const point=getCanvasPoint(event);
    if(!point) return;
    if(!chartDraftRef.current){
      chartDraftRef.current={i1:point.index,p1:point.price,i2:point.index,p2:point.price};
    }else{
      chartLinesRef.current=[...chartLinesRef.current,{...chartDraftRef.current,i2:point.index,p2:point.price}];
      chartDraftRef.current=null;
    }
    setChartRevision(v=>v+1);
  };

  const clearChartDrawings=()=>{
    chartLinesRef.current=[];
    chartDraftRef.current=null;
    setChartRevision(v=>v+1);
  };

  const runPipeline=async()=>{
    if(loading)return; setLoading(true); setResult(null); addLog(`initiating pipeline for ${selected}...`);
    try{
      const r=await fetch(`/api/pipeline?ticker=${selected}`); const d=await r.json(); setResult(d);
      d.steps?.forEach(s=>{
        if(s.name==="social_momentum") addLog(`social z=${s.zscore} — ${s.passed?"PASS":"FAIL"}`);
        if(s.name==="technical_confluence") addLog(`RSI=${s.rsi} OBV=${s.obv_signal} — ${s.passed?"PASS":"FAIL"}`);
        if(s.name==="long_short_sentiment") addLog(`long/short ${s.signal} ${s.bias_score}% — ${s.passed?"PASS":"FAIL"}`);
        if(s.name==="signal_generation") addLog(`signal: ${s.signal} (${s.confidence}%)`);
      });
    }catch(e){ addLog(`error: ${e.message}`); }
    setLoading(false);
  };

  const runLookup=async()=>{
    if(!lookupQuery.trim()||lookupLoading)return; setLookupLoading(true); setLookupResult(null);
    addLog(`looking up: ${lookupQuery.toUpperCase()}...`);
    try{
      const [pipeRes,priceRes]=await Promise.all([
        fetch(`/api/pipeline?ticker=${lookupQuery.trim().toUpperCase()}`),
        fetch(`/api/price?ticker=${lookupQuery.trim().toUpperCase()}`),
      ]);
      const [pipeData,priceD]=await Promise.all([pipeRes.json(),priceRes.json()]);
      const liveMentions=await fetchMentionsForTicker(lookupQuery.trim().toUpperCase(),true);
      setLookupResult({...pipeData,changes:{},mentions:liveMentions,price:priceD});
      addLog(`lookup done: ${lookupQuery.toUpperCase()} — ${pipeData.signal?.signal||"no signal"}`);
    }catch(e){ addLog(`lookup error: ${e.message}`); }
    setLookupLoading(false);
  };

  const fetchMentionsForTicker=async(ticker, force=false)=>{
    const r=await fetch(`/api/mentions${force?"?force=1":""}`);
    const d=await r.json();
    const normalized=ticker.toUpperCase();
    return {
      ticker: normalized,
      total: d.counts?.[normalized]||0,
      source_counts: Object.fromEntries((d.sources||[]).map(source=>[source.source, source.counts?.[normalized]||0])),
      timestamp: d.timestamp,
      source: d.source,
      error: d.error,
    };
  };

  const getStep=(n)=>result?.steps?.find(s=>s.name===n);
  const s1=getStep("social_momentum"),s2=getStep("technical_confluence"),s3=getStep("long_short_sentiment"),s4=getStep("signal_generation");
  const zs=zscores.find(z=>z.ticker===selected);
  const pc=priceData?.price_change?.h24||0;
  const liveRsi=s2?.rsi??priceData?.technicals?.rsi;
  const liveObv=s2?.obv_signal||priceData?.technicals?.obv_signal;
  const fibSignal=priceData?.fib_signal;

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#070a0f;color:#c8d8e8;font-family:'Rajdhani',sans-serif}
    ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0d1117}::-webkit-scrollbar-thumb{background:#00ff8844;border-radius:2px}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    @keyframes flicker{0%,100%{opacity:1}92%{opacity:.97}94%{opacity:.88}96%{opacity:.97}}
    .tab-btn{padding:6px 16px;background:transparent;border:1px solid #1a2a3a;color:#446688;font-family:'Share Tech Mono',monospace;font-size:11px;cursor:pointer;transition:all .2s;border-radius:4px;letter-spacing:.05em}
    .tab-btn.active{border-color:#00ff88;color:#00ff88;box-shadow:0 0 10px #00ff8833}
    .tab-btn:hover:not(.active){border-color:#2a4a6a;color:#99bbcc}
    .tf-btn{padding:3px 10px;background:transparent;border:1px solid #1a2a3a;color:#446688;font-family:'Share Tech Mono',monospace;font-size:10px;cursor:pointer;border-radius:3px;transition:all .15s}
    .tf-btn.active{border-color:#00cfff55;color:#00cfff;background:#00cfff11}
    input::placeholder{color:#223344}
    input:focus{outline:none}
    @media (max-width: 640px){
      .app-shell{padding:12px 10px!important;max-width:100%!important}
      .app-header{align-items:flex-start!important;margin-bottom:12px!important;gap:8px!important}
      .brand-row{gap:8px!important;min-width:0!important}
      .brand-title{font-size:20px!important;letter-spacing:.08em!important}
      .brand-subtitle{font-size:9px!important;max-width:150px!important;line-height:1.2!important}
      .live-status{width:100%!important;justify-content:flex-start!important;font-size:9px!important}
      .tabs{gap:6px!important;margin-bottom:12px!important;overflow-x:auto!important;padding-bottom:2px!important}
      .tab-btn{flex:1 0 auto!important;padding:7px 10px!important;font-size:10px!important;text-align:center!important;white-space:nowrap!important}
      .ticker-bar{gap:5px!important;margin-bottom:10px!important;max-height:76px!important;overflow-y:auto!important}
      .ticker-btn{padding:5px 8px!important;font-size:10px!important;min-width:45px!important}
      .price-chart-grid{grid-template-columns:1fr!important;gap:8px!important;margin-bottom:10px!important}
      .panel{padding:10px 11px!important;border-radius:6px!important}
      .price-value{font-size:24px!important;line-height:1.05!important;word-break:break-word!important}
      .price-change{font-size:14px!important;margin-bottom:10px!important}
      .price-stat-grid{gap:5px!important}
      .chart-panel{padding:9px 10px!important}
      .chart-header{align-items:flex-start!important;gap:8px!important;flex-direction:column!important;margin-bottom:6px!important}
      .chart-controls{width:100%!important;display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:5px!important}
      .tf-btn,.refresh-btn{width:100%!important;padding:6px 0!important;font-size:10px!important}
      .chart-canvas{height:170px!important}
      .mention-panel{padding:10px 11px!important;margin-bottom:10px!important}
      .mention-grid{gap:6px!important}
      .mention-value{font-size:20px!important}
      .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important;margin-bottom:10px!important}
      .metric-card{padding:8px 9px!important}
      .metric-card-label{font-size:9px!important}
      .metric-card-value{font-size:17px!important;line-height:1.1!important}
      .metric-card-sub{font-size:9px!important}
      .fib-panel{padding:10px 11px!important;margin-bottom:10px!important}
      .fib-header{align-items:flex-start!important}
      .fib-signal{font-size:15px!important}
      .fib-grid{grid-template-columns:1fr!important;gap:6px!important}
      .step-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important;margin-bottom:10px!important}
      .step-card{padding:9px!important}
      .longshort-panel{padding:10px 10px!important;margin-bottom:10px!important}
      .signal-box{padding:12px 12px!important;gap:10px!important;align-items:stretch!important}
      .signal-copy{width:100%!important}
      .signal-title{font-size:19px!important;line-height:1.1!important}
      .signal-confidence{width:100%!important;text-align:left!important}
      .run-btn{width:100%!important;padding:10px 12px!important}
      .log-panel{padding:9px 10px!important}
      .discover-table{overflow-x:auto!important;padding-bottom:4px!important}
      .discover-grid{min-width:610px!important}
      .lookup-form{flex-direction:column!important;gap:7px!important;margin-bottom:12px!important}
      .lookup-input{width:100%!important;flex:none!important;padding:11px 12px!important;font-size:12px!important}
      .lookup-btn{width:100%!important;padding:10px 12px!important}
      .lookup-card{padding:12px!important}
      .lookup-summary{align-items:flex-start!important}
      .lookup-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}
      .lookup-mentions{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px!important}
      .lookup-steps{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}
    }
    @media (max-width: 380px){
      .metric-grid,.step-grid,.lookup-stats{grid-template-columns:1fr!important}
      .brand-subtitle{display:none!important}
      .price-value{font-size:22px!important}
      .chart-canvas{height:155px!important}
    }
  `;

  return(<>
    <Head><title>BlackCat — Altcoin Momentum Engine</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>{css}</style></Head>
    <div className="app-shell" style={{maxWidth:980,margin:"0 auto",padding:"20px 16px",overflow:"hidden"}}>

      {/* Header */}
      <div className="app-header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div className="brand-row" style={{display:"flex",alignItems:"center",gap:14}}>
          <div className="brand-title" style={{fontSize:24,fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:"#00ff88",textShadow:"0 0 15px #00ff8877,0 0 40px #00ff8822",letterSpacing:".12em",animation:"flicker 8s infinite"}}>BLACKCAT</div>
          <div className="brand-subtitle" style={{fontSize:10,color:"#2a4455",fontFamily:"'Share Tech Mono',monospace"}}>/altcoin momentum engine v2.2</div>
        </div>
        <div className="live-status" style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:"#335566",fontFamily:"'Share Tech Mono',monospace"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#00ff88",display:"inline-block",animation:"pulse 2s infinite",boxShadow:"0 0 8px #00ff88"}}/>
          live · {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,pointerEvents:"none",background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,136,.007) 2px,rgba(0,255,136,.007) 4px)",zIndex:0}}/>

      {/* Tabs */}
      <div className="tabs" style={{display:"flex",gap:8,marginBottom:16}}>
        {[["pipeline","pipeline"],["discover","new tokens"],["lookup","token lookup"]].map(([id,label])=>(
          <button key={id} className={`tab-btn${tab===id?" active":""}`} onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── PIPELINE ── */}
      {tab==="pipeline"&&<>

        {/* Ticker bar */}
        <div className="ticker-bar" style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
          {TRACKED_TICKERS.map(t=>{
            const z=zscores.find(z=>z.ticker===t); const alert=z&&z.zscore>2.0; const sel=selected===t;
            return(<button key={t} className="ticker-btn" onClick={()=>setSelected(t)} style={{padding:"4px 12px",borderRadius:4,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Share Tech Mono',monospace",border:sel?"1px solid #00ff88":alert?"1px solid #ffaa0055":"1px solid #1a2a3a",background:sel?"#00ff8811":"transparent",color:sel?"#00ff88":alert?"#ffaa00":"#446688",boxShadow:sel?"0 0 10px #00ff8822":"none",transition:"all .15s"}}>
              {t}{alert?" ▲":""}
            </button>);
          })}
        </div>

        {/* Price + Chart row */}
        <div className="price-chart-grid" style={{display:"grid",gridTemplateColumns:"minmax(200px,260px) minmax(0,1fr)",gap:10,marginBottom:12,overflow:"hidden"}}>

          {/* Price panel */}
          <div className="panel" style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:"14px 16px"}}>
            <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em",marginBottom:10}}>PRICE — {selected}</div>
            {priceLoading?<div style={{fontSize:12,color:"#335566",fontFamily:"'Share Tech Mono',monospace"}}>fetching...</div>:<>
              <div className="price-value" style={{fontSize:28,fontWeight:700,color:"#c8d8e8",marginBottom:4,lineHeight:1}}>{fmtPrice(priceData?.price_usd)}</div>
              <div className="price-change" style={{fontSize:16,fontWeight:600,color:pc>=0?"#00ff88":"#ff4466",textShadow:pc>=0?"0 0 8px #00ff8866":"0 0 8px #ff446666",marginBottom:14}}>
                {pc>=0?"+":""}{pc?.toFixed(2)||"0.00"}% 24h
              </div>
              <div className="price-stat-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  ["VOL 24H",fmtNum(priceData?.volume_24h)],
                  ["LIQUIDITY",fmtNum(priceData?.liquidity_usd)],
                  ["MKT CAP",fmtNum(priceData?.market_cap)],
                  ["BUYS/SELLS",`${priceData?.buys_24h||"—"}/${priceData?.sells_24h||"—"}`],
                  ["1H CHNG",(()=>{const v=priceData?.price_change?.h1; return v!==undefined?(v>=0?"+":"")+v.toFixed(2)+"%":"—"})()],
                  ["6H CHNG",(()=>{const v=priceData?.price_change?.h6; return v!==undefined?(v>=0?"+":"")+v.toFixed(2)+"%":"—"})()],
                ].map(([l,v])=>(
                  <div key={l} style={{background:"#070a0f",borderRadius:4,padding:"6px 8px"}}>
                    <div style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:2}}>{l}</div>
                    <div style={{fontSize:11,fontWeight:600,color:(l.includes("CHNG")&&v?.startsWith("+"))?"#00ff88":(l.includes("CHNG")&&v?.startsWith("-"))?"#ff4466":"#99bbcc"}}>{v}</div>
                  </div>
                ))}
              </div>
              {priceData?.chain&&<div style={{marginTop:10,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <ChainBadge chain={priceData.chain==="solana"?"SOL":priceData.chain==="native"?"NATIVE":"ETH"}/>
                <span style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace"}}>{priceData.dex||""}</span>
              </div>}
            </>}
          </div>

          {/* Candlestick chart */}
          <div className="chart-panel" style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:"10px 12px"}}>
            <div className="chart-header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em"}}>PRICE CHART — {selected} / USD</div>
              <div className="chart-controls" style={{display:"flex",gap:4}}>
                {["1h","4h","24h"].map(tf=>(
                  <button key={tf} className={`tf-btn${chartTf===tf?" active":""}`} onClick={()=>{setChartTf(tf);fetchPrice(selected,tf);}}>{tf}</button>
                ))}
                <button className={`tf-btn${chartDrawMode?" active":""}`} onClick={()=>setChartDrawMode(v=>!v)}>line</button>
                <button className="tf-btn" onClick={clearChartDrawings}>clear</button>
                <button className="refresh-btn" onClick={()=>fetchPrice(selected,chartTf)} style={{padding:"3px 8px",background:"transparent",border:"1px solid #1a2a3a",color:"#335566",fontFamily:"'Share Tech Mono',monospace",fontSize:10,cursor:"pointer",borderRadius:3}}>↻</button>
              </div>
            </div>
            <canvas
              className="chart-canvas"
              ref={chartRef}
              width={600}
              height={200}
              onMouseMove={handleChartMove}
              onMouseLeave={handleChartLeave}
              onClick={handleChartClick}
              style={{width:"100%",height:"200px",display:"block",cursor:chartDrawMode?"crosshair":"default"}}
            />
          </div>
        </div>

        {/* Mention velocity */}
        <div className="mention-panel" style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:"12px 16px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
            <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em"}}>LIVE MENTIONS — {selected}</div>
            <button onClick={()=>fetchMentions(selected,true)} disabled={mentionLoading} style={{padding:"4px 8px",background:"transparent",border:"1px solid #1a2a3a",color:"#446688",fontFamily:"'Share Tech Mono',monospace",fontSize:10,cursor:mentionLoading?"not-allowed":"pointer",borderRadius:3}}>refresh</button>
          </div>
          <div className="mention-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {[
              ["TOTAL",mentionData?.total],
              ["REDDIT",mentionData?.source_counts?.reddit],
              ["4CHAN",mentionData?.source_counts?.["4chan_biz"]],
            ].map(([label,val])=>(
              <div key={label} style={{textAlign:"center"}}>
                <div style={{fontSize:10,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:4}}>{label}</div>
                <div className="mention-value" style={{fontSize:24,fontWeight:700,color:val>10?"#00ff88":val>0?"#00cfff":"#446688",textShadow:val>10?"0 0 10px #00ff8866":val>0?"0 0 6px #00cfff33":"none"}}>
                  {mentionLoading?"…":val===undefined?"—":val}
                </div>
                <div style={{height:2,background:"#0d2030",borderRadius:1,marginTop:6,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${val===undefined?0:Math.min(100,Math.max(0,val*5))}%`,background:val>10?"#00ff88":val>0?"#00cfff":"#446688",borderRadius:1,transition:"width .4s ease"}}/>
                </div>
              </div>
            ))}
          </div>
          {mentionData?.error&&<div style={{fontSize:10,color:"#ff4466",fontFamily:"'Share Tech Mono',monospace",marginTop:8}}>{mentionData.error}</div>}
        </div>

        {/* Metric cards */}
        <div className="metric-grid" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
          <NCard label="Z-SCORE" value={s1?s1.zscore.toFixed(2):(zs?.zscore?.toFixed(2)||"—")} sub={s1?.passed?"⚡ anomalous":"7d rolling"} accent={s1?.passed?"green":null}/>
          <NCard label="MENTIONS/HR" value={s1?s1.mentions_1h.toLocaleString():(zs?Math.round(zs.mentions_1h):"—")} sub="4chan+reddit+tg"/>
          <NCard label="RSI" value={liveRsi!==undefined?liveRsi.toFixed(0):"—"} sub={priceData?.candle_source==="unavailable"?"candles unavailable":"live candles"} accent={liveRsi!==undefined&&liveRsi<75&&liveRsi>40?"cyan":null}/>
          <NCard label="OBV" value={liveObv?(liveObv==="rising"?"↑ rising":liveObv==="falling"?"↓ falling":"→ flat"):"—"} sub={priceData?.technicals?.buy_ratio!==undefined?`${Math.round(priceData.technicals.buy_ratio*100)}% buy ratio`:"live flow"} accent={liveObv==="rising"?"green":null}/>
          <NCard label="FIB SIGNAL" value={fibSignal?.signal||"—"} sub={fibSignal?`${fibSignal.confidence}% · 1h/4h/24h`:"multi timeframe"} accent={fibSignal?.signal==="BUY"?"green":fibSignal?.signal==="NEUTRAL"?"cyan":null}/>
        </div>

        {fibSignal&&<div className="fib-panel" style={{background:"#0a0f16",border:`1px solid ${(FIB_COLORS[fibSignal.signal]||"#0d2030")}33`,borderRadius:8,padding:"12px 16px",marginBottom:12}}>
          <div className="fib-header" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em"}}>FIBONACCI SIGNAL — MULTI TIMEFRAME</div>
              <div style={{fontSize:11,color:"#335566",marginTop:4}}>{fibSignal.summary}</div>
            </div>
            <div className="fib-signal" style={{fontSize:18,fontWeight:700,color:FIB_COLORS[fibSignal.signal]||"#99bbcc",fontFamily:"'Share Tech Mono',monospace",textShadow:`0 0 10px ${(FIB_COLORS[fibSignal.signal]||"#99bbcc")}55`}}>{fibSignal.signal} · {fibSignal.confidence}%</div>
          </div>
          <div className="fib-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {fibSignal.frames?.map(frame=>(
              <div key={frame.timeframe} style={{background:"#070a0f",border:"1px solid #0d2030",borderRadius:6,padding:"8px 10px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:4}}>
                  <span style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace"}}>{frame.timeframe.toUpperCase()}</span>
                  <span style={{fontSize:10,color:FIB_COLORS[frame.signal]||"#99bbcc",fontFamily:"'Share Tech Mono',monospace",fontWeight:700}}>{frame.signal}</span>
                </div>
                <div style={{fontSize:11,color:"#99bbcc"}}>{frame.zone}</div>
                <div style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginTop:4}}>{frame.trend} · {frame.position}% range</div>
              </div>
            ))}
          </div>
        </div>}

        {/* Step cards */}
        <div className="step-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <SCard num={1} title="social momentum" step={s1} loading={loading&&!s1}/>
          <SCard num={2} title="technical confluence" step={s2} loading={loading&&s1&&!s2}/>
          <SCard num={3} title="longs vs shorts" step={s3} loading={loading&&s2&&!s3}/>
          <SCard num={4} title="signal generation" step={s4} loading={loading&&s3&&!s4}/>
        </div>

        <LongShortPanel
          data={result?.long_short||longShortData}
          loading={longShortLoading}
          onRefresh={()=>fetchLongShort(selected)}
        />

        {/* Signal box */}
        <div className="signal-box" style={{background:"#0a0f16",border:`1px solid ${s4?.passed?"#00ff8833":"#0d2030"}`,borderRadius:8,padding:"16px 20px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:14,boxShadow:s4?.passed?"0 0 20px #00ff8811":"none"}}>
          <div className="signal-copy">
            <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",marginBottom:4}}>CURRENT SIGNAL</div>
            <div className="signal-title" style={{fontSize:22,fontWeight:700,color:SIGNAL_COLORS[s4?.signal]||"#334455",textShadow:s4?.passed?"0 0 15px #00ff8866":"none"}}>{s4?.signal?.replace(/_/g," ")||"—"}</div>
            <div style={{fontSize:11,color:"#335566",marginTop:4,maxWidth:460}}>{s4?.reason||"select ticker and run pipeline"}</div>
          </div>
          <div className="signal-confidence" style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",marginBottom:4}}>CONFIDENCE</div>
            <div style={{fontSize:22,fontWeight:700,color:"#00ff88"}}>{s4?`${s4.confidence}%`:"—"}</div>
            <div style={{height:3,background:"#0d2030",borderRadius:2,marginTop:6,width:120}}>
              <div style={{height:"100%",width:`${s4?.confidence||0}%`,background:"linear-gradient(90deg,#00ff88,#00cfff)",borderRadius:2,transition:"width .5s ease",boxShadow:"0 0 6px #00ff8866"}}/>
            </div>
          </div>
          <button className="run-btn" onClick={runPipeline} disabled={loading} style={{padding:"10px 24px",background:"transparent",border:"1px solid #00ff88",borderRadius:4,color:"#00ff88",fontFamily:"'Share Tech Mono',monospace",fontSize:12,cursor:loading?"not-allowed":"pointer",opacity:loading?.5:1,boxShadow:"0 0 10px #00ff8833",letterSpacing:".08em"}}>
            {loading?"SCANNING...":"RUN PIPELINE ↗"}
          </button>
        </div>

        <div className="log-panel" style={{background:"#070a0f",border:"1px solid #0d2030",borderRadius:8,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",marginBottom:6}}>EXECUTION LOG</div>
          <div ref={logRef} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,lineHeight:1.9,maxHeight:110,overflowY:"auto"}}>
            {log.map((l,i)=><div key={i} style={{color:l.includes("PASS")||l.includes("signal:")?"#00ff88":l.includes("FAIL")||l.includes("error")?"#ff4466":"#335566"}}>{l}</div>)}
          </div>
        </div>
      </>}

      {/* ── DISCOVER ── */}
      {tab==="discover"&&<div>
        <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em",marginBottom:14}}>NEW & TRENDING TOKENS — live DEXScreener boosts</div>
        <div className="discover-table">
          <div className="discover-grid" style={{display:"grid",gridTemplateColumns:"80px 55px 45px 80px 80px 70px 70px 70px",gap:8,padding:"6px 12px",fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",borderBottom:"1px solid #0d2030",marginBottom:4}}>
            {["TOKEN","CHAIN","AGE","LIQUIDITY","VOL 1H","MENTIONS","SOCIAL","1H"].map(h=><span key={h}>{h}</span>)}
          </div>
          {newTokens.length===0&&<div style={{padding:"12px",fontSize:11,color:"#335566",fontFamily:"'Share Tech Mono',monospace",borderBottom:"1px solid #0a1520"}}>live discover data unavailable</div>}
          {newTokens.map((t,i)=>(
            <div className="discover-grid" key={i} style={{display:"grid",gridTemplateColumns:"80px 55px 45px 80px 80px 70px 70px 70px",gap:8,padding:"10px 12px",fontSize:12,borderBottom:"1px solid #0a1520",borderRadius:4,marginBottom:2,cursor:"pointer",background:t.zscore>3.5?"#00ff880a":"transparent",transition:"background .15s"}}
              onMouseEnter={e=>e.currentTarget.style.background="#0d1f2e"}
              onMouseLeave={e=>e.currentTarget.style.background=t.zscore>3.5?"#00ff880a":"transparent"}>
              <span style={{fontWeight:700,color:"#c8d8e8",fontFamily:"'Share Tech Mono',monospace"}}>${t.name}</span>
              <span><ChainBadge chain={t.chain}/></span>
              <span style={{color:"#335566",fontSize:11}}>{t.age}</span>
              <span style={{color:"#99bbcc"}}>{fmtNum(t.liquidity)}</span>
              <span style={{color:"#99bbcc"}}>{fmtNum(t.volume_1h)}</span>
              <span style={{color:"#00cfff"}}>{t.mentions_1h ?? "—"}</span>
              <span style={{color:"#446688",fontWeight:700}}>—</span>
              <span style={{color:t.price_change_1h>=0?"#00ff88":"#ff4466",fontWeight:700}}>{t.price_change_1h>=0?"+":""}{t.price_change_1h?.toFixed(1)||"0.0"}%</span>
            </div>
          ))}
        </div>
        <div style={{fontSize:10,color:"#223344",fontFamily:"'Share Tech Mono',monospace",marginTop:14,padding:"10px 12px",background:"#070a0f",borderRadius:4,border:"1px solid #0d2030"}}>
          ⚠ new tokens carry extreme risk. low liquidity = high manipulation probability. always verify contract on etherscan/solscan.
        </div>
      </div>}

      {/* ── LOOKUP ── */}
      {tab==="lookup"&&<div>
        <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em",marginBottom:14}}>TOKEN LOOKUP — identify any token by ticker</div>
        <div className="lookup-form" style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={lookupQuery} onChange={e=>setLookupQuery(e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&runLookup()} placeholder="enter ticker e.g. PEPE"
            className="lookup-input"
            style={{flex:1,padding:"10px 14px",background:"#0a0f16",border:"1px solid #1a2a3a",borderRadius:4,color:"#c8d8e8",fontFamily:"'Share Tech Mono',monospace",fontSize:13}}
            onFocus={e=>e.target.style.borderColor="#00ff8866"} onBlur={e=>e.target.style.borderColor="#1a2a3a"}/>
          <button className="lookup-btn" onClick={runLookup} disabled={lookupLoading} style={{padding:"10px 20px",background:"transparent",border:"1px solid #00cfff",borderRadius:4,color:"#00cfff",fontFamily:"'Share Tech Mono',monospace",fontSize:12,cursor:lookupLoading?"not-allowed":"pointer",opacity:lookupLoading?.5:1,boxShadow:"0 0 8px #00cfff22"}}>
            {lookupLoading?"SCANNING...":"IDENTIFY ↗"}
          </button>
        </div>
        {lookupResult&&<div className="lookup-card" style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:16}}>
          <div className="lookup-summary" style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,color:"#00cfff",fontFamily:"'Share Tech Mono',monospace",textShadow:"0 0 12px #00cfff66"}}>${lookupQuery}</div>
              {lookupResult.price&&<div style={{fontSize:16,fontWeight:600,color:"#c8d8e8",marginTop:2}}>{fmtPrice(lookupResult.price.price_usd)} <span style={{color:lookupResult.price.price_change?.h24>=0?"#00ff88":"#ff4466",fontSize:13}}>{lookupResult.price.price_change?.h24>=0?"+":""}{lookupResult.price.price_change?.h24?.toFixed(2)||"0"}%</span></div>}
            </div>
            <div style={{padding:"4px 12px",borderRadius:4,fontSize:11,fontFamily:"'Share Tech Mono',monospace",fontWeight:700,background:lookupResult.signal?.signal!=="NO_SIGNAL"?"#00ff8811":"#ff446611",border:`1px solid ${lookupResult.signal?.signal!=="NO_SIGNAL"?"#00ff8844":"#ff446644"}`,color:lookupResult.signal?.signal!=="NO_SIGNAL"?"#00ff88":"#ff4466"}}>
              {lookupResult.signal?.signal?.replace(/_/g," ")||"NO SIGNAL"}
            </div>
          </div>
          {lookupResult.price&&<div className="lookup-stats" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
            {[["VOL 24H",fmtNum(lookupResult.price.volume_24h)],["LIQUIDITY",fmtNum(lookupResult.price.liquidity_usd)],["MKT CAP",fmtNum(lookupResult.price.market_cap)],["FIB",`${lookupResult.price.fib_signal?.signal||"—"} ${lookupResult.price.fib_signal?.confidence||0}%`]].map(([l,v])=>(
              <div key={l} style={{background:"#070a0f",border:"1px solid #0d2030",borderRadius:6,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:2}}>{l}</div>
                <div style={{fontSize:14,fontWeight:600,color:"#99bbcc"}}>{v}</div>
              </div>
            ))}
          </div>}
          <div className="lookup-mentions" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            {[["TOTAL",lookupResult.mentions?.total],["REDDIT",lookupResult.mentions?.source_counts?.reddit],["4CHAN",lookupResult.mentions?.source_counts?.["4chan_biz"]]].map(([label,val])=>(
              <div key={label} style={{background:"#070a0f",border:"1px solid #0d2030",borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                <div style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:3}}>MENTIONS {label}</div>
                <div style={{fontSize:20,fontWeight:700,color:val>10?"#00ff88":val>0?"#00cfff":"#446688"}}>{val===undefined?"—":val}</div>
              </div>
            ))}
          </div>
          <div className="lookup-steps" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
            {lookupResult.steps?.map((s,i)=>(
              <div key={i} style={{background:"#070a0f",border:`1px solid ${s.passed?"#00ff8833":"#1a2a3a"}`,borderRadius:6,padding:10}}>
                <div style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:3}}>STEP {s.step}</div>
                <div style={{fontSize:10,color:"#99bbcc",marginBottom:6}}>{s.name?.replace(/_/g," ")}</div>
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,fontFamily:"'Share Tech Mono',monospace",background:s.passed?"#00ff8811":"#ff446611",color:s.passed?"#00ff88":"#ff4466"}}>{s.passed?"pass ✓":"fail ✗"}</span>
              </div>
            ))}
          </div>
          {lookupResult.signal?.reason&&<div style={{marginTop:12,fontSize:11,color:"#335566",fontFamily:"'Share Tech Mono',monospace",padding:"8px 12px",background:"#070a0f",borderRadius:4,border:"1px solid #0d2030"}}>{lookupResult.signal.reason}</div>}
        </div>}
      </div>}

      <div style={{marginTop:20,paddingTop:12,borderTop:"1px solid #0a1520",fontSize:10,color:"#1a2a3a",textAlign:"center",fontFamily:"'Share Tech Mono',monospace"}}>
        BLACKCAT is for research purposes only — not financial advice — crypto trading involves substantial risk
      </div>
    </div>
  </>);
}
