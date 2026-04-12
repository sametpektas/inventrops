import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

export default function AdminInventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/inventory/items/?page=${page}&ordering=-created_at`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const data = await api.get(url);
      setItems(data?.results || []);
      setTotalCount(data?.count || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const totalPages = Math.ceil(totalCount / 25);

  return (
    <div>
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Global search across ALL teams (serial, hostname)..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 400 }}
        />
      </div>

      <div className="panel">
        {loading ? <div className="loading"><div className="spinner" /></div> : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial Number</th>
                <th>Hostname</th>
                <th>Hardware Model</th>
                <th>Team</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td className="mono" style={{ color: 'var(--teal)' }}>{item.serial_number}</td>
                  <td>{item.hostname || '—'}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.hardware_model_name}</td>
                  <td style={{ fontWeight: 600 }}>{item.team_name || '—'}</td>
                  <td><span className={`badge badge--${item.status}`}>{item.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="pagination__btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="pagination__info">Page {page} of {totalPages}</span>
          <button className="pagination__btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
