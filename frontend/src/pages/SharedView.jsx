import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = ['#00D4AA', '#FF6B35', '#58A6FF', '#F0C000', '#F85149', '#8B949E'];

export default function SharedView() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/inventory/shared/${token}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Link not found' : 'Link expired');
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  if (error) {
    return (
      <div className="login-page">
        <div className="login-container" style={{ textAlign: 'center' }}>
          <div className="login-logo" style={{ background: 'var(--red)' }}>
            <span style={{ fontSize: '1.5rem', color: 'var(--bg-base)' }}>!</span>
          </div>
          <h2 style={{ marginBottom: 8 }}>Shared Link Unavailable</h2>
          <p style={{ color: 'var(--text-muted)' }}>{error}</p>
        </div>
      </div>
    );
  }

  const vendorChartData = (data.vendor_distribution || []).map(v => ({
    name: v.vendor_name, value: v.count,
  }));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <div className="shared-banner">
        <span>🔗</span>
        <span>Readonly Dashboard — {data.team_name}</span>
        {data.label && <span style={{ opacity: 0.7 }}> — {data.label}</span>}
      </div>

      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{
          fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em',
          marginBottom: 24,
        }}>
          {data.team_name} — Inventory Overview
        </h1>

        <div className="stat-grid">
          <div className="stat-card stat-card--teal">
            <div className="stat-card__label">Total</div>
            <div className="stat-card__value">{data.total_items}</div>
          </div>
          <div className="stat-card stat-card--blue">
            <div className="stat-card__label">Active</div>
            <div className="stat-card__value">{data.active_items}</div>
          </div>
          <div className="stat-card stat-card--orange">
            <div className="stat-card__label">Inactive</div>
            <div className="stat-card__value">{data.inactive_items}</div>
          </div>
          <div className="stat-card stat-card--yellow">
            <div className="stat-card__label">Warranty (180d)</div>
            <div className="stat-card__value">{data.warranty_expiring_180d}</div>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="panel">
            <div className="panel__header">
              <h2 className="panel__title">Vendor Distribution</h2>
            </div>
            <div className="chart-container">
              {vendorChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={vendorChartData}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={85}
                      paddingAngle={2} dataKey="value"
                      stroke="var(--bg-surface)" strokeWidth={2}
                    >
                      {vendorChartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '0.75rem' }} iconSize={10} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state"><div className="empty-state__text">No data</div></div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel__header">
              <h2 className="panel__title">Quick Stats</h2>
            </div>
            <div className="panel__body">
              {data.vendor_distribution?.map((v, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--border-muted)',
                }}>
                  <span>{v.vendor_name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="progress-bar" style={{ width: 80 }}>
                      <div className="progress-bar__fill" style={{ width: `${v.percentage}%` }} />
                    </div>
                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {v.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Active Inventory</h2>
            <span className="panel__badge">{data.items?.length} items</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Hostname</th>
                <th>Vendor / Model</th>
                <th>IP</th>
                <th>Status</th>
                <th>Warranty</th>
              </tr>
            </thead>
            <tbody>
              {data.items?.map((item, i) => (
                <tr key={i}>
                  <td className="mono">{item.serial_number}</td>
                  <td>{item.hostname || '—'}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {item.vendor_name} {item.model_name}
                  </td>
                  <td className="mono">{item.ip_address || '—'}</td>
                  <td>
                    <span className={`badge badge--${item.status}`}>{item.status}</span>
                  </td>
                  <td className="mono" style={{ fontSize: '0.78rem' }}>
                    {item.warranty_expiry || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
