import { useState, useEffect } from 'react';
import api from '../../api/client';

export default function ForecastDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [configs, setConfigs] = useState([]);
  const [editConfig, setEditConfig] = useState(null);

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    fetchData();
  }, []);

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
    try {
      await api.post('/forecast/sync', {});
      showToast('Sync initiated', 'success');
    } catch (err) {
      showToast('Failed to start sync', 'error');
    }
  };

  const handleRecalculate = async () => {
    try {
      await api.post('/forecast/recalculate', {});
      showToast('Recalculation finished', 'success');
      fetchData();
    } catch (err) {
      showToast('Failed to recalculate', 'error');
    }
  };

  const fetchConfigs = async () => {
    try {
      const res = await api.get('/forecast/config');
      setConfigs(res.results || []);
    } catch (err) {
      showToast('Failed to fetch configs', 'error');
    }
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    try {
      await api.post('/forecast/config', editConfig);
      showToast('Config saved successfully', 'success');
      setEditConfig(null);
      fetchConfigs();
    } catch (err) {
      showToast('Failed to save config', 'error');
    }
  };

  const deleteConfig = async (id) => {
    if (!window.confirm('Delete this source? All associated metrics and predictions will be deleted.')) return;
    try {
      await api.delete(`/forecast/config/${id}`);
      showToast('Config deleted', 'success');
      fetchConfigs();
    } catch (err) {
      showToast('Failed to delete config', 'error');
    }
  };

  const openSettings = () => {
    setShowSettings(true);
    fetchConfigs();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        {toast && (
          <div className={`toast toast--${toast.type}`} style={{ position: 'absolute', top: 20, right: 20, padding: '10px 20px', borderRadius: '4px', background: toast.type === 'success' ? '#28a745' : '#dc3545', color: '#fff' }}>
            {toast.message}
          </div>
        )}
        <h1 className="page-title">Capacity & Performance Forecast</h1>
        <div className="page-actions">
          <button className="btn btn--secondary" onClick={openSettings}>⚙️ Settings</button>
          <button className="btn btn--secondary" onClick={handleSync}>Sync Metrics</button>
          <button className="btn btn--primary" onClick={handleRecalculate}>Recalculate</button>
        </div>
      </div>

      {showSettings && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ width: '800px', maxWidth: '90%' }}>
            <div className="modal-header">
              <h2 className="modal-title">Forecast Sources</h2>
              <button className="modal-close" onClick={() => { setShowSettings(false); setEditConfig(null); }}>✕</button>
            </div>
            <div className="modal-body">
              {!editConfig ? (
                <>
                  <div className="d-flex justify-content-between mb-4">
                    <h3>Configured Sources</h3>
                    <button className="btn btn--primary" onClick={() => setEditConfig({ source_type: 'vrops', is_active: true })}>+ Add Source</button>
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>URL</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configs.map(c => (
                        <tr key={c.id}>
                          <td>{c.name}</td>
                          <td style={{ textTransform: 'capitalize' }}>{c.source_type}</td>
                          <td>{c.url}</td>
                          <td>
                            <span className={`status-badge status-badge--${c.is_active ? 'active' : 'inactive'}`}>
                              {c.is_active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td>
                            <button className="btn btn--secondary btn--small mr-2" onClick={() => setEditConfig(c)}>Edit</button>
                            <button className="btn btn--danger btn--small" onClick={() => deleteConfig(c.id)}>Delete</button>
                          </td>
                        </tr>
                      ))}
                      {configs.length === 0 && <tr><td colSpan="5" className="text-center">No sources configured.</td></tr>}
                    </tbody>
                  </table>
                </>
              ) : (
                <form onSubmit={saveConfig} className="form">
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" type="text" value={editConfig.name || ''} onChange={e => setEditConfig({...editConfig, name: e.target.value})} required placeholder="e.g. Primary vCenter" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select className="form-select" value={editConfig.source_type} onChange={e => setEditConfig({...editConfig, source_type: e.target.value})} required>
                      <option value="vrops">vROps (Aria Operations)</option>
                      <option value="xormon">Xormon</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">URL</label>
                    <input className="form-input" type="url" value={editConfig.url || ''} onChange={e => setEditConfig({...editConfig, url: e.target.value})} required placeholder="https://..." />
                  </div>
                  <div className="form-group">
                    <label className="form-label">API Key / Token</label>
                    <input className="form-input" type="password" value={editConfig.api_key || ''} onChange={e => setEditConfig({...editConfig, api_key: e.target.value})} placeholder={editConfig.id ? '******** (Leave blank to keep unchanged)' : 'Enter token'} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      <input type="checkbox" checked={editConfig.is_active} onChange={e => setEditConfig({...editConfig, is_active: e.target.checked})} />
                      {' '}Active
                    </label>
                  </div>
                  <div className="d-flex justify-content-end" style={{ gap: '10px' }}>
                    <button type="button" className="btn btn--secondary" onClick={() => setEditConfig(null)}>Cancel</button>
                    <button type="submit" className="btn btn--primary">Save</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="card__title">Critical Risks Summary</h2>
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Object</th>
                <th>Type</th>
                <th>Metric</th>
                <th>Current</th>
                <th>30d</th>
                <th>90d</th>
                <th>180d</th>
                <th>Warning</th>
                <th>Critical</th>
                <th>Risk Level</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="10" className="text-center py-4">Loading forecasts...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan="10" className="text-center py-4">No forecast data available. Try Syncing and Recalculating.</td></tr>
              ) : (
                data.map((item) => (
                  <tr key={item.id}>
                    <td>{item.object_name}</td>
                    <td style={{ textTransform: 'capitalize' }}>{item.object_type}</td>
                    <td>{item.metric_name}</td>
                    <td>{item.current_value?.toFixed(2)}</td>
                    <td>{item.pred_30d?.toFixed(2) || '-'}</td>
                    <td>{item.pred_90d?.toFixed(2) || '-'}</td>
                    <td>{item.pred_180d?.toFixed(2) || '-'}</td>
                    <td>{item.days_to_warning !== null ? `${item.days_to_warning}d` : '-'}</td>
                    <td>{item.days_to_critical !== null ? `${item.days_to_critical}d` : '-'}</td>
                    <td>
                      <span className={`status-badge status-badge--${item.risk_level === 'green' ? 'active' : item.risk_level === 'yellow' ? 'warning' : 'danger'}`}>
                        {item.risk_level.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
