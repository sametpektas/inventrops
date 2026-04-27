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
  Info
} from 'lucide-react';
import api from '../../api/client';

function formatCapacity(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  const v = Number(value);
  if (v === 0) return '0 TB';
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(2) + ' PB';
  return (v / 1024).toFixed(2) + ' TB';
}

function formatMetricValue(value, metricName) {
  if (value === null || value === undefined) return '-';
  const v = Number(value);
  if (metricName.includes('percent')) return v.toFixed(1) + '%';
  if (metricName === 'capacity_total' || metricName === 'capacity_used') return formatCapacity(v);
  if (metricName.includes('iops')) return v.toLocaleString() + ' IOPS';
  if (metricName.includes('latency')) return v.toFixed(2) + ' ms';
  if (metricName.includes('cpu') || metricName.includes('memory')) return v.toFixed(1) + '%';
  return v.toLocaleString();
}

function getRiskLevel(level) {
  const configs = {
    red: { label: 'Critical', color: '#f43f5e', icon: AlertTriangle, bg: 'rgba(244, 63, 94, 0.1)' },
    orange: { label: 'High Risk', color: '#fb923c', icon: Activity, bg: 'rgba(251, 146, 60, 0.1)' },
    yellow: { label: 'Warning', color: '#facc15', icon: Info, bg: 'rgba(250, 204, 21, 0.1)' },
    green: { label: 'Healthy', color: '#10b981', icon: CheckCircle2, bg: 'rgba(16, 185, 129, 0.1)' },
  };
  return configs[level] || configs.green;
}

