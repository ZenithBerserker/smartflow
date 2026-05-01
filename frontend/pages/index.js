import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";
import { ChainBadge, NCard, SCard, WalletTable } from "../components/DashboardWidgets";
import { fmtNum, fmtPrice } from "../lib/format";

const TICKERS = ["PEPE","WIF","BONK","TURBO","FLOKI","DOGE","SOL","ARB","LINK","INJ","SHIB","TIA"];
const SIGNAL_COLORS = { HIGH_CONVICTION_BUY:"#00ff88", BUY:"#00cfff", NO_SIGNAL:"#334455" };

function getMockNewTokens() {
  return [
    {name:"WOJAK",chain:"ETH",age:"2h",liquidity:"$48K",volume_1h:"$124K",mentions_1h:312,zscore:3.8,price_change_1h:142},
    {name:"GIGA",chain:"SOL",age:"5h",liquidity:"$92K",volume_1h:"$341K",mentions_1h:187,zscore:2.9,price_change_1h:67},
    {name:"HARAMBE",chain:"ETH",age:"12h",liquidity:"$31K",volume_1h:"$89K",mentions_1h:98,zscore:2.4,price_change_1h:34},
    {name:"SIGMA",chain:"SOL",age:"1h",liquidity:"$12K",volume_1h:"$44K",mentions_1h:421,zscore:4.1,price_change_1h:389},
    {name:"CHAD",chain:"BASE",age:"8h",liquidity:"$67K",volume_1h:"$198K",mentions_1h:145,zscore:2.2,price_change_1h:28},
  ];
}

