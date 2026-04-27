import { useState, useEffect } from 'react';
import api from '../../api/client';

export default function ForecastDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

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
          <button className="btn btn--secondary" onClick={handleSync}>Sync Metrics</button>
          <button className="btn btn--primary" onClick={handleRecalculate}>Recalculate</button>
        </div>
      </div>

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
