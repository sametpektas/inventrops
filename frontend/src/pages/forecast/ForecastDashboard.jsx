import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { 
  BarChart3, Database, Server, Network, Activity, AlertTriangle, CheckCircle2, 
  TrendingUp, Search, RefreshCw, Info, ChevronDown, ChevronRight, Box, Cpu, MemoryStick, X
} from 'lucide-react';
import api from '../../api/client';

function getRiskLevel(level) {
  const c = {
    red: { label: 'Critical', color: '#f43f5e', icon: AlertTriangle, bg: 'rgba(244,63,94,0.1)' },
    orange: { label: 'High Risk', color: '#fb923c', icon: Activity, bg: 'rgba(251,146,60,0.1)' },
    yellow: { label: 'Warning', color: '#facc15', icon: Info, bg: 'rgba(250,204,21,0.1)' },
    green: { label: 'Healthy', color: '#10b981', icon: CheckCircle2, bg: 'rgba(16,185,129,0.1)' },
  };
  return c[level] || c.green;
}

function formatCapacity(v) {
  if (v == null || isNaN(v)) return '-';
  v = Number(v);
  if (v >= 1024*1024) return (v/(1024*1024)).toFixed(2)+' PB';
  if (v >= 1024) return (v/1024).toFixed(2)+' TB';
  return v.toFixed(1)+' GB';
}

function fmtVal(value, metric) {
  if (value == null) return '-';
  const v = Number(value);
  if (metric.includes('percent') || metric.includes('utilization') || metric.includes('cpu_usage') || metric.includes('memory_usage')) return v.toFixed(1)+'%';
  if (metric === 'capacity_total' || metric === 'capacity_used') return formatCapacity(v);
  return v.toLocaleString();
}

