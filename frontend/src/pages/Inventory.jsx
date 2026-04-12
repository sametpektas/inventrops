import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import RackVisualizer from '../components/RackVisualizer';

export default function Inventory() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    serial_number: '', hostname: '', ip_address: '',
    hardware_model: '', rack: '', rack_unit_start: '', rack_unit_size: '',
    warranty_expiry: '', purchase_date: '', notes: '', status: 'active',
  });
  const [formError, setFormError] = useState('');
  const [models, setModels] = useState([]);
  const [racks, setRacks] = useState([]);
  const [datacenters, setDatacenters] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedDc, setSelectedDc] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');

  const search = searchParams.get('search') || '';
  const deviceType = searchParams.get('device_type') || '';
  const warrantyBefore = searchParams.get('warranty_before') || '';
  const warrantyAfter = searchParams.get('warranty_after') || '';
  const page = parseInt(searchParams.get('page') || '1');

  const canEdit = user && ['admin', 'manager', 'operator'].includes(user.role);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/inventory/items?page=${page}&ordering=-created_at&status=active`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (deviceType) url += `&device_type=${encodeURIComponent(deviceType)}`;
      if (warrantyBefore) url += `&warranty_before=${encodeURIComponent(warrantyBefore)}`;
      if (warrantyAfter) url += `&warranty_after=${encodeURIComponent(warrantyAfter)}`;
      const data = await api.get(url);
      setItems(data?.results || []);
      setTotalCount(data?.count || 0);
    } catch (err) {
      console.error('Fetch items error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, deviceType, warrantyBefore, warrantyAfter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (showModal && models.length === 0) {
      Promise.all([
        api.get('/inventory/models'),
        api.get('/infrastructure/datacenters'),
      ]).then(([m, d]) => {
        setModels(m?.results || []);
        setDatacenters(d?.results || []);
      });
    }
  }, [showModal, models.length]);

  useEffect(() => {
    if (selectedDc) {
      api.get(`/infrastructure/rooms/?datacenter=${selectedDc}`).then(r => setRooms(r?.results || []));
    } else {
      setRooms([]);
      setSelectedRoom('');
    }
  }, [selectedDc]);

  useEffect(() => {
    if (selectedRoom) {
      api.get(`/infrastructure/racks/?room=${selectedRoom}`).then(r => setRacks(r?.results || []));
    } else {
      setRacks([]);
      setFormData(f => ({ ...f, rack: '' }));
    }
  }, [selectedRoom]);

  const handleSearch = (value) => {
    setSearchParams(prev => {
      if (value) prev.set('search', value);
      else prev.delete('search');
      prev.set('page', '1');
      return prev;
    });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    try {
      const payload = { ...formData };
      if (!payload.rack) delete payload.rack;
      if (!payload.rack_unit_start) delete payload.rack_unit_start;
      if (!payload.rack_unit_size) delete payload.rack_unit_size;
      if (!payload.purchase_date) delete payload.purchase_date;
      if (!payload.warranty_expiry) delete payload.warranty_expiry;

      await api.post('/inventory/items', payload);
      setShowModal(false);
      setFormData({
        serial_number: '', hostname: '', ip_address: '',
        hardware_model: '', rack: '', rack_unit_start: '', rack_unit_size: '',
        warranty_expiry: '', purchase_date: '', notes: '', status: 'active',
      });
      setSelectedDc('');
      setSelectedRoom('');
      fetchItems();
    } catch (err) {
      const errors = err?.data;
      if (errors) {
        const msg = Object.entries(errors)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\n');
        setFormError(msg);
      } else {
        setFormError('Failed to create item.');
      }
    }
  };

  const totalPages = Math.ceil(totalCount / 25);

  return (
    <div>
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by serial, hostname, IP, asset tag..."
          defaultValue={search}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch(e.target.value)}
          onChange={(e) => {
            if (!e.target.value) handleSearch('');
          }}
        />
        {canEdit && (
          <button className="btn btn--primary" onClick={() => setShowModal(true)}>
            + Add Device
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (
        <>
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Serial Number</th>
                  <th>Hostname</th>
                  <th>Model</th>
                  <th>IP Address</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Warranty</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/inventory/${item.id}`} style={{ color: 'var(--teal)' }}>
                        <span className="mono">{item.serial_number}</span>
                      </Link>
                    </td>
                    <td>{item.hostname || '—'}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {item.hardware_model_name}
                    </td>
                    <td className="mono">{item.ip_address || '—'}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {item.status === 'inactive' && item.storage_location
                        ? `📦 ${item.storage_location}`
                        : item.location_display || '—'}
                    </td>
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
                    <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                      No devices found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination__btn"
                disabled={page <= 1}
                onClick={() => setSearchParams(prev => { prev.set('page', String(page - 1)); return prev; })}
              >
                ← Prev
              </button>
              <span className="pagination__info">
                Page {page} of {totalPages} ({totalCount} items)
              </span>
              <button
                className="pagination__btn"
                disabled={page >= totalPages}
                onClick={() => setSearchParams(prev => { prev.set('page', String(page + 1)); return prev; })}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3 className="modal__title">Add New Device</h3>
              <button className="modal__close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal__body">
                {formError && <div className="login-error" style={{ marginBottom: 16 }}>{formError}</div>}

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Serial Number *</label>
                    <input
                      className="form-input"
                      value={formData.serial_number}
                      onChange={(e) => setFormData(f => ({ ...f, serial_number: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hostname</label>
                    <input
                      className="form-input"
                      value={formData.hostname}
                      onChange={(e) => setFormData(f => ({ ...f, hostname: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">IP Address</label>
                    <input
                      className="form-input"
                      value={formData.ip_address}
                      onChange={(e) => setFormData(f => ({ ...f, ip_address: e.target.value }))}
                      placeholder="192.168.1.1"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hardware Model *</label>
                    <select
                      className="form-input form-select"
                      value={formData.hardware_model}
                      onChange={(e) => setFormData(f => ({ ...f, hardware_model: e.target.value }))}
                      required
                    >
                      <option value="">Select model...</option>
                      {models.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.vendor_name} {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Datacenter / Room</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select className="form-input form-select" value={selectedDc} onChange={(e) => setSelectedDc(e.target.value)}>
                        <option value="">Any DC</option>
                        {datacenters.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <select className="form-input form-select" value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)} disabled={!selectedDc}>
                        <option value="">Any Room</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rack</label>
                    <select
                      className="form-input form-select"
                      value={formData.rack}
                      onChange={(e) => setFormData(f => ({ ...f, rack: e.target.value }))}
                      disabled={!selectedRoom}
                    >
                      <option value="">No rack</option>
                      {racks.map(r => <option key={r.id} value={r.id}>{r.name || `Rack ${r.id}`}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Position & Height (U)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      placeholder="Start U"
                      value={formData.rack_unit_start}
                      onChange={(e) => setFormData(f => ({ ...f, rack_unit_start: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      placeholder={`Size (Auto)`}
                      value={formData.rack_unit_size}
                      onChange={(e) => setFormData(f => ({ ...f, rack_unit_size: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                  </div>
                  {formData.rack && (
                     <RackVisualizer
                       rackId={formData.rack}
                       currentItemId={null}
                       currentUStart={formData.rack_unit_start}
                       currentUSize={formData.rack_unit_size || models.find(m => String(m.id) === String(formData.hardware_model))?.rack_unit_size || 1}
                       onSelectU={u => setFormData(f => ({ ...f, rack_unit_start: String(u) }))}
                     />
                  )}
                </div>

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Purchase Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={formData.purchase_date}
                      onChange={(e) => setFormData(f => ({ ...f, purchase_date: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Warranty Expiry</label>
                    <input
                      className="form-input"
                      type="date"
                      value={formData.warranty_expiry}
                      onChange={(e) => setFormData(f => ({ ...f, warranty_expiry: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-input"
                    rows="3"
                    value={formData.notes}
                    onChange={(e) => setFormData(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary">
                  Create Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
