import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

export default function DeactivatedItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Only fetch inactive items
    api.get('/inventory/items?status=inactive&ordering=-deactivated_at')
      .then(data => setItems(data?.results || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="toolbar">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text)' }}>
          Deactivated Equipment Fleet
        </h2>
        <span className="badge badge--danger" style={{ padding: '4px 10px' }}>
          {items.length} Inactive Devices
        </span>
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Hardware Model</th>
              <th>Deactivated On</th>
              <th>Storage / Depot Address</th>
              <th>Hostname (Last known)</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '30px' }}>No deactivated equipment in inventory.</td></tr>
            )}
            {items.map(item => (
              <tr 
                key={item.id} 
                onClick={() => navigate(`/inventory/${item.id}`)}
                style={{ cursor: 'pointer', opacity: 0.8 }}
              >
                <td className="mono" style={{ color: 'var(--teal)' }}>{item.serial_number}</td>
                <td style={{ fontSize: '0.85rem' }}>{item.hardware_model_name}</td>
                <td>
                  <span className="badge badge--danger" style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                    {item.deactivated_at ? new Date(item.deactivated_at).toLocaleDateString() : 'Unknown'}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>{item.storage_location || 'Not Specified'}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.hostname || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
