import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Integrations() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [teams, setTeams] = useState([]);

  // Form State
  const [form, setForm] = useState({
    name: '', integration_type: 'dell_openmanage', base_url: '', 
    username: '', password: '', team: '', is_active: true
  });

  useEffect(() => {
    fetchData();
    api.get('/auth/teams').then(r => setTeams(r?.results || []));
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const data = await api.get('/admin/integrations/configs');
      setIntegrations(data?.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function showToastMsg(msg, type = 'success') {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = { ...form };
      if (!payload.team) delete payload.team;
      
      // Cleanup empty optional fields
      if (!payload.username) delete payload.username;
      if (!payload.password) delete payload.password;

      // PHASE 1: TEST CONNECTION
      showToastMsg('Testing connection...', 'info');
      try {
        await api.post('/admin/integrations/test-connection', payload);
      } catch (testErr) {
        showToastMsg(testErr?.data?.error || 'Connection test failed', 'error');
        setSubmitting(false);
        return;
      }

      // PHASE 2: SAVE IF SUCCESS
      await api.post('/admin/integrations/configs', payload);
      setShowModal(false);
      fetchData();
      showToastMsg('Connection verified and configured successfully');
    } catch (err) {
      showToastMsg('Failed to save integration', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTriggerSync = async (id) => {
    try {
      await api.post(`/admin/integrations/configs/${id}/trigger-sync`, {});
      showToastMsg('Sync triggered. Devices will sync in background.');
    } catch (err) {
      showToastMsg(err?.data?.error || 'Failed to trigger sync', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this integration?')) return;
    try {
      await api.del(`/admin/integrations/configs/${id}`);
      fetchData();
    } catch (err) {
      showToastMsg('Failed to delete integration', 'error');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="toolbar">
        <div style={{ flex: 1, color: 'var(--text-secondary)' }}>
          Manage your third-party inventory gateways.
        </div>
        <button className="btn btn--primary" onClick={() => setShowModal(true)}>
          + Add Integration
        </button>
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Name</th>
              <th>Type</th>
              <th>Target URL</th>
              <th>Last Result</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {integrations.length === 0 && (
              <tr><td colSpan="6" style={{textAlign: 'center', padding: 20}}>No integrations configured</td></tr>
            )}
            {integrations.map(inv => {
              const lastLog = inv.logs && inv.logs[0];
              return (
                <tr key={inv.id}>
                  <td>
                    <span className={`badge badge--${inv.is_active ? 'active' : 'inactive'}`}>
                      {inv.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{inv.name}</td>
                  <td><span className="badge badge--info">{inv.integration_type}</span></td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>{inv.base_url}</td>
                  <td>
                    {lastLog ? (
                      <div style={{ fontSize: '0.8rem' }}>
                        <div style={{ color: lastLog.status === 'success' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                          {lastLog.status.toUpperCase()}
                        </div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          {lastLog.status === 'success' 
                            ? `${lastLog.items_discovered} found, ${lastLog.items_created} new`
                            : lastLog.error_message?.substring(0, 30)}
                        </div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                           {new Date(lastLog.created_at).toLocaleString()}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Never synced</span>
                    )}
                  </td>
                <td>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                       className="btn btn--sm btn--primary"
                       onClick={() => handleTriggerSync(inv.id)}
                       disabled={!inv.is_active}
                    >
                      Sync Now
                    </button>
                    <button className="btn btn--sm btn--danger" onClick={() => handleDelete(inv.id)}>
                      Del
                    </button>
                  </div>
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal__header">
              <h3 className="modal__title">Configure Integration</h3>
              <button className="modal__close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Integration Type *</label>
                  <select className="form-input form-select" value={form.integration_type} onChange={e => setForm({...form, integration_type: e.target.value})}>
                    <option value="dell_openmanage">Dell OpenManage</option>
                    <option value="hpe_oneview">HPE OneView</option>
                    <option value="xormon">Xormon</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label className="form-label">Display Name *</label>
                  <input className="form-input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Istanbul Datacenter Dell OME" />
                </div>

                <div className="form-group">
                  <label className="form-label">API Base URL *</label>
                  <input className="form-input" type="url" required value={form.base_url} onChange={e => setForm({...form, base_url: e.target.value})} placeholder="https://..." />
                </div>

                {/* Credentials Section */}
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Username {form.integration_type !== 'xormon' && '*'}</label>
                    <input className="form-input" required={form.integration_type !== 'xormon'} value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password {form.integration_type !== 'xormon' && '*'}</label>
                    <input className="form-input" type="password" required={form.integration_type !== 'xormon'} value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
                  </div>
                </div>

                
                <div className="form-group">
                  <label className="form-label">Default Fallback Team</label>
                  <select className="form-input form-select" value={form.team} onChange={e => setForm({...form, team: e.target.value})}>
                    <option value="">No default team</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Devices will automatically route to "Storage", "Server", or "Network" teams based on device type if they exist. This team is a fallback.
                  </span>
                </div>
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn--primary" disabled={submitting}>Configure</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast--${toast.type}`}>{toast.type === 'success' ? '✓' : '✕'} {toast.message}</div>}
    </div>
  );
}
