import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [recentItems, setRecentItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

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

  const handleWarrantyClick = (periodIndex) => {
    setActiveTab(periodIndex);
    // Scroll to the list
    document.getElementById('warranty-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 24 }}>
        <div className="stat-card stat-card--red" onClick={() => handleWarrantyClick(0)} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">EXPIRED WARRANTY</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[0]?.count || 0}</div>
          <div className="stat-card__detail">Action required immediately</div>
        </div>

        <div className="stat-card stat-card--orange" onClick={() => handleWarrantyClick(1)} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">NEXT 6 MONTHS</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[1]?.count || 0}</div>
          <div className="stat-card__detail">Budgeting required</div>
        </div>

        <div className="stat-card stat-card--yellow" onClick={() => handleWarrantyClick(2)} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">NEXT 1 YEAR</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[2]?.count || 0}</div>
          <div className="stat-card__detail">Planning phase</div>
        </div>

        <div className="stat-card stat-card--teal" onClick={() => handleWarrantyClick(3)} style={{ cursor: 'pointer' }}>
          <div className="stat-card__label">NEXT 2 YEARS</div>
          <div className="stat-card__value">{data?.warranty_expiry?.[3]?.count || 0}</div>
          <div className="stat-card__detail">Secure for now</div>
        </div>
      </div>

      <div id="warranty-section" className="panel" style={{ marginBottom: 24, animationDelay: '100ms' }}>
        <div className="panel__header">
          <h2 className="panel__title">Warranty Management Center</h2>
          <div className="tabs" style={{ marginBottom: 0, marginTop: 10 }}>
            {data?.warranty_expiry?.map((p, i) => (
              <button
                key={p.period}
                className={`tab ${activeTab === i ? 'tab--active' : ''}`}
                onClick={() => setActiveTab(i)}
              >
                {p.period}
                {p.count > 0 && (
                  <span className={`badge badge--${p.period.includes('Expired') ? 'danger' : 'warning'}`} style={{ marginLeft: 6 }}>
                    {p.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="panel__body" style={{ padding: 0 }}>
          {data?.warranty_expiry?.[activeTab]?.items?.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Serial / Hostname</th>
                  <th>Vendor / Model</th>
                  <th>IP Address</th>
                  <th>Expiry Date</th>
                </tr>
              </thead>
              <tbody>
                {data.warranty_expiry[activeTab].items.map((item, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }} onClick={() => navigate(`/inventory/${item.id}`)}>
                    <td>
                      <span className="mono" style={{ color: 'var(--teal)' }}>{item.serial_number}</span>
                      <span className="sub">{item.hostname || '—'}</span>
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {item.vendor_name} {item.model_name}
                    </td>
                    <td className="mono" style={{ fontSize: '0.8rem' }}>{item.ip_address || '—'}</td>
                    <td>
                      <span className={`badge badge--${activeTab === 0 ? 'danger' : 'warning'}`}>
                        {item.warranty_expiry}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state" style={{ padding: 40 }}>
              <div className="empty-state__icon">✓</div>
              <div className="empty-state__text">No items found in this category</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="panel" style={{ animationDelay: '200ms' }}>
          <div className="panel__header">
            <h2 className="panel__title">Vendor Summary</h2>
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
            <h2 className="panel__title">Quick Stats</h2>
          </div>
          <div className="panel__body">
            <div className="stat-summary-item">
              <label>Active Devices</label>
              <span>{data?.status_distribution?.find(s => s.status === 'active')?.count || 0}</span>
            </div>
            <div className="stat-summary-item">
              <label>Inactive / Spare</label>
              <span>{data?.status_distribution?.find(s => s.status === 'inactive')?.count || 0}</span>
            </div>
            <div className="stat-summary-item">
              <label>Total Value Tracking</label>
              <span>Managed by {data?.vendor_distribution?.length} Vendors</span>
            </div>
            <div style={{ marginTop: 20 }}>
               <Link to="/analytics" className="btn btn--secondary btn--block">Full Analytics Report →</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ animationDelay: '320ms' }}>
        <div className="panel__header">
          <h2 className="panel__title">Recent Inventory Activity</h2>
          <Link to="/inventory" className="btn btn--sm btn--secondary">Full Inventory</Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Serial / Hostname</th>
              <th>Model</th>
              <th>Status</th>
              <th>Created</th>
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
                <td>{item.model_name}</td>
                <td>
                  <span className={`badge badge--${item.status}`}>
                    {item.status}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: '0.78rem' }}>
                  {item.created_at?.split('T')[0]}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  No recent activity
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
