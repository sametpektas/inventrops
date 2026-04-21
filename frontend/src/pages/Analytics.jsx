import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';

const COLORS = ['#00D4AA', '#FF6B35', '#58A6FF', '#F0C000', '#F85149', '#8B949E', '#A371F7', '#3FB950'];

function WarrantyTab({ warrantyData, activeTab, setActiveTab }) {
  const periods = ['180 days', '360 days', '720 days'];
  const navigate = useNavigate();

  return (
    <div>
      <div className="tabs">
        {warrantyData?.map((p, i) => (
          <button
            key={p.period}
            className={`tab ${activeTab === i ? 'tab--active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {p.period}
            {p.count > 0 && (
              <span className={`badge badge--${p.period === 'Expired' ? 'danger' : 'warning'}`} style={{ marginLeft: 6, fontSize: '0.6rem' }}>
                {p.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {warrantyData?.[activeTab]?.items?.length ? (
        <div className="panel">
          <div className="panel__header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
             <button 
                className="btn btn--secondary btn--sm"
                onClick={() => navigate(`/inventory?status=active`)}
             >
               View All in Inventory →
             </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Hostname</th>
                <th>Vendor / Model</th>
                <th>IP Address</th>
                <th>Warranty Expiry</th>
              </tr>
            </thead>
            <tbody>
              {warrantyData[activeTab].items.map((item, i) => (
                <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate(`/inventory/${item.id}`)}>
                  <td>
                    <span className="mono" style={{ color: 'var(--teal)' }}>{item.serial_number}</span>
                  </td>
                  <td>{item.hostname || '—'}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {item.vendor_name} {item.model_name}
                  </td>
                  <td className="mono">{item.ip_address || '—'}</td>
                  <td>
                    <span className="badge badge--warning">{item.warranty_expiry}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon">✓</div>
          <div className="empty-state__text">
            No devices expiring within {periods[activeTab]}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [warrantyTab, setWarrantyTab] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/inventory/analytics')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  const vendorChartData = (data?.vendor_distribution || []).map(v => ({
    id: v.vendor_id,
    name: v.vendor_name,
    value: v.count,
  }));

  const modelChartData = (data?.model_distribution || []).map(m => ({
    id: m.model_id,
    name: m.model_name,
    value: m.count,
  }));

  const deviceChartData = (data?.device_type_distribution || []).map(d => ({
    name: d.device_type,
    value: d.count,
  }));

  const virtualizationChartData = (data?.virtualization_distribution || []).map(v => ({
    name: v.name,
    value: v.count,
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload?.[0]) {
      return (
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          padding: '8px 12px', borderRadius: 'var(--radius)',
        }}>
          <p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{payload[0].name}</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {payload[0].value} devices
          </p>
        </div>
      );
    }
    return null;
  };

  const handleWarrantyClick = (days) => {
    const today = new Date();
    const future = new Date();
    future.setDate(today.getDate() + days);
    
    // We adjust to handle timezones by picking the standard YYYY-MM-DD
    const fDate = future.toISOString().split('T')[0];
    const tDate = today.toISOString().split('T')[0];
    
    navigate(`/inventory?warranty_after=${tDate}&warranty_before=${fDate}`);
  };

  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="stat-card stat-card--red" onClick={() => navigate('/inventory?warranty_before=' + new Date().toISOString().split('T')[0])} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">Expired Warranty</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[0]?.count || 0}</div>
        </div>
        <div className="stat-card stat-card--orange" onClick={() => handleWarrantyClick(180)} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">Expiring (180d)</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[1]?.count || 0}</div>
        </div>
        <div className="stat-card stat-card--yellow" onClick={() => handleWarrantyClick(360)} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">Expiring (360d)</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[2]?.count || 0}</div>
        </div>
        <div className="stat-card stat-card--teal" onClick={() => handleWarrantyClick(720)} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">Expiring (720d)</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[3]?.count || 0}</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="panel" style={{ animationDelay: '100ms' }}>
          <div className="panel__header">
            <h2 className="panel__title">Vendor Distribution</h2>
            <span className="panel__badge">{vendorChartData.length} vendors</span>
          </div>
          <div className="chart-container">
            {vendorChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={vendorChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="var(--bg-surface)"
                    strokeWidth={2}
                    onClick={(entry) => navigate(`/inventory?vendor=${entry.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    {vendorChartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    onClick={(e) => {
                       const v = vendorChartData.find(v => v.name === e.value);
                       if (v) navigate(`/inventory?vendor=${v.id}`);
                    }}
                    iconSize={10}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><div className="empty-state__text">No data</div></div>
            )}
          </div>
        </div>

        <div className="panel" style={{ animationDelay: '160ms' }}>
          <div className="panel__header">
            <h2 className="panel__title">Top 10 Hardware Models</h2>
          </div>
          <div className="chart-container">
            {modelChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={modelChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="var(--bg-surface)"
                    strokeWidth={2}
                    onClick={(entry) => navigate(`/inventory?model=${entry.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    {modelChartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[(i + 4) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    onClick={(e) => {
                       const m = modelChartData.find(m => m.name === e.value);
                       if (m) navigate(`/inventory?model=${m.id}`);
                    }}
                    iconSize={10}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><div className="empty-state__text">No data</div></div>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="panel" style={{ animationDelay: '200ms' }}>
          <div className="panel__header">
            <h2 className="panel__title">Device Type Distribution</h2>
          </div>
          <div className="chart-container">
            {deviceChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={deviceChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="var(--bg-surface)"
                    strokeWidth={2}
                    onClick={(entry) => navigate(`/inventory?device_type=${encodeURIComponent(entry.name)}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    {deviceChartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    onClick={(e) => navigate(`/inventory?device_type=${encodeURIComponent(e.value)}`)}
                    iconSize={10}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><div className="empty-state__text">No data</div></div>
            )}
          </div>
        </div>

        <div className="panel" style={{ animationDelay: '220ms' }}>
          <div className="panel__header">
            <h2 className="panel__title">Virtualization vs Bare Metal (Servers)</h2>
          </div>
          <div className="chart-container">
            {virtualizationChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={virtualizationChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="var(--bg-surface)"
                    strokeWidth={2}
                    onClick={(entry) => {
                      if (entry.name === 'Virtualization') navigate('/inventory?device_type=server&is_virtual=true');
                      else navigate('/inventory?device_type=server&is_virtual=false');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {virtualizationChartData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#3FB950' : '#8B949E'} /> 
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '0.75rem', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    onClick={(e) => {
                       if (e.value === 'Virtualization') navigate('/inventory?device_type=server&is_virtual=true');
                       else navigate('/inventory?device_type=server&is_virtual=false');
                    }}
                    iconSize={10}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><div className="empty-state__text">No data</div></div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          Warranty Expiry Report
        </h2>
        <span className="badge badge--danger">
          {data?.warranty_expiry?.reduce((sum, w) => sum + w.count, 0) || 0} total
        </span>
      </div>

      <WarrantyTab
        warrantyData={data?.warranty_expiry}
        activeTab={warrantyTab}
        setActiveTab={setWarrantyTab}
      />
    </div>
  );
}
