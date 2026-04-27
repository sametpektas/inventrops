import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import api from '../../api/client';

function formatCapacity(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  const v = Number(value);
  if (v === 0) return '0 TB';
  if (v >= 1024) return (v / 1024).toFixed(2) + ' PB';
  if (v >= 1) return v.toFixed(2) + ' TB';
  return (v * 1024).toFixed(0) + ' GB';
}

function formatMetricValue(value, metricName) {
  if (value === null || value === undefined) return '-';
  const v = Number(value);
  if (metricName.includes('percent')) return v.toFixed(1) + '%';
  if (metricName === 'capacity_total' || metricName === 'capacity_used') return formatCapacity(v);
  if (metricName.includes('iops')) return v.toLocaleString() + ' IOPS';
  if (metricName.includes('latency')) return v.toFixed(2) + ' ms';
  if (metricName.includes('cpu')) return v.toFixed(1) + '%';
  if (metricName.includes('memory') || metricName.includes('mem')) return v.toFixed(1) + '%';
  return v.toLocaleString();
}

function getRiskColor(level) {
  const colors = {
    red: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
    orange: { bg: 'rgba(249, 115, 22, 0.15)', text: '#f97316', border: 'rgba(249, 115, 22, 0.3)' },
    yellow: { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308', border: 'rgba(234, 179, 8, 0.3)' },
    green: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.3)' },
  };
  return colors[level] || colors.green;
}

