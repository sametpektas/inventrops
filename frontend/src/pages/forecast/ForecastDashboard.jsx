import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { 
  BarChart3, 
  Database, 
  Server, 
  Network, 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  Calendar,
  Search,
  Filter,
  RefreshCw,
  ArrowRight,
  Info,
  ChevronDown,
  ChevronRight,
  Box,
  Cpu,
  MemoryStick
} from 'lucide-react';
import api from '../../api/client';

function getRiskLevel(level) {
  const configs = {
    red: { label: 'Critical', color: '#f43f5e', icon: AlertTriangle, bg: 'rgba(244, 63, 94, 0.1)' },
    orange: { label: 'High Risk', color: '#fb923c', icon: Activity, bg: 'rgba(251, 146, 60, 0.1)' },
    yellow: { label: 'Warning', color: '#facc15', icon: Info, bg: 'rgba(250, 204, 21, 0.1)' },
    green: { label: 'Healthy', color: '#10b981', icon: CheckCircle2, bg: 'rgba(16, 185, 129, 0.1)' },
  };
  return configs[level] || configs.green;
}

export default function ForecastDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  
  // Accordion state per Datacenter
  const [openDCs, setOpenDCs] = useState({});

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/forecast/summary');
      setData(res.results || []);
    } catch (err) {
      setToast({ message: 'Failed to fetch analytics data', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/forecast/sync', {});
      setToast({ message: `Inventory synchronization successful`, type: 'success' });
      fetchData();
    } catch (err) {
      setToast({ message: 'Sync failed', type: 'error' });
    } finally {
      setSyncing(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleRecalculate = async () => {
    setCalculating(true);
    try {
      await api.post('/forecast/recalculate', {});
      setToast({ message: 'Forecasting engine recalculated successfully', type: 'success' });
      fetchData();
    } catch (err) {
      setToast({ message: 'Recalculation failed', type: 'error' });
    } finally {
      setCalculating(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const toggleDC = (dcName) => {
    setOpenDCs(prev => ({ ...prev, [dcName]: !prev[dcName] }));
  };

  // 1. Filter out only clusters
  const clusterData = data.filter(d => d.object_type === 'cluster');

  // 2. Group metrics by Cluster ID
  const clustersById = {};
  clusterData.forEach(metricRow => {
    if (!clustersById[metricRow.object_id]) {
      let dcName = 'Unknown DC';
      let clusterName = metricRow.object_name;
      
      if (metricRow.object_name.includes(' | ')) {
        const parts = metricRow.object_name.split(' | ');
        dcName = parts[0];
        clusterName = parts[1];
      }

      clustersById[metricRow.object_id] = {
        id: metricRow.object_id,
        name: clusterName,
        dc: dcName,
        metrics: {}
      };
    }
    clustersById[metricRow.object_id].metrics[metricRow.metric_name] = metricRow;
  });

  // 3. Group Clusters by Datacenter
  const dcGroups = {};
  Object.values(clustersById).forEach(cluster => {
    if (!cluster.name.toLowerCase().includes(search.toLowerCase()) && 
        !cluster.dc.toLowerCase().includes(search.toLowerCase())) {
      return;
    }
    if (!dcGroups[cluster.dc]) dcGroups[cluster.dc] = [];
    dcGroups[cluster.dc].push(cluster);
  });

  // Sort DCs alphabetically
  const sortedDCs = Object.keys(dcGroups).sort();

  // Helper to format absolute values dynamically based on total capacity
  const renderAbsoluteText = (percentValue, clusterMetrics, isCpu) => {
    if (percentValue === null || percentValue === undefined) return null;
    
    if (isCpu) {
      // Find CPU total capacity
      const totalKey = Object.keys(clusterMetrics).find(k => k.includes('cpu_totalCapacity') || k.includes('cpu_capacity'));
      const totalRow = totalKey ? clusterMetrics[totalKey] : null;
      if (totalRow && totalRow.current_value) {
        // Assume value is in MHz
        const totalGhz = (totalRow.current_value / 1000);
        const usedGhz = totalGhz * (percentValue / 100);
        // If it looks like core count (small number), format differently
        if (totalRow.current_value < 5000) {
           return `${Math.round(totalRow.current_value * (percentValue/100))} used of ${Math.round(totalRow.current_value)} vCPU`;
        }
        return `${usedGhz.toFixed(1)} GHz used of ${totalGhz.toFixed(1)} GHz`;
      }
      return null;
    } else {
      // Find RAM total capacity
      const totalKey = Object.keys(clusterMetrics).find(k => k.includes('mem_host_usable') || k.includes('mem_capacity'));
      const totalRow = totalKey ? clusterMetrics[totalKey] : null;
      if (totalRow && totalRow.current_value) {
        // Value might be KB. Check magnitude
        let totalGb = totalRow.current_value;
        if (totalRow.current_value > 1024 * 1024) {
           totalGb = totalRow.current_value / (1024 * 1024); // KB to GB
        }
        let usedGb = totalGb * (percentValue / 100);
        
        let totalText = totalGb > 1024 ? `${(totalGb / 1024).toFixed(1)} TB` : `${totalGb.toFixed(0)} GB`;
        let usedText = usedGb > 1024 ? `${(usedGb / 1024).toFixed(1)} TB` : `${usedGb.toFixed(0)} GB`;
        
        return `${usedText} used of ${totalText}`;
      }
      return null;
    }
  };

  const renderMetricLine = (label, icon, metricPercent, metricTotals, isCpu) => {
    if (!metricPercent) return null;
    const risk = getRiskLevel(metricPercent.risk_level);
    const absoluteText = renderAbsoluteText(metricPercent.current_value, metricTotals, isCpu);

    return (
      <div style={{
        background: 'rgba(15, 23, 42, 0.4)', borderRadius: '16px', padding: '16px 20px',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, border: '1px solid rgba(255,255,255,0.03)', position: 'relative'
      }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: risk.color }}></div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
          <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f8fafc' }}>{label}</div>
            {absoluteText && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>{absoluteText}</div>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(80px, 1fr))', gap: 16, flex: '1 1 auto' }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Current</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: risk.color }}>{Number(metricPercent.current_value).toFixed(1)}%</div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>1 Year</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#cbd5e1' }}>{metricPercent.pred_1y ? Number(metricPercent.pred_1y).toFixed(1) + '%' : '-'}</div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>2 Years</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#cbd5e1' }}>{metricPercent.pred_2y ? Number(metricPercent.pred_2y).toFixed(1) + '%' : '-'}</div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: '6px', background: risk.bg, color: risk.color, fontSize: '0.7rem', fontWeight: 700 }}>
              <risk.icon size={12} /> {risk.label}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="forecast-dashboard" style={{ padding: '32px', color: '#fff', minHeight: '100vh', background: 'radial-gradient(circle at 0% 0%, #1a1c2e 0%, #0f111a 100%)' }}>
      
      {toast && (
        <div style={{
          position: 'fixed', top: 32, right: 32, zIndex: 1000,
          padding: '16px 24px', borderRadius: '16px',
          background: 'rgba(30, 41, 59, 0.8)', backdropFilter: 'blur(12px)',
          border: `1px solid ${toast.type === 'success' ? '#10b981' : '#f43f5e'}`,
          boxShadow: '0 20px 40px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 12,
          animation: 'slideIn 0.3s ease-out'
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={20} color="#10b981" /> : <AlertTriangle size={20} color="#f43f5e" />}
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 40 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#6366f1', fontWeight: 600, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            <TrendingUp size={18} /> Predictive Analytics
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Datacenter Capacity
          </h1>
          <p style={{ color: '#94a3b8', marginTop: 12, fontSize: '1rem', maxWidth: 600 }}>
            Real-time cluster infrastructure forecasting. Expand a Datacenter to view CPU and RAM growth trends.
          </p>
        </div>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ position: 'relative', width: 280 }}>
            <Search size={18} style={{ position: 'absolute', left: 16, top: 13, color: '#64748b' }} />
            <input 
              type="text" 
              placeholder="Search datacenters or clusters..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '12px 16px 12px 48px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(15, 23, 42, 0.5)', color: '#fff', fontSize: '0.9rem', outline: 'none'
              }}
            />
          </div>
          <button 
            onClick={handleSync} 
            disabled={syncing}
            style={{
              padding: '12px 24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem',
              transition: 'all 0.2s ease', backdropFilter: 'blur(8px)'
            }}
          >
            <RefreshCw size={18} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button 
            onClick={handleRecalculate}
            disabled={calculating}
            style={{
              padding: '12px 24px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem',
              boxShadow: '0 10px 20px rgba(99, 102, 241, 0.3)', transition: 'all 0.2s ease'
            }}
          >
            <BarChart3 size={18} /> {calculating ? 'Processing...' : 'Run Forecast'}
          </button>
        </div>
      </div>

      {/* Main Content Area - Accordions */}
      <div style={{ minHeight: 600 }}>
        {loading ? (
          <div style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            <RefreshCw size={48} className="spin" style={{ marginBottom: 16, opacity: 0.5 }} />
            <div style={{ fontSize: '1.1rem', fontWeight: 500 }}>Analyzing Infrastructure Data...</div>
          </div>
        ) : sortedDCs.length === 0 ? (
          <div style={{ height: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <Search size={64} style={{ marginBottom: 24, opacity: 0.2 }} />
            <div style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>No Datacenters Found</div>
            <div style={{ fontSize: '0.95rem' }}>Sync vROps to populate physical capacity data.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {sortedDCs.map(dcName => {
              const isOpen = openDCs[dcName] !== false; // Default to open
              const clusters = dcGroups[dcName];

              return (
                <div key={dcName} style={{ 
                  background: 'rgba(30, 41, 59, 0.3)', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.05)', 
                  overflow: 'hidden'
                }}>
                  <div 
                    onClick={() => toggleDC(dcName)}
                    style={{ 
                      padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                      cursor: 'pointer', background: isOpen ? 'rgba(255,255,255,0.02)' : 'transparent',
                      transition: 'background 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ padding: 10, background: 'rgba(99, 102, 241, 0.1)', borderRadius: 12, color: '#818cf8' }}>
                        <Box size={24} />
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc' }}>{dcName}</h3>
                        <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: 4 }}>{clusters.length} active clusters</div>
                      </div>
                    </div>
                    <div style={{ color: '#64748b', padding: 8, background: 'rgba(255,255,255,0.05)', borderRadius: '50%' }}>
                      {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </div>
                  </div>
                  
                  {isOpen && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '24px', display: 'flex', flexDirection: 'column', gap: 32 }}>
                      {clusters.map(cluster => (
                        <div key={cluster.id} style={{ 
                          background: 'rgba(15, 23, 42, 0.3)', borderRadius: '20px', padding: '24px', 
                          border: '1px solid rgba(99, 102, 241, 0.1)' 
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                            <Server size={20} color="#818cf8" />
                            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>{cluster.name}</h4>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {renderMetricLine('CPU Utilization', <Cpu color="#f43f5e" size={18} />, cluster.metrics['cpu_usage_percent'], cluster.metrics, true)}
                            {renderMetricLine('Memory Utilization', <MemoryStick color="#10b981" size={18} />, cluster.metrics['memory_usage_percent'], cluster.metrics, false)}
                            
                            {(!cluster.metrics['cpu_usage_percent'] && !cluster.metrics['memory_usage_percent']) && (
                              <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                                Awaiting capacity analytics for this cluster. Run a sync to pull current data.
                              </div>
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
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
