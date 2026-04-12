import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [recentItems, setRecentItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [analytics, items] = await Promise.all([
          api.get('/inventory/analytics'),
          api.get('/inventory/items?ordering=-created_at&page_size=10'),
        ]);
        setData(analytics);
        setRecentItems(items?.results || []);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

  const warrantyCount = data?.warranty_expiry?.find(w => w.days === 180)?.count || 0;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card stat-card--teal">
          <div className="stat-card__label">Total Devices</div>
          <div className="stat-card__value">{data?.total_items || 0}</div>
          <div className="stat-card__detail">
            {data?.status_distribution?.find(s => s.status === 'active')?.count || 0} active
          </div>
        </div>

        <div className="stat-card stat-card--blue">
          <div className="stat-card__label">Vendors</div>
          <div className="stat-card__value">{data?.vendor_distribution?.length || 0}</div>
          <div className="stat-card__detail">hardware vendors</div>
        </div>

        <div className="stat-card stat-card--orange">
          <div className="stat-card__label">Device Types</div>
          <div className="stat-card__value">{data?.device_type_distribution?.length || 0}</div>
          <div className="stat-card__detail">
            {data?.device_type_distribution?.map(d => d.device_type).join(', ') || '—'}
          </div>
        </div>

        <div className="stat-card stat-card--yellow">
          <div className="stat-card__label">Warranty Alerts</div>
          <div className="stat-card__value">{warrantyCount}</div>
          <div className="stat-card__detail">expiring within 180 days</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="panel" style={{ animationDelay: '200ms' }}>
          <div className="panel__header">
            <h2 className="panel__title">Vendor Distribution</h2>
          </div>
          <div className="panel__body">
            {data?.vendor_distribution?.length ? (
              data.vendor_distribution.map((v, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: '1px solid var(--border-muted)',
                }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{v.vendor_name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="progress-bar" style={{ width: 100 }}>
                      <div
                        className="progress-bar__fill"
                        style={{ width: `${v.percentage}%` }}
                      />
                    </div>
                    <span className="mono" style={{
                      fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 40, textAlign: 'right',
                    }}>
                      {v.count}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <div className="empty-state__text">No vendor data</div>
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ animationDelay: '260ms' }}>
          <div className="panel__header">
            <h2 className="panel__title">Warranty Expiry (180 days)</h2>
            <Link to="/analytics" className="btn btn--sm btn--secondary">View All</Link>
          </div>
          <div className="panel__body">
            {data?.warranty_expiry?.[0]?.items?.length ? (
              data.warranty_expiry[0].items.slice(0, 5).map((item, i) => (
                <Link
                  key={i}
                  to={`/inventory/${item.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 0', borderBottom: '1px solid var(--border-muted)',
                    textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <div>
                    <span className="mono" style={{ fontSize: '0.82rem', display: 'block' }}>
                      {item.serial_number}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {item.hostname || '—'}
                    </span>
                  </div>
                  <span className="badge badge--warning">
                    {item.warranty_expiry}
                  </span>
                </Link>
              ))
            ) : (
              <div className="empty-state">
                <div className="empty-state__text">No warranty alerts</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ animationDelay: '320ms' }}>
        <div className="panel__header">
          <h2 className="panel__title">Recent Devices</h2>
          <Link to="/inventory" className="btn btn--sm btn--secondary">View All</Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Serial / Hostname</th>
              <th>Model</th>
              <th>IP Address</th>
              <th>Status</th>
              <th>Warranty</th>
            </tr>
          </thead>
          <tbody>
            {recentItems.length ? recentItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link to={`/inventory/${item.id}`} style={{ color: 'var(--teal)' }}>
                    <span className="mono">{item.serial_number}</span>
                  </Link>
                  <span className="sub">{item.hostname || '—'}</span>
                </td>
                <td>{item.hardware_model_name}</td>
                <td className="mono">{item.ip_address || '—'}</td>
                <td>
                  <span className={`badge badge--${item.status}`}>
                    {item.status}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: '0.78rem' }}>
                  {item.warranty_expiry || '—'}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No devices found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
