import { useState, useEffect } from 'react';
import api from '../api/client';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/inventory/analytics/'),
      api.get('/auth/users/'),
      api.get('/auth/teams/'),
    ]).then(([analytics, users, teams]) => {
      setStats({
        ...analytics,
        total_users: users?.count || users?.results?.length || 0,
        total_teams: teams?.count || teams?.results?.length || 0,
        users: users?.results || [],
        teams: teams?.results || [],
      });
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card stat-card--teal">
          <div className="stat-card__label">Total Devices</div>
          <div className="stat-card__value">{stats?.total_items || 0}</div>
        </div>
        <div className="stat-card stat-card--blue">
          <div className="stat-card__label">Users</div>
          <div className="stat-card__value">{stats?.total_users || 0}</div>
        </div>
        <div className="stat-card stat-card--orange">
          <div className="stat-card__label">Teams</div>
          <div className="stat-card__value">{stats?.total_teams || 0}</div>
        </div>
        <div className="stat-card stat-card--yellow">
          <div className="stat-card__label">Vendors</div>
          <div className="stat-card__value">{stats?.vendor_distribution?.length || 0}</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Teams Overview</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Team</th><th>Members</th></tr>
            </thead>
            <tbody>
              {stats?.teams?.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td className="mono">{t.member_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Vendor Distribution</h2>
          </div>
          <div className="panel__body">
            {stats?.vendor_distribution?.map((v, i) => (
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
          <h2 className="panel__title">Warranty Alerts</h2>
        </div>
        <div className="panel__body">
          {stats?.warranty_expiry?.map((w, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: '1px solid var(--border-muted)',
            }}>
              <span style={{ fontWeight: 500 }}>{w.period}</span>
              <span className={`badge ${w.count > 0 ? 'badge--danger' : 'badge--active'}`}>
                {w.count} devices
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