function getMetricLabel(name) {
  const labels = {
    capacity_total: 'Total Capacity',
    capacity_used: 'Used Capacity',
    capacity_used_percent: 'Capacity Usage %',
    port_utilization_percent: 'Port Utilization %',
    cpu_usage_percent: 'CPU Usage %',
    memory_usage_percent: 'Memory Usage %',
    iops: 'IOPS',
    latency_ms: 'Latency',
  };
  return labels[name] || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getTypeIcon(type) {
  if (type === 'storage') return '💾';
  if (type === 'san') return '🔗';
  if (type === 'server') return '🖥️';
  if (type === 'virtualization') return '☁️';
  return '📊';
}

export default function ForecastDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/forecast/summary');
      setData(res.results || []);
    } catch (err) {
      showToast('Failed to fetch forecast summary', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/forecast/sync', {});
      showToast(`Sync complete — ${res.totalSynced || 0} metrics collected`, 'success');
    } catch (err) {
      showToast('Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleRecalculate = async () => {
    setCalculating(true);
    try {
      const res = await api.post('/forecast/recalculate', {});
      showToast(`Recalculated ${res.calculatedCount || 0} forecasts`, 'success');
      fetchData();
    } catch (err) {
      showToast('Recalculation failed', 'error');
    } finally {
      setCalculating(false);
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
          date: new Date(s.captured_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }),
          fullDate: new Date(s.captured_at).toLocaleDateString('tr-TR'),
          value: s.metric_value,
        }));
      setHistoryData(snapshots);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedItem(null);
    setHistoryData([]);
  };

  // Summary stats
  const criticalCount = data.filter(d => d.risk_level === 'red').length;
  const warningCount = data.filter(d => d.risk_level === 'orange' || d.risk_level === 'yellow').length;
  const healthyCount = data.filter(d => d.risk_level === 'green').length;

  const typeFilters = [
    { key: 'all', label: 'All', icon: '📊' },
    { key: 'storage', label: 'Storage', icon: '💾' },
    { key: 'san', label: 'SAN', icon: '🔗' },
    { key: 'server', label: 'Server', icon: '🖥️' },
  ];

  const filteredData = filter === 'all' ? data : data.filter(d => d.object_type === filter);

  return (
    <div className="page-container">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: '8px',
          background: toast.type === 'success' ? '#059669' : '#dc2626',
          color: '#fff', fontSize: '0.875rem', fontWeight: 500,
          boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
        }}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Capacity Forecast</h1>
        <div className="page-actions">
          <button className="btn btn--secondary" onClick={handleSync} disabled={syncing}>
            {syncing ? '⏳ Syncing...' : '🔄 Sync Metrics'}
          </button>
          <button className="btn btn--primary" onClick={handleRecalculate} disabled={calculating}>
            {calculating ? '⏳ Calculating...' : '📊 Recalculate'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {[
          { count: criticalCount, label: 'Critical', color: '#ef4444' },
          { count: warningCount, label: 'Warning', color: '#f97316' },
          { count: healthyCount, label: 'Healthy', color: '#22c55e' },
          { count: data.length, label: 'Total Metrics', color: '#6366f1' },
        ].map(card => (
          <div key={card.label} style={{
            background: `${card.color}11`, border: `1px solid ${card.color}33`,
            borderRadius: '12px', padding: '20px', textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: card.color }}>{card.count}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {typeFilters.map(f => {
          const count = f.key === 'all' ? data.length : data.filter(d => d.object_type === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '0.82rem', fontWeight: filter === f.key ? 600 : 400,
                background: filter === f.key ? 'var(--primary)' : 'var(--bg-secondary, rgba(255,255,255,0.05))',
                color: filter === f.key ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.2s ease',
              }}
            >
              {f.icon} {f.label} <span style={{ opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Data Table */}
      <div className="card">
        <div className="table-responsive">
          <table className="table" style={{ fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Device</th>
                <th>Type</th>
                <th>Metric</th>
                <th style={{ textAlign: 'right' }}>Current</th>
                <th style={{ textAlign: 'right' }}>30d</th>
                <th style={{ textAlign: 'right' }}>90d</th>
                <th style={{ textAlign: 'right' }}>180d</th>
                <th style={{ textAlign: 'center' }}>Warning</th>
                <th style={{ textAlign: 'center' }}>Critical</th>
                <th style={{ textAlign: 'center' }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                  <div className="spinner" style={{ margin: '0 auto 12px' }} />Loading...
                </td></tr>
              ) : filteredData.length === 0 ? (
                <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                  No forecast data. Click <strong>Sync Metrics</strong> then <strong>Recalculate</strong>.
                </td></tr>
              ) : (
                filteredData.map((item) => {
                  const risk = getRiskColor(item.risk_level);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => openDetail(item)}
                      style={{ borderLeft: `3px solid ${risk.text}`, cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <td style={{ fontWeight: 600 }}>
                        {getTypeIcon(item.object_type)} {item.object_name}
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8'
                        }}>
                          {item.object_type}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{getMetricLabel(item.metric_name)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                        {formatMetricValue(item.current_value, item.metric_name)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {formatMetricValue(item.pred_30d, item.metric_name)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {formatMetricValue(item.pred_90d, item.metric_name)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {formatMetricValue(item.pred_180d, item.metric_name)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {item.days_to_warning != null
                          ? <span style={{ fontWeight: 600, color: item.days_to_warning < 30 ? '#f97316' : 'var(--text-secondary)' }}>{item.days_to_warning}d</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {item.days_to_critical != null
                          ? <span style={{ fontWeight: 600, color: item.days_to_critical < 30 ? '#ef4444' : 'var(--text-secondary)' }}>{item.days_to_critical}d</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '6px',
                          fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                          background: risk.bg, color: risk.text, border: `1px solid ${risk.border}`
                        }}>
                          {item.risk_level}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal with Chart */}
      {selectedItem && (
        <div className="modal" style={{ display: 'flex' }} onClick={closeDetail}>
          <div className="modal-content" style={{ width: '850px', maxWidth: '95%', maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {getTypeIcon(selectedItem.object_type)}
                {selectedItem.object_name}
                <span style={{
                  fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px',
                  background: 'rgba(99,102,241,0.1)', color: '#818cf8', fontWeight: 400,
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: 4
                }}>
                  {selectedItem.object_type}
                </span>
              </h2>
              <button className="modal-close" onClick={closeDetail}>✕</button>
            </div>
            <div className="modal-body">
              {/* Metric Info Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                <div style={{ background: 'var(--bg-secondary, rgba(255,255,255,0.04))', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Metric</div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{getMetricLabel(selectedItem.metric_name)}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary, rgba(255,255,255,0.04))', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Current</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: getRiskColor(selectedItem.risk_level).text }}>
                    {formatMetricValue(selectedItem.current_value, selectedItem.metric_name)}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-secondary, rgba(255,255,255,0.04))', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>30 Day</div>
                  <div style={{ fontWeight: 600 }}>{formatMetricValue(selectedItem.pred_30d, selectedItem.metric_name)}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary, rgba(255,255,255,0.04))', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>90 Day</div>
                  <div style={{ fontWeight: 600 }}>{formatMetricValue(selectedItem.pred_90d, selectedItem.metric_name)}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary, rgba(255,255,255,0.04))', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Risk Level</div>
                  <div>
                    <span style={{
                      padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700,
                      textTransform: 'uppercase',
                      background: getRiskColor(selectedItem.risk_level).bg,
                      color: getRiskColor(selectedItem.risk_level).text,
                      border: `1px solid ${getRiskColor(selectedItem.risk_level).border}`
                    }}>
                      {selectedItem.risk_level}
                    </span>
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div style={{ background: 'var(--bg-secondary, rgba(255,255,255,0.04))', borderRadius: '12px', padding: '24px' }}>
                <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16, fontWeight: 500 }}>
                  📈 Historical Trend — {getMetricLabel(selectedItem.metric_name)}
                </h3>
                {historyLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                    <div className="spinner" style={{ margin: '0 auto 12px' }} /> Loading chart data...
                  </div>
                ) : historyData.length < 2 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                    Not enough data points for chart. Run <strong>Sync Metrics</strong> over multiple days to build history.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={historyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={getRiskColor(selectedItem.risk_level).text} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={getRiskColor(selectedItem.risk_level).text} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                        tickFormatter={v => {
                          if (selectedItem.metric_name.includes('percent')) return v.toFixed(0) + '%';
                          if (selectedItem.metric_name === 'capacity_total' || selectedItem.metric_name === 'capacity_used') return formatCapacity(v);
                          return v.toLocaleString();
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                        }}
                        labelStyle={{ color: 'var(--text-secondary)' }}
                        formatter={(value) => [formatMetricValue(value, selectedItem.metric_name), getMetricLabel(selectedItem.metric_name)]}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={getRiskColor(selectedItem.risk_level).text}
                        strokeWidth={2}
                        fill="url(#colorValue)"
                        dot={{ r: 3, fill: getRiskColor(selectedItem.risk_level).text }}
                        activeDot={{ r: 5 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Warning/Critical Info */}
              {(selectedItem.days_to_warning != null || selectedItem.days_to_critical != null) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                  {selectedItem.days_to_warning != null && (
                    <div style={{
                      background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.2)',
                      borderRadius: '10px', padding: '16px', display: 'flex', alignItems: 'center', gap: 12
                    }}>
                      <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#f97316', textTransform: 'uppercase' }}>Warning Threshold</div>
                        <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{selectedItem.days_to_warning} days</div>
                      </div>
                    </div>
                  )}
                  {selectedItem.days_to_critical != null && (
                    <div style={{
                      background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '10px', padding: '16px', display: 'flex', alignItems: 'center', gap: 12
                    }}>
                      <span style={{ fontSize: '1.5rem' }}>🔴</span>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: '#ef4444', textTransform: 'uppercase' }}>Critical Threshold</div>
                        <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{selectedItem.days_to_critical} days</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