function getMetricLabel(name) {
  const labels = {
    capacity_total: 'Total Capacity',
    capacity_used: 'Used Capacity',
    capacity_used_percent: 'Capacity Usage',
    port_utilization_percent: 'Port Utilization',
    cpu_usage_percent: 'CPU Performance',
    memory_usage_percent: 'Memory Usage',
  };
  return labels[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function ForecastDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
      setToast({ message: `Inventory synchronization successful — ${res.totalSynced || 0} metrics updated`, type: 'success' });
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

  const openDetail = async (item) => {
    setSelectedItem(item);
    setHistoryLoading(true);
    try {
      const res = await api.get(`/forecast/${item.object_id}/history`);
      const snapshots = (res.results || [])
        .filter(s => s.metric_name === item.metric_name)
        .map(s => ({
          date: new Date(s.captured_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: s.metric_value,
        }));
      setHistoryData(snapshots);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const typeFilters = [
    { key: 'all', label: 'All Items', icon: BarChart3 },
    { key: 'storage', label: 'Storage Units', icon: Database },
    { key: 'san', label: 'SAN Fabrics', icon: Network },
    { key: 'server', label: 'Compute Nodes', icon: Server },
  ];

  const filteredData = data
    .filter(d => filter === 'all' || d.object_type === filter)
    .filter(d => d.metric_name.includes('percent') || d.metric_name.includes('utilization'))
    .filter(d => d.object_name.toLowerCase().includes(search.toLowerCase()));

  const stats = {
    critical: data.filter(d => d.risk_level === 'red').length,
    warning: data.filter(d => d.risk_level === 'orange' || d.risk_level === 'yellow').length,
    total: filteredData.length
  };

  return (
    <div className="forecast-dashboard" style={{ padding: '32px', color: '#fff', minHeight: '100vh', background: 'radial-gradient(circle at 0% 0%, #1a1c2e 0%, #0f111a 100%)' }}>
      
      {/* Toast Notification */}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 40 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#6366f1', fontWeight: 600, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            <TrendingUp size={18} /> Predictive Analytics
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Capacity Intelligence
          </h1>
          <p style={{ color: '#94a3b8', marginTop: 12, fontSize: '1rem', maxWidth: 600 }}>
            Real-time infrastructure forecasting and risk assessment. Our AI engine analyzes 180 days of historical data to predict future requirements.
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: 12 }}>
          <button 
            onClick={handleSync} 
            disabled={syncing}
            style={{
              padding: '12px 24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem',
              transition: 'all 0.2s ease', backdropFilter: 'blur(8px)'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <RefreshCw size={18} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing...' : 'Inventory Sync'}
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
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <BarChart3 size={18} /> {calculating ? 'Processing...' : 'Run Forecast'}
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, marginBottom: 40 }}>
        {[
          { label: 'Total Objects', value: stats.total, icon: Database, color: '#6366f1' },
          { label: 'Critical Risk', value: stats.critical, icon: AlertTriangle, color: '#f43f5e' },
          { label: 'Warning Status', value: stats.warning, icon: AlertTriangle, color: '#fb923c' },
          { label: 'System Health', value: '98.4%', icon: Activity, color: '#10b981' },
        ].map((card, i) => (
          <div key={i} style={{
            background: 'rgba(30, 41, 59, 0.4)', borderRadius: '24px', padding: '24px',
            border: '1px solid rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)',
            position: 'relative', overflow: 'hidden'
          }}>
            <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.05 }}>
              <card.icon size={120} color={card.color} />
            </div>
            <div style={{ color: card.color, marginBottom: 12 }}><card.icon size={24} /></div>
            <div style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 4 }}>{card.value}</div>
            <div style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 32 }}>
        
        {/* Navigation Sidebar */}
        <div>
          <div style={{ position: 'sticky', top: 32 }}>
            <div style={{ marginBottom: 32 }}>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Search Inventory</div>
              <div style={{ position: 'relative' }}>
                <Search size={18} style={{ position: 'absolute', left: 16, top: 14, color: '#64748b' }} />
                <input 
                  type="text" 
                  placeholder="Filter by name..." 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{
                    width: '100%', padding: '14px 16px 14px 48px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(15, 23, 42, 0.5)', color: '#fff', fontSize: '0.9rem', outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>Asset Types</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {typeFilters.map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: '12px',
                    border: 'none', background: filter === f.key ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                    color: filter === f.key ? '#818cf8' : '#94a3b8', cursor: 'pointer', transition: 'all 0.2s ease',
                    textAlign: 'left', fontWeight: 600, fontSize: '0.95rem'
                  }}
                >
                  <f.icon size={20} /> {f.label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 40, padding: 24, borderRadius: 20, background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(244, 63, 94, 0.05) 100%)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#818cf8', marginBottom: 12 }}>
                <TrendingUp size={16} /> <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>AI Insight</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.6 }}>
                Based on current trends, 4 storage units will reach 90% capacity within 18 months.
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div style={{ background: 'rgba(30, 41, 59, 0.2)', borderRadius: '32px', border: '1px solid rgba(255,255,255,0.05)', padding: '24px', minHeight: 600 }}>
          {loading ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
              <RefreshCw size={48} className="spin" style={{ marginBottom: 16, opacity: 0.5 }} />
              <div style={{ fontSize: '1.1rem', fontWeight: 500 }}>Analyzing Infrastructure Data...</div>
            </div>
          ) : filteredData.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
              <Search size={64} style={{ marginBottom: 24, opacity: 0.2 }} />
              <div style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>No Assets Found</div>
              <div style={{ fontSize: '0.95rem' }}>Try adjusting your filters or sync new data.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {filteredData.map(item => {
                const risk = getRiskLevel(item.risk_level);
                return (
                  <div 
                    key={item.id}
                    onClick={() => openDetail(item)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.4)', borderRadius: '20px', padding: '20px 24px',
                      display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr auto', alignItems: 'center',
                      gap: 24, border: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer',
                      transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(30, 41, 59, 0.6)';
                      e.currentTarget.style.transform = 'scale(1.01)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(15, 23, 42, 0.4)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: risk.color }}></div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ width: 48, height: 48, borderRadius: '14px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {item.object_type === 'storage' ? <Database size={20} color="#818cf8" /> : item.object_type === 'san' ? <Network size={20} color="#818cf8" /> : <Server size={20} color="#818cf8" />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 2 }}>{item.object_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{getMetricLabel(item.metric_name)}</div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Current Utilization</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: risk.color }}>{formatMetricValue(item.current_value, item.metric_name)}</div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>1 Year</div>
                      <div style={{ fontWeight: 600 }}>{formatMetricValue(item.pred_1y, item.metric_name)}</div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>2 Years</div>
                      <div style={{ fontWeight: 600 }}>{formatMetricValue(item.pred_2y, item.metric_name)}</div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>3 Years</div>
                      <div style={{ fontWeight: 600 }}>{formatMetricValue(item.pred_3y, item.metric_name)}</div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Status</div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: '8px', background: risk.bg, color: risk.color, fontSize: '0.75rem', fontWeight: 700 }}>
                        <risk.icon size={14} /> {risk.label}
                      </div>
                    </div>

                    <div style={{ color: '#64748b' }}>
                      <ArrowRight size={20} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(12px)' }} onClick={() => setSelectedItem(null)}></div>
          <div style={{
            position: 'relative', width: 1000, maxWidth: '100%', background: '#0f172a', borderRadius: '32px', border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden', boxShadow: '0 50px 100px rgba(0,0,0,0.5)', animation: 'modalIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            <div style={{ padding: '32px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ padding: '8px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8' }}>
                    {selectedItem.object_type === 'storage' ? <Database size={24} /> : <Network size={24} />}
                  </div>
                  <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>{selectedItem.object_name}</h2>
                </div>
                <div style={{ display: 'flex', gap: 16, color: '#94a3b8', fontSize: '0.9rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Calendar size={16} /> Registered: 6 Months Ago</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Database size={16} /> Type: {selectedItem.object_type.toUpperCase()}</span>
                </div>
              </div>
              <button 
                onClick={() => setSelectedItem(null)}
                style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer' }}
              >✕</button>
            </div>

            <div style={{ padding: 32 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
                <div style={{ padding: '20px', borderRadius: '20px', background: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>Current Usage</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: getRiskLevel(selectedItem.risk_level).color }}>{formatMetricValue(selectedItem.current_value, selectedItem.metric_name)}</div>
                </div>
                <div key="p1y" style={{ background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Forecast 1 Year</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{formatMetricValue(selectedItem.pred_1y, selectedItem.metric_name)}</div>
                </div>
                <div key="p2y" style={{ background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Forecast 2 Years</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{formatMetricValue(selectedItem.pred_2y, selectedItem.metric_name)}</div>
                </div>
                <div key="p3y" style={{ background: 'rgba(255,255,255,0.03)', padding: '20px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Forecast 3 Years</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{formatMetricValue(selectedItem.pred_3y, selectedItem.metric_name)}</div>
                </div>
              </div>

              <div style={{ background: 'rgba(15, 23, 42, 0.5)', borderRadius: '24px', padding: '32px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Trend Analysis (180 Days)</h3>
                  <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Metric: {getMetricLabel(selectedItem.metric_name)}</div>
                </div>
                
                {historyLoading ? (
                  <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RefreshCw className="spin" size={32} /></div>
                ) : historyData.length < 2 ? (
                  <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Insufficient historical data for visual trending.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={historyData}>
                      <defs>
                        <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorTrend)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes modalIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />
    </div>
  );
}