function metricLabel(n) {
  const m = { capacity_total:'Total Capacity', capacity_used:'Used Capacity', capacity_used_percent:'Capacity Usage', port_utilization_percent:'Port Utilization', cpu_usage_percent:'CPU Usage', memory_usage_percent:'Memory Usage' };
  return m[n] || n.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

export default function ForecastDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('storage');
  const [openDCs, setOpenDCs] = useState({});
  const [modal, setModal] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try { setLoading(true); const res = await api.get('/forecast/summary'); setData(res.results || []); }
    catch { setToast({ message: 'Failed to fetch data', type: 'error' }); }
    finally { setLoading(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try { const r = await api.post('/forecast/sync',{}); setToast({message:`Sync complete — ${r.totalSynced||0} metrics`,type:'success'}); fetchData(); }
    catch { setToast({message:'Sync failed',type:'error'}); }
    finally { setSyncing(false); setTimeout(()=>setToast(null),3000); }
  };

  const handleRecalculate = async () => {
    setCalculating(true);
    try { await api.post('/forecast/recalculate',{}); setToast({message:'Forecast recalculated',type:'success'}); fetchData(); }
    catch { setToast({message:'Recalculation failed',type:'error'}); }
    finally { setCalculating(false); setTimeout(()=>setToast(null),3000); }
  };

  const openGraph = async (item) => {
    setModal(item); setHistoryLoading(true);
    try {
      const res = await api.get(`/forecast/${item.object_id}/history`);
      const snaps = (res.results||[]).filter(s=>s.metric_name===item.metric_name).map(s=>({
        date: new Date(s.captured_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}),
        value: s.metric_value
      }));
      setHistoryData(snaps);
    } catch { setHistoryData([]); }
    finally { setHistoryLoading(false); }
  };

  const toggleDC = (dc) => setOpenDCs(p=>({...p,[dc]:!p[dc]}));

  // Filter data by active tab
  const storageItems = data.filter(d=>d.object_type==='storage' && (d.metric_name.includes('percent')||d.metric_name.includes('capacity'))).filter(d=>d.object_name.toLowerCase().includes(search.toLowerCase()));
  const sanItems = data.filter(d=>d.object_type==='san').filter(d=>d.object_name.toLowerCase().includes(search.toLowerCase()));
  const virtItems = data.filter(d=>d.object_type==='cluster'||d.object_type==='virtualization').filter(d=>d.object_name.toLowerCase().includes(search.toLowerCase()));

  // Group virt items by DC
  const clustersById = {};
  virtItems.forEach(row => {
    if (!clustersById[row.object_id]) {
      let dc='Unknown DC', cn=row.object_name;
      if (row.object_name.includes(' | ')) { const p=row.object_name.split(' | '); dc=p[0]; cn=p.slice(1).join(' | '); }
      clustersById[row.object_id] = { id:row.object_id, name:cn, dc, metrics:{} };
    }
    clustersById[row.object_id].metrics[row.metric_name] = row;
  });
  const dcGroups = {};
  Object.values(clustersById).forEach(cl => {
    if (!dcGroups[cl.dc]) dcGroups[cl.dc]=[];
    dcGroups[cl.dc].push(cl);
  });
  const sortedDCs = Object.keys(dcGroups).sort();

  const tabs = [
    { key:'storage', label:'Storage', icon:Database, count:storageItems.length },
    { key:'san', label:'SAN', icon:Network, count:sanItems.length },
    { key:'virtualization', label:'Virtualization', icon:Server, count:virtItems.length },
  ];

  const renderRow = (item, icon) => {
    const risk = getRiskLevel(item.risk_level);
    return (
      <div key={item.id} onClick={()=>openGraph(item)} style={{ background:'rgba(15,23,42,0.4)', borderRadius:16, padding:'14px 20px', display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:16, border:'1px solid rgba(255,255,255,0.03)', cursor:'pointer', transition:'all 0.2s', position:'relative' }}
        onMouseEnter={e=>{e.currentTarget.style.background='rgba(30,41,59,0.6)';e.currentTarget.style.borderColor='rgba(255,255,255,0.1)';}}
        onMouseLeave={e=>{e.currentTarget.style.background='rgba(15,23,42,0.4)';e.currentTarget.style.borderColor='rgba(255,255,255,0.03)';}}
      >
        <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:risk.color,borderRadius:'16px 0 0 16px'}}/>
        <div style={{display:'flex',alignItems:'center',gap:12,flex:'1 1 220px',minWidth:200}}>
          <div style={{width:36,height:36,borderRadius:10,background:'rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'center'}}>{icon}</div>
          <div>
            <div style={{fontWeight:700,fontSize:'0.95rem',color:'#f8fafc'}}>{item.object_name}</div>
            <div style={{fontSize:'0.75rem',color:'#64748b',textTransform:'uppercase',letterSpacing:'0.05em'}}>{metricLabel(item.metric_name)}</div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(70px,1fr))',gap:12,flex:'2 1 350px'}}>
          <div><div style={{fontSize:'0.7rem',color:'#64748b',textTransform:'uppercase',marginBottom:2}}>Current</div><div style={{fontSize:'1.05rem',fontWeight:800,color:risk.color}}>{fmtVal(item.current_value,item.metric_name)}</div></div>
          <div><div style={{fontSize:'0.7rem',color:'#64748b',textTransform:'uppercase',marginBottom:2}}>1 Year</div><div style={{fontSize:'0.9rem',fontWeight:600,color:'#cbd5e1'}}>{fmtVal(item.pred_1y,item.metric_name)}</div></div>
          <div><div style={{fontSize:'0.7rem',color:'#64748b',textTransform:'uppercase',marginBottom:2}}>2 Years</div><div style={{fontSize:'0.9rem',fontWeight:600,color:'#cbd5e1'}}>{fmtVal(item.pred_2y,item.metric_name)}</div></div>
          <div><div style={{fontSize:'0.7rem',color:'#64748b',textTransform:'uppercase',marginBottom:2}}>3 Years</div><div style={{fontSize:'0.9rem',fontWeight:600,color:'#cbd5e1'}}>{fmtVal(item.pred_3y,item.metric_name)}</div></div>
        </div>
        <div style={{display:'inline-flex',alignItems:'center',gap:6,padding:'4px 10px',borderRadius:8,background:risk.bg,color:risk.color,fontSize:'0.7rem',fontWeight:700}}>
          <risk.icon size={12}/> {risk.label}
        </div>
      </div>
    );
  };

  const renderClusterMetricBtn = (cluster, metricKey, label, icon, color) => {
    const m = cluster.metrics[metricKey];
    if (!m) return null;
    const risk = getRiskLevel(m.risk_level);
    return (
      <button onClick={()=>openGraph(m)} style={{ flex:'1 1 200px', background:'rgba(15,23,42,0.5)', borderRadius:14, padding:'14px 18px', border:`1px solid rgba(255,255,255,0.05)`, cursor:'pointer', textAlign:'left', transition:'all 0.2s', position:'relative', overflow:'hidden', display:'flex', alignItems:'center', gap:14 }}
        onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(99,102,241,0.3)';e.currentTarget.style.background='rgba(30,41,59,0.5)';}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.05)';e.currentTarget.style.background='rgba(15,23,42,0.5)';}}
      >
        <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:risk.color}}/>
        <div style={{width:36,height:36,borderRadius:10,background:`${color}15`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:'0.9rem',color:'#f8fafc',marginBottom:4}}>{label}</div>
          <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
            <span style={{fontSize:'0.8rem',color:risk.color,fontWeight:800}}>{Number(m.current_value).toFixed(1)}%</span>
            <span style={{fontSize:'0.75rem',color:'#94a3b8'}}>1Y: {m.pred_1y?Number(m.pred_1y).toFixed(1)+'%':'-'}</span>
            <span style={{fontSize:'0.75rem',color:'#94a3b8'}}>2Y: {m.pred_2y?Number(m.pred_2y).toFixed(1)+'%':'-'}</span>
          </div>
        </div>
        <div style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:6,background:risk.bg,color:risk.color,fontSize:'0.65rem',fontWeight:700,flexShrink:0}}>
          <risk.icon size={10}/> {risk.label}
        </div>
      </button>
    );
  };

  const renderStorageTab = () => storageItems.length===0 ? <EmptyState text="No storage data. Sync Xormon to populate."/> : <div style={{display:'flex',flexDirection:'column',gap:12}}>{storageItems.map(i=>renderRow(i,<Database size={18} color="#818cf8"/>))}</div>;
  const renderSanTab = () => sanItems.length===0 ? <EmptyState text="No SAN data. Sync Xormon to populate."/> : <div style={{display:'flex',flexDirection:'column',gap:12}}>{sanItems.map(i=>renderRow(i,<Network size={18} color="#818cf8"/>))}</div>;

  const renderVirtTab = () => {
    if (sortedDCs.length===0) return <EmptyState text="No virtualization data. Sync vROps to populate."/>;
    return (
      <div style={{display:'flex',flexDirection:'column',gap:20}}>
        {sortedDCs.map(dc => {
          const isOpen = openDCs[dc] !== false;
          const clusters = dcGroups[dc];
          return (
            <div key={dc} style={{background:'rgba(30,41,59,0.3)',borderRadius:20,border:'1px solid rgba(255,255,255,0.05)',overflow:'hidden'}}>
              <div onClick={()=>toggleDC(dc)} style={{padding:'18px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',background:isOpen?'rgba(255,255,255,0.02)':'transparent',transition:'background 0.2s'}}>
                <div style={{display:'flex',alignItems:'center',gap:14}}>
                  <div style={{padding:9,background:'rgba(99,102,241,0.1)',borderRadius:11,color:'#818cf8'}}><Box size={22}/></div>
                  <div>
                    <h3 style={{margin:0,fontSize:'1.15rem',fontWeight:800,color:'#f8fafc'}}>{dc}</h3>
                    <div style={{fontSize:'0.8rem',color:'#94a3b8',marginTop:2}}>{clusters.length} cluster{clusters.length>1?'s':''}</div>
                  </div>
                </div>
                <div style={{color:'#64748b',padding:6,background:'rgba(255,255,255,0.05)',borderRadius:'50%'}}>{isOpen?<ChevronDown size={18}/>:<ChevronRight size={18}/>}</div>
              </div>
              {isOpen && (
                <div style={{borderTop:'1px solid rgba(255,255,255,0.05)',padding:'20px',display:'flex',flexDirection:'column',gap:20}}>
                  {clusters.map(cl=>(
                    <div key={cl.id} style={{background:'rgba(15,23,42,0.3)',borderRadius:16,padding:'18px 20px',border:'1px solid rgba(99,102,241,0.08)'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                        <Server size={18} color="#818cf8"/>
                        <h4 style={{margin:0,fontSize:'1rem',fontWeight:700,color:'#fff'}}>{cl.name}</h4>
                      </div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
                        {renderClusterMetricBtn(cl,'cpu_usage_percent','CPU Utilization',<Cpu size={18} color="#f43f5e"/>,'#f43f5e')}
                        {renderClusterMetricBtn(cl,'memory_usage_percent','Memory Utilization',<MemoryStick size={18} color="#10b981"/>,'#10b981')}
                        {!cl.metrics['cpu_usage_percent'] && !cl.metrics['memory_usage_percent'] && (
                          <div style={{padding:16,textAlign:'center',color:'#64748b',fontSize:'0.85rem',width:'100%'}}>Awaiting data. Run sync & recalculate.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{padding:32,color:'#fff',minHeight:'100vh',background:'radial-gradient(circle at 0% 0%,#1a1c2e 0%,#0f111a 100%)'}}>
      {toast&&(<div style={{position:'fixed',top:32,right:32,zIndex:1000,padding:'16px 24px',borderRadius:16,background:'rgba(30,41,59,0.8)',backdropFilter:'blur(12px)',border:`1px solid ${toast.type==='success'?'#10b981':'#f43f5e'}`,boxShadow:'0 20px 40px rgba(0,0,0,0.4)',display:'flex',alignItems:'center',gap:12,animation:'slideIn 0.3s ease-out'}}>
        {toast.type==='success'?<CheckCircle2 size={20} color="#10b981"/>:<AlertTriangle size={20} color="#f43f5e"/>}
        <span style={{fontSize:'0.9rem',fontWeight:500}}>{toast.message}</span>
      </div>)}

      {/* Header */}
      <div style={{display:'flex',flexWrap:'wrap',gap:24,justifyContent:'space-between',alignItems:'flex-end',marginBottom:32}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:12,color:'#6366f1',fontWeight:600,fontSize:'0.875rem',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}><TrendingUp size={18}/> Predictive Analytics</div>
          <h1 style={{fontSize:'2.5rem',fontWeight:800,letterSpacing:'-0.02em',margin:0,background:'linear-gradient(to right,#fff,#94a3b8)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Capacity Intelligence</h1>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
          <div style={{position:'relative',width:260}}>
            <Search size={18} style={{position:'absolute',left:16,top:13,color:'#64748b'}}/>
            <input type="text" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%',padding:'12px 16px 12px 48px',borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(15,23,42,0.5)',color:'#fff',fontSize:'0.9rem',outline:'none'}}/>
          </div>
          <button onClick={handleSync} disabled={syncing} style={{padding:'12px 24px',borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'#fff',cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontWeight:600,fontSize:'0.9rem'}}>
            <RefreshCw size={18} className={syncing?'spin':''}/> {syncing?'Syncing...':'Sync'}
          </button>
          <button onClick={handleRecalculate} disabled={calculating} style={{padding:'12px 24px',borderRadius:12,border:'none',background:'linear-gradient(135deg,#6366f1 0%,#4f46e5 100%)',color:'#fff',cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontWeight:600,fontSize:'0.9rem',boxShadow:'0 10px 20px rgba(99,102,241,0.3)'}}>
            <BarChart3 size={18}/> {calculating?'Processing...':'Run Forecast'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:8,marginBottom:32,borderBottom:'1px solid rgba(255,255,255,0.05)',paddingBottom:0}}>
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{padding:'14px 24px',borderRadius:'12px 12px 0 0',border:'none',background:activeTab===t.key?'rgba(99,102,241,0.15)':'transparent',color:activeTab===t.key?'#818cf8':'#94a3b8',cursor:'pointer',fontWeight:700,fontSize:'0.95rem',display:'flex',alignItems:'center',gap:10,borderBottom:activeTab===t.key?'2px solid #6366f1':'2px solid transparent',transition:'all 0.2s'}}>
            <t.icon size={18}/> {t.label}
            <span style={{background:'rgba(255,255,255,0.1)',padding:'2px 8px',borderRadius:10,fontSize:'0.75rem',fontWeight:600}}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{minHeight:400}}>
        {loading ? (
          <div style={{height:400,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#94a3b8'}}>
            <RefreshCw size={48} className="spin" style={{marginBottom:16,opacity:0.5}}/><div style={{fontSize:'1.1rem',fontWeight:500}}>Loading...</div>
          </div>
        ) : (
          <>
            {activeTab==='storage' && renderStorageTab()}
            {activeTab==='san' && renderSanTab()}
            {activeTab==='virtualization' && renderVirtTab()}
          </>
        )}
      </div>

      {/* Graph Modal */}
      {modal && (
        <div style={{position:'fixed',inset:0,zIndex:1100,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
          <div style={{position:'absolute',inset:0,background:'rgba(2,6,23,0.85)',backdropFilter:'blur(12px)'}} onClick={()=>setModal(null)}/>
          <div style={{position:'relative',width:900,maxWidth:'100%',maxHeight:'90vh',overflowY:'auto',background:'#0f172a',borderRadius:28,border:'1px solid rgba(255,255,255,0.1)',boxShadow:'0 50px 100px rgba(0,0,0,0.5)',animation:'modalIn 0.4s cubic-bezier(0.16,1,0.3,1)'}}>
            <div style={{padding:'28px 32px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <h2 style={{fontSize:'1.5rem',fontWeight:800,margin:0}}>{modal.object_name}</h2>
                <div style={{fontSize:'0.85rem',color:'#94a3b8',marginTop:4}}>{metricLabel(modal.metric_name)} — Trend Analysis</div>
              </div>
              <button onClick={()=>setModal(null)} style={{padding:10,borderRadius:10,background:'rgba(255,255,255,0.05)',border:'none',color:'#fff',cursor:'pointer'}}><X size={20}/></button>
            </div>
            <div style={{padding:32}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:16,marginBottom:28}}>
                {[{l:'Current',v:modal.current_value,h:true},{l:'1 Year',v:modal.pred_1y},{l:'2 Years',v:modal.pred_2y},{l:'3 Years',v:modal.pred_3y}].map((c,i)=>(
                  <div key={i} style={{padding:18,borderRadius:16,background:c.h?'rgba(30,41,59,0.4)':'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.05)'}}>
                    <div style={{fontSize:'0.75rem',color:'#94a3b8',textTransform:'uppercase',marginBottom:8,fontWeight:600}}>{c.l}</div>
                    <div style={{fontSize:'1.3rem',fontWeight:800,color:c.h?getRiskLevel(modal.risk_level).color:'#f8fafc'}}>{fmtVal(c.v,modal.metric_name)}</div>
                  </div>
                ))}
              </div>
              <div style={{background:'rgba(15,23,42,0.5)',borderRadius:20,padding:28,border:'1px solid rgba(255,255,255,0.05)'}}>
                <h3 style={{margin:'0 0 24px',fontSize:'1rem',fontWeight:700}}>180-Day Trend</h3>
                {historyLoading ? (
                  <div style={{height:280,display:'flex',alignItems:'center',justifyContent:'center'}}><RefreshCw className="spin" size={32}/></div>
                ) : historyData.length < 2 ? (
                  <div style={{height:280,display:'flex',alignItems:'center',justifyContent:'center',color:'#64748b'}}>Insufficient data for trend chart.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={historyData}>
                      <defs><linearGradient id="cTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                      <XAxis dataKey="date" tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={{background:'#0f172a',border:'1px solid rgba(255,255,255,0.1)',borderRadius:12}} itemStyle={{color:'#fff'}}/>
                      <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#cTrend)"/>
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html:`
        @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
        @keyframes modalIn{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
        .spin{animation:spin 2s linear infinite}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      `}}/>
    </div>
  );
}

function EmptyState({text}) {
  return (
    <div style={{height:300,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#64748b'}}>
      <Search size={56} style={{marginBottom:20,opacity:0.2}}/>
      <div style={{fontSize:'1.1rem',fontWeight:600,marginBottom:6}}>No Data</div>
      <div style={{fontSize:'0.9rem'}}>{text}</div>
    </div>
  );
}
