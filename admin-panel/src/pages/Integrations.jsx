import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Integrations() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState(null); // 'create' or 'edit'
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [teams, setTeams] = useState([]);
  const [syncingIds, setSyncingIds] = useState(new Set());

  // Form State
  const initialForm = {
    id: null, name: '', integration_type: 'dell_openmanage', base_url: '', 
    username: '', password: '', team: '', is_active: true
  };
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    fetchData();
    api.get('/auth/teams').then(r => setTeams(r?.results || []));
    
    // Live update polling
    const interval = setInterval(() => {
      fetchData(false);
    }, 10000); // every 10s
    
    return () => clearInterval(interval);
  }, []);

  async function fetchData(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const data = await api.get('/admin/integrations/configs');
      setIntegrations(data?.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  function showToastMsg(msg, type = 'success') {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const handleOpenCreate = () => {
    setForm(initialForm);
    setModalMode('create');
  };

  const handleOpenEdit = (integ) => {
    setForm({
      id: integ.id,
      name: integ.name,
      integration_type: integ.integration_type,
      base_url: integ.url,
      username: integ.username || '',
      password: integ.password || '', // This will be '********'
      team: integ.team_id || '',
      is_active: integ.is_active
    });
    setModalMode('edit');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = { ...form };
      if (!payload.team) delete payload.team;
      else payload.team_id = payload.team;

      // PHASE 1: TEST CONNECTION (Only on new or if URL/credentials changed)
      showToastMsg('Testing connection...', 'info');
      try {
        await api.post('/admin/integrations/test-connection', {
          ...payload,
          base_url: payload.base_url || payload.url
        });
      } catch (testErr) {
        showToastMsg(testErr?.data?.error || 'Connection test failed', 'error');
        setSubmitting(false);
        return;
      }

      // PHASE 2: SAVE/UPDATE
      if (modalMode === 'edit') {
        await api.patch(`/admin/integrations/configs/${form.id}`, payload);
        showToastMsg('Integration updated successfully');
      } else {
        await api.post('/admin/integrations/configs', payload);
        showToastMsg('Integration configured successfully');
      }
      
      setModalMode(null);
      fetchData(false);
    } catch (err) {
      showToastMsg('Failed to save integration', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTriggerSync = async (id) => {
    setSyncingIds(prev => new Set(prev).add(id));
    try {
      await api.post(`/admin/integrations/configs/${id}/trigger-sync`, {});
      showToastMsg('Sync triggered. Updating status...');
      // Poll immediately after 2 seconds
      setTimeout(() => fetchData(false), 2000);
    } catch (err) {
      showToastMsg(err?.data?.error || 'Failed to trigger sync', 'error');
    } finally {
      setTimeout(() => {
        setSyncingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 5000);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Remove this integration and its logs?')) return;
    try {
      await api.del(`/admin/integrations/configs/${id}`);
      fetchData(false);
      showToastMsg('Integration deleted');
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
        <button className="btn btn--primary" onClick={handleOpenCreate}>
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
              const isSyncing = syncingIds.has(inv.id);
              return (
                <tr key={inv.id} onClick={() => handleOpenEdit(inv)} style={{ cursor: 'pointer' }}>
                  <td>
                    <span className={`badge badge--${inv.is_active ? 'active' : 'inactive'}`}>
                      {inv.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{inv.name}</td>
                  <td><span className="badge badge--info">{inv.integration_type}</span></td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>{inv.url}</td>
                  <td>
                    {lastLog ? (
                      <div style={{ fontSize: '0.8rem' }}>
                        <div style={{ color: lastLog.status === 'success' ? '#10b981' : '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {lastLog.status.toUpperCase()}
                          {isSyncing && <div className="spinner spinner--xs" style={{ width: 10, height: 10 }} />}
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
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {isSyncing ? 'First sync in progress...' : 'Never synced'}
                      </span>
                    )}
                  </td>
                <td>
                  <div style={{ display: 'flex', gap: '8px' }} onClick={e => e.stopPropagation()}>
                    <button 
                       className="btn btn--sm btn--primary"
                       onClick={() => handleTriggerSync(inv.id)}
                       disabled={!inv.is_active || isSyncing}
                    >
                      {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button className="btn btn--sm btn--danger" onClick={(e) => handleDelete(e, inv.id)}>
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

      {modalMode && (
        <div className="modal-overlay" onClick={() => setModalMode(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal__header">
              <h3 className="modal__title">{modalMode === 'edit' ? 'Edit Integration' : 'Configure Integration'}</h3>
              <button className="modal__close" onClick={() => setModalMode(null)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Integration Type *</label>
                  <select className="form-input form-select" value={form.integration_type} onChange={e => setForm({...form, integration_type: e.target.value})}>
                    <option value="dell_openmanage">Dell OpenManage</option>
                    <option value="hpe_oneview">HPE OneView</option>
                    <option value="xormon">Xormon</option>
                    <option value="vrops">vROps (Aria Operations)</option>
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

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input className="form-input" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password / Secret</label>
                    <input 
                      className="form-input" 
                      type="password" 
                      value={form.password} 
                      onChange={e => setForm({...form, password: e.target.value})} 
                      placeholder={modalMode === 'edit' ? 'Leave as ******** to keep current' : 'Secret Token / Password'}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Default Fallback Team</label>
                  <select className="form-input form-select" value={form.team} onChange={e => setForm({...form, team: e.target.value})}>
                    <option value="">No default team</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} />
                  <label htmlFor="is_active" className="form-label" style={{ margin: 0 }}>Active and enabled for auto-sync</label>
                </div>
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setModalMode(null)}>Cancel</button>
                <button type="submit" className="btn btn--primary" disabled={submitting}>
                  {submitting ? 'Saving...' : (modalMode === 'edit' ? 'Save Changes' : 'Configure')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast--${toast.type}`}>{toast.type === 'success' ? '✓' : '✕'} {toast.message}</div>}
    </div>
  );
}