function getMockMentionChanges(ticker) {
  const s = ticker.charCodeAt(0)*7+(ticker.charCodeAt(1)||3)*13;
  const r=(min,max,x)=>Math.round(min+((s*x*9301+49297)%233280)/233280*(max-min));
  return {"4h":r(-30,280,1),"24h":r(-20,180,2),"7d":r(-10,120,3)};
}

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
  const [newTokens]=useState(getMockNewTokens());
  const [mentionChanges,setMentionChanges]=useState({});
  const [priceData,setPriceData]=useState(null);
  const [priceLoading,setPriceLoading]=useState(false);
  const [walletData,setWalletData]=useState(null);
  const [walletLoading,setWalletLoading]=useState(false);
  const [chartTf,setChartTf]=useState("24h");
  const logRef=useRef(null);
  const chartRef=useRef(null);

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
    setMentionChanges(getMockMentionChanges(selected));
    setResult(null);
    fetchPrice(selected);
    fetchWallets(selected);
  },[selected]);

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

  const fetchWallets=async(ticker)=>{
    setWalletLoading(true);
    try{
      const r=await fetch(`/api/wallets?ticker=${ticker}`);
      const d=await r.json();
      setWalletData(d);
      if(d.source==="mock") addLog(`wallets using mock data: ${d.reason||"live source unavailable"}`);
      else addLog(`wallets loaded from ${d.source}`);
    }catch(e){
      setWalletData({wallets:[],source:"error",reason:e.message});
      addLog(`wallet error: ${e.message}`);
    }
    setWalletLoading(false);
  };

  // Draw candlestick chart using canvas
  useEffect(()=>{
    if(!priceData?.candles||!chartRef.current) return;
    // Small delay to ensure DOM is laid out
    const timer = setTimeout(drawChart, 50);
    return () => clearTimeout(timer);
  },[priceData,chartTf]);

  const drawChart = () => {
    if(!priceData?.candles||!chartRef.current) return;
    const canvas=chartRef.current;
    const dpr=window.devicePixelRatio||1;
    const W=canvas.parentElement?.offsetWidth||600;
    const H=200;
    canvas.width=W*dpr; canvas.height=H*dpr;
    canvas.style.width=W+"px"; canvas.style.height=H+"px";
    const ctx=canvas.getContext("2d");
    ctx.scale(dpr,dpr);

    const candles=priceData.candles;
    const pad={top:16,right:60,bottom:28,left:8};
    const cw=W-pad.left-pad.right, ch=H-pad.top-pad.bottom;

    const prices=candles.flatMap(c=>[c.h,c.l]);
    const minP=Math.min(...prices), maxP=Math.max(...prices);
    const range=maxP-minP||maxP*0.01;

    const toY=p=>pad.top+ch-(((p-minP)/range)*ch);
    const candleW=Math.max(2,(cw/candles.length)*0.65);

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
      const x=pad.left+(i/candles.length)*cw+(cw/candles.length)*0.5;
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

    // Time labels
    ctx.fillStyle="#335566";
    ctx.font="9px 'Share Tech Mono',monospace";
    ctx.textAlign="center";
    const step=Math.floor(candles.length/6);
    for(let i=0;i<candles.length;i+=step){
      const x=pad.left+(i/candles.length)*cw+(cw/candles.length)*0.5;
      const d=new Date(candles[i].t);
      ctx.fillText(d.getHours()+":"+String(d.getMinutes()).padStart(2,"0"),x,H-8);
    }
    };

  const runPipeline=async()=>{
    if(loading)return; setLoading(true); setResult(null); addLog(`initiating pipeline for ${selected}...`);
    try{
      const r=await fetch(`/api/pipeline?ticker=${selected}`); const d=await r.json(); setResult(d);
      d.steps?.forEach(s=>{
        if(s.name==="social_momentum") addLog(`social z=${s.zscore} — ${s.passed?"PASS":"FAIL"}`);
        if(s.name==="technical_confluence") addLog(`RSI=${s.rsi} OBV=${s.obv_signal} — ${s.passed?"PASS":"FAIL"}`);
        if(s.name==="wallet_analysis") addLog(`${s.smart_money_count}/${s.wallets_analyzed} smart money — ${s.passed?"PASS":"FAIL"}`);
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
      setLookupResult({...pipeData,changes:getMockMentionChanges(lookupQuery),price:priceD});
      addLog(`lookup done: ${lookupQuery.toUpperCase()} — ${pipeData.signal?.signal||"no signal"}`);
    }catch(e){ addLog(`lookup error: ${e.message}`); }
    setLookupLoading(false);
  };

  const getStep=(n)=>result?.steps?.find(s=>s.name===n);
  const s1=getStep("social_momentum"),s2=getStep("technical_confluence"),s3=getStep("wallet_analysis"),s4=getStep("signal_generation");
  const zs=zscores.find(z=>z.ticker===selected);
  const pc=priceData?.price_change?.h24||0;
  const liveRsi=s2?.rsi??priceData?.technicals?.rsi;
  const liveObv=s2?.obv_signal||priceData?.technicals?.obv_signal;

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
  `;

  return(<>
    <Head><title>BlackCat — Altcoin Momentum Engine</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>{css}</style></Head>
    <div style={{maxWidth:980,margin:"0 auto",padding:"20px 16px",overflow:"hidden"}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{fontSize:24,fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:"#00ff88",textShadow:"0 0 15px #00ff8877,0 0 40px #00ff8822",letterSpacing:".12em",animation:"flicker 8s infinite"}}>BLACKCAT</div>
          <div style={{fontSize:10,color:"#2a4455",fontFamily:"'Share Tech Mono',monospace"}}>/altcoin momentum engine v2.2</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:"#335566",fontFamily:"'Share Tech Mono',monospace"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#00ff88",display:"inline-block",animation:"pulse 2s infinite",boxShadow:"0 0 8px #00ff88"}}/>
          live · {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,pointerEvents:"none",background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,136,.007) 2px,rgba(0,255,136,.007) 4px)",zIndex:0}}/>

      {/* Tabs */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[["pipeline","pipeline"],["discover","new tokens"],["lookup","token lookup"]].map(([id,label])=>(
          <button key={id} className={`tab-btn${tab===id?" active":""}`} onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── PIPELINE ── */}
      {tab==="pipeline"&&<>

        {/* Ticker bar */}
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
          {TICKERS.map(t=>{
            const z=zscores.find(z=>z.ticker===t); const alert=z&&z.zscore>2.0; const sel=selected===t;
            return(<button key={t} onClick={()=>setSelected(t)} style={{padding:"4px 12px",borderRadius:4,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'Share Tech Mono',monospace",border:sel?"1px solid #00ff88":alert?"1px solid #ffaa0055":"1px solid #1a2a3a",background:sel?"#00ff8811":"transparent",color:sel?"#00ff88":alert?"#ffaa00":"#446688",boxShadow:sel?"0 0 10px #00ff8822":"none",transition:"all .15s"}}>
              {t}{alert?" ▲":""}
            </button>);
          })}
        </div>

        {/* Price + Chart row */}
        <div style={{display:"grid",gridTemplateColumns:"minmax(200px,260px) minmax(0,1fr)",gap:10,marginBottom:12,overflow:"hidden"}}>

          {/* Price panel */}
          <div style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:"14px 16px"}}>
            <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em",marginBottom:10}}>PRICE — {selected}</div>
            {priceLoading?<div style={{fontSize:12,color:"#335566",fontFamily:"'Share Tech Mono',monospace"}}>fetching...</div>:<>
              <div style={{fontSize:28,fontWeight:700,color:"#c8d8e8",marginBottom:4,lineHeight:1}}>{fmtPrice(priceData?.price_usd)}</div>
              <div style={{fontSize:16,fontWeight:600,color:pc>=0?"#00ff88":"#ff4466",textShadow:pc>=0?"0 0 8px #00ff8866":"0 0 8px #ff446666",marginBottom:14}}>
                {pc>=0?"+":""}{pc?.toFixed(2)||"0.00"}% 24h
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
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
              {priceData?.chain&&<div style={{marginTop:10,display:"flex",gap:6,alignItems:"center"}}>
                <ChainBadge chain={priceData.chain==="solana"?"SOL":"ETH"}/>
                <span style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace"}}>{priceData.dex||""}</span>
              </div>}
            </>}
          </div>

          {/* Candlestick chart */}
          <div style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:"10px 12px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em"}}>PRICE CHART — {selected} / USD</div>
              <div style={{display:"flex",gap:4}}>
                {["1h","4h","24h"].map(tf=>(
                  <button key={tf} className={`tf-btn${chartTf===tf?" active":""}`} onClick={()=>{setChartTf(tf);fetchPrice(selected,tf);}}>{tf}</button>
                ))}
                <button onClick={()=>fetchPrice(selected,chartTf)} style={{padding:"3px 8px",background:"transparent",border:"1px solid #1a2a3a",color:"#335566",fontFamily:"'Share Tech Mono',monospace",fontSize:10,cursor:"pointer",borderRadius:3}}>↻</button>
              </div>
            </div>
            <canvas ref={chartRef} width={600} height={200} style={{width:"100%",height:"200px",display:"block"}}/>
          </div>
        </div>

        {/* Mention velocity */}
        <div style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:"12px 16px",marginBottom:12}}>
          <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em",marginBottom:10}}>MENTION VELOCITY — {selected}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {[["4h",mentionChanges["4h"]],["24h",mentionChanges["24h"]],["7d",mentionChanges["7d"]]].map(([tf,val])=>(
              <div key={tf} style={{textAlign:"center"}}>
                <div style={{fontSize:10,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:4}}>{tf}</div>
                <div style={{fontSize:24,fontWeight:700,color:val>100?"#00ff88":val>30?"#00cfff":val>0?"#99ccdd":"#ff4466",textShadow:val>100?"0 0 10px #00ff8866":val>0?"0 0 6px #00cfff33":"0 0 6px #ff446633"}}>
                  {val>0?"+":""}{val}%
                </div>
                <div style={{height:2,background:"#0d2030",borderRadius:1,marginTop:6,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(100,Math.max(0,val))}%`,background:val>100?"#00ff88":val>0?"#00cfff":"#ff4466",borderRadius:1,transition:"width .4s ease"}}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Metric cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <NCard label="Z-SCORE" value={s1?s1.zscore.toFixed(2):(zs?.zscore?.toFixed(2)||"—")} sub={s1?.passed?"⚡ anomalous":"7d rolling"} accent={s1?.passed?"green":null}/>
          <NCard label="MENTIONS/HR" value={s1?s1.mentions_1h.toLocaleString():(zs?Math.round(zs.mentions_1h):"—")} sub="4chan+reddit+tg"/>
          <NCard label="RSI" value={liveRsi!==undefined?liveRsi.toFixed(0):"—"} sub={priceData?.mock?"mock candles":"live candles"} accent={liveRsi!==undefined&&liveRsi<75&&liveRsi>40?"cyan":null}/>
          <NCard label="OBV" value={liveObv?(liveObv==="rising"?"↑ rising":liveObv==="falling"?"↓ falling":"→ flat"):"—"} sub={priceData?.technicals?.buy_ratio!==undefined?`${Math.round(priceData.technicals.buy_ratio*100)}% buy ratio`:"live flow"} accent={liveObv==="rising"?"green":null}/>
        </div>

        {/* Step cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          <SCard num={1} title="social momentum" step={s1} loading={loading&&!s1}/>
          <SCard num={2} title="technical confluence" step={s2} loading={loading&&s1&&!s2}/>
          <SCard num={3} title="wallet AI analysis" step={s3} loading={loading&&s2&&!s3}/>
          <SCard num={4} title="signal generation" step={s4} loading={loading&&s3&&!s4}/>
        </div>

        <WalletTable
          wallets={s3?.wallet_results||walletData?.wallets||[]}
          source={s3?.source||walletData?.source}
          reason={walletData?.reason}
          loading={walletLoading}
          onRefresh={()=>fetchWallets(selected)}
        />

        {/* Signal box */}
        <div style={{background:"#0a0f16",border:`1px solid ${s4?.passed?"#00ff8833":"#0d2030"}`,borderRadius:8,padding:"16px 20px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:14,boxShadow:s4?.passed?"0 0 20px #00ff8811":"none"}}>
          <div>
            <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",marginBottom:4}}>CURRENT SIGNAL</div>
            <div style={{fontSize:22,fontWeight:700,color:SIGNAL_COLORS[s4?.signal]||"#334455",textShadow:s4?.passed?"0 0 15px #00ff8866":"none"}}>{s4?.signal?.replace(/_/g," ")||"—"}</div>
            <div style={{fontSize:11,color:"#335566",marginTop:4,maxWidth:460}}>{s4?.reason||"select ticker and run pipeline"}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",marginBottom:4}}>CONFIDENCE</div>
            <div style={{fontSize:22,fontWeight:700,color:"#00ff88"}}>{s4?`${s4.confidence}%`:"—"}</div>
            <div style={{height:3,background:"#0d2030",borderRadius:2,marginTop:6,width:120}}>
              <div style={{height:"100%",width:`${s4?.confidence||0}%`,background:"linear-gradient(90deg,#00ff88,#00cfff)",borderRadius:2,transition:"width .5s ease",boxShadow:"0 0 6px #00ff8866"}}/>
            </div>
          </div>
          <button onClick={runPipeline} disabled={loading} style={{padding:"10px 24px",background:"transparent",border:"1px solid #00ff88",borderRadius:4,color:"#00ff88",fontFamily:"'Share Tech Mono',monospace",fontSize:12,cursor:loading?"not-allowed":"pointer",opacity:loading?.5:1,boxShadow:"0 0 10px #00ff8833",letterSpacing:".08em"}}>
            {loading?"SCANNING...":"RUN PIPELINE ↗"}
          </button>
        </div>

        <div style={{background:"#070a0f",border:"1px solid #0d2030",borderRadius:8,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",marginBottom:6}}>EXECUTION LOG</div>
          <div ref={logRef} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,lineHeight:1.9,maxHeight:110,overflowY:"auto"}}>
            {log.map((l,i)=><div key={i} style={{color:l.includes("PASS")||l.includes("signal:")?"#00ff88":l.includes("FAIL")||l.includes("error")?"#ff4466":"#335566"}}>{l}</div>)}
          </div>
        </div>
      </>}

      {/* ── DISCOVER ── */}
      {tab==="discover"&&<div>
        <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em",marginBottom:14}}>NEW & TRENDING TOKENS — sorted by Z-score</div>
        <div style={{display:"grid",gridTemplateColumns:"80px 55px 45px 80px 80px 70px 70px 70px",gap:8,padding:"6px 12px",fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",borderBottom:"1px solid #0d2030",marginBottom:4}}>
          {["TOKEN","CHAIN","AGE","LIQUIDITY","VOL 1H","MENTIONS","Z-SCORE","1H"].map(h=><span key={h}>{h}</span>)}
        </div>
        {newTokens.map((t,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"80px 55px 45px 80px 80px 70px 70px 70px",gap:8,padding:"10px 12px",fontSize:12,borderBottom:"1px solid #0a1520",borderRadius:4,marginBottom:2,cursor:"pointer",background:t.zscore>3.5?"#00ff880a":"transparent",transition:"background .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="#0d1f2e"}
            onMouseLeave={e=>e.currentTarget.style.background=t.zscore>3.5?"#00ff880a":"transparent"}>
            <span style={{fontWeight:700,color:"#c8d8e8",fontFamily:"'Share Tech Mono',monospace"}}>${t.name}</span>
            <span><ChainBadge chain={t.chain}/></span>
            <span style={{color:"#335566",fontSize:11}}>{t.age}</span>
            <span style={{color:"#99bbcc"}}>{t.liquidity}</span>
            <span style={{color:"#99bbcc"}}>{t.volume_1h}</span>
            <span style={{color:"#00cfff"}}>{t.mentions_1h}</span>
            <span style={{color:t.zscore>3?"#00ff88":t.zscore>2?"#00cfff":"#ffaa00",fontWeight:700,textShadow:t.zscore>3?"0 0 8px #00ff8866":"none"}}>Z {t.zscore.toFixed(1)}</span>
            <span style={{color:"#00ff88",fontWeight:700}}>+{t.price_change_1h}%</span>
          </div>
        ))}
        <div style={{fontSize:10,color:"#223344",fontFamily:"'Share Tech Mono',monospace",marginTop:14,padding:"10px 12px",background:"#070a0f",borderRadius:4,border:"1px solid #0d2030"}}>
          ⚠ new tokens carry extreme risk. low liquidity = high manipulation probability. always verify contract on etherscan/solscan.
        </div>
      </div>}

      {/* ── LOOKUP ── */}
      {tab==="lookup"&&<div>
        <div style={{fontSize:10,color:"#336688",fontFamily:"'Share Tech Mono',monospace",letterSpacing:".1em",marginBottom:14}}>TOKEN LOOKUP — identify any token by ticker</div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={lookupQuery} onChange={e=>setLookupQuery(e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&runLookup()} placeholder="enter ticker e.g. PEPE"
            style={{flex:1,padding:"10px 14px",background:"#0a0f16",border:"1px solid #1a2a3a",borderRadius:4,color:"#c8d8e8",fontFamily:"'Share Tech Mono',monospace",fontSize:13}}
            onFocus={e=>e.target.style.borderColor="#00ff8866"} onBlur={e=>e.target.style.borderColor="#1a2a3a"}/>
          <button onClick={runLookup} disabled={lookupLoading} style={{padding:"10px 20px",background:"transparent",border:"1px solid #00cfff",borderRadius:4,color:"#00cfff",fontFamily:"'Share Tech Mono',monospace",fontSize:12,cursor:lookupLoading?"not-allowed":"pointer",opacity:lookupLoading?.5:1,boxShadow:"0 0 8px #00cfff22"}}>
            {lookupLoading?"SCANNING...":"IDENTIFY ↗"}
          </button>
        </div>
        {lookupResult&&<div style={{background:"#0a0f16",border:"1px solid #0d2030",borderRadius:8,padding:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:22,fontWeight:700,color:"#00cfff",fontFamily:"'Share Tech Mono',monospace",textShadow:"0 0 12px #00cfff66"}}>${lookupQuery}</div>
              {lookupResult.price&&<div style={{fontSize:16,fontWeight:600,color:"#c8d8e8",marginTop:2}}>{fmtPrice(lookupResult.price.price_usd)} <span style={{color:lookupResult.price.price_change?.h24>=0?"#00ff88":"#ff4466",fontSize:13}}>{lookupResult.price.price_change?.h24>=0?"+":""}{lookupResult.price.price_change?.h24?.toFixed(2)||"0"}%</span></div>}
            </div>
            <div style={{padding:"4px 12px",borderRadius:4,fontSize:11,fontFamily:"'Share Tech Mono',monospace",fontWeight:700,background:lookupResult.signal?.signal!=="NO_SIGNAL"?"#00ff8811":"#ff446611",border:`1px solid ${lookupResult.signal?.signal!=="NO_SIGNAL"?"#00ff8844":"#ff446644"}`,color:lookupResult.signal?.signal!=="NO_SIGNAL"?"#00ff88":"#ff4466"}}>
              {lookupResult.signal?.signal?.replace(/_/g," ")||"NO SIGNAL"}
            </div>
          </div>
          {lookupResult.price&&<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            {[["VOL 24H",fmtNum(lookupResult.price.volume_24h)],["LIQUIDITY",fmtNum(lookupResult.price.liquidity_usd)],["MKT CAP",fmtNum(lookupResult.price.market_cap)]].map(([l,v])=>(
              <div key={l} style={{background:"#070a0f",border:"1px solid #0d2030",borderRadius:6,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:2}}>{l}</div>
                <div style={{fontSize:14,fontWeight:600,color:"#99bbcc"}}>{v}</div>
              </div>
            ))}
          </div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
            {[["4h",lookupResult.changes?.["4h"]],["24h",lookupResult.changes?.["24h"]],["7d",lookupResult.changes?.["7d"]]].map(([tf,val])=>(
              <div key={tf} style={{background:"#070a0f",border:"1px solid #0d2030",borderRadius:6,padding:"8px 10px",textAlign:"center"}}>
                <div style={{fontSize:9,color:"#335566",fontFamily:"'Share Tech Mono',monospace",marginBottom:3}}>MENTIONS {tf}</div>
                <div style={{fontSize:20,fontWeight:700,color:val>50?"#00ff88":val>0?"#00cfff":"#ff4466"}}>{val>0?"+":""}{val}%</div>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
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
