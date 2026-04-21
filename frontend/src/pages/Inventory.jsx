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
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [formData, setFormData] = useState({
    serial_number: '', hostname: '', ip_address: '',
    hardware_model: '', rack: '', rack_unit_start: '', rack_unit_size: '',
    model: '', // New field name
    warranty_expiry: '', purchase_date: '', notes: '', status: 'active',
  });
  const [formError, setFormError] = useState('');
  const [models, setModels] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [racks, setRacks] = useState([]);
  const [datacenters, setDatacenters] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedDc, setSelectedDc] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');

  const search = searchParams.get('search') || '';
  const deviceType = searchParams.get('device_type') || '';
  const vendorId = searchParams.get('vendor') || '';
  const modelId = searchParams.get('model') || '';
  const warrantyBefore = searchParams.get('warranty_before') || '';
  const warrantyAfter = searchParams.get('warranty_after') || '';
  const osFilter = searchParams.get('operating_system') || '';
  const isVirtual = searchParams.get('is_virtual') || '';
  const ordering = searchParams.get('ordering') || '-created_at';
  const page = parseInt(searchParams.get('page') || '1');

  const canEdit = user && ['admin', 'manager', 'operator'].includes(user.role);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/inventory/items?page=${page}&status=active`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (deviceType) url += `&device_type=${encodeURIComponent(deviceType)}`;
      if (vendorId) url += `&vendor=${vendorId}`;
      if (modelId) url += `&model=${modelId}`;
      if (warrantyBefore) url += `&warranty_before=${encodeURIComponent(warrantyBefore)}`;
      if (warrantyAfter) url += `&warranty_after=${encodeURIComponent(warrantyAfter)}`;
      if (osFilter) url += `&operating_system=${encodeURIComponent(osFilter)}`;
      if (isVirtual) url += `&is_virtual=${encodeURIComponent(isVirtual)}`;
      if (ordering) url += `&ordering=${ordering}`;
      
      const data = await api.get(url);
      setItems(data?.results || []);
      setTotalCount(data?.count || 0);
    } catch (err) {
      console.error('Fetch items error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, deviceType, vendorId, modelId, warrantyBefore, warrantyAfter, osFilter, isVirtual, ordering]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (showModal && models.length === 0) {
      Promise.all([
        api.get('/inventory/models'),
        api.get('/inventory/vendors'),
        api.get('/infrastructure/datacenters'),
      ]).then(([m, v, d]) => {
        setModels(m?.results || []);
        setVendors(v?.results || v || []); // Handle different API response shapes
        setDatacenters(d?.results || []);
      }).catch(err => {
        console.error('Error loading modal data:', err);
      });
    }
  }, [showModal, models.length]);

  useEffect(() => {
    if (selectedDc) {
      api.get(`/infrastructure/rooms/?datacenter=${selectedDc}`)
        .then(r => setRooms(r?.results || []))
        .catch(err => {
          console.error('Error loading rooms:', err);
          setRooms([]);
        });
    } else {
      setRooms([]);
      setSelectedRoom('');
    }
  }, [selectedDc]);

  useEffect(() => {
    if (selectedRoom) {
      api.get(`/infrastructure/racks/?room=${selectedRoom}`)
        .then(r => setRacks(r?.results || []))
        .catch(err => {
          console.error('Error loading racks:', err);
          setRacks([]);
        });
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

  const handleOrder = (field) => {
    setSearchParams(prev => {
      const current = prev.get('ordering');
      if (current === field) prev.set('ordering', `-${field}`);
      else prev.set('ordering', field);
      return prev;
    });
  };

  const handleExport = async (scope) => {
    try {
      let url = `/inventory/export?scope=${scope}`;
      if (scope === 'filtered') {
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (deviceType) url += `&device_type=${encodeURIComponent(deviceType)}`;
        if (vendorId) url += `&vendor=${vendorId}`;
        if (modelId) url += `&model=${modelId}`;
        if (warrantyBefore) url += `&warranty_before=${encodeURIComponent(warrantyBefore)}`;
        if (warrantyAfter) url += `&warranty_after=${encodeURIComponent(warrantyAfter)}`;
        if (osFilter) url += `&operating_system=${encodeURIComponent(osFilter)}`;
      }
      
      const response = await api.getBlob(url);
      const blobURL = window.URL.createObjectURL(response);
      const link = document.createElement('a');
      link.href = blobURL;
      link.setAttribute('download', `inventory_${scope}_${new Date().toISOString().split('T')[0]}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobURL);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImporting(true);
    setImportReport(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.postMultipart('/inventory/import', formData);
      setImportReport(res);
      fetchItems();
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setImporting(false);
    }
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
      handleCloseModal();
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

  const handleCloseModal = () => {
    setShowModal(false);
    setFormData({
      serial_number: '', hostname: '', ip_address: '',
      hardware_model: '', rack: '', rack_unit_start: '', rack_unit_size: '',
      model: '',
      warranty_expiry: '', purchase_date: '', notes: '', status: 'active',
    });
    setSelectedVendor('');
    setSelectedDc('');
    setSelectedRoom('');
    setFormError('');
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--secondary" onClick={() => handleExport('filtered')}>
            Export Filtered
          </button>
          <button className="btn btn--secondary" onClick={() => handleExport('all')}>
            Export All
          </button>
          <button className="btn btn--secondary" onClick={() => setShowImportModal(true)}>
            Import Excel
          </button>
          {canEdit && (
            <button className="btn btn--primary" onClick={() => setShowModal(true)}>
              + Add Device
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : (
        <>
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => handleOrder('serial_number')} style={{ cursor: 'pointer' }}>
                    Serial {ordering.includes('serial_number') ? (ordering.startsWith('-') ? '↓' : '↑') : ''}
                  </th>
                  <th onClick={() => handleOrder('hostname')} style={{ cursor: 'pointer' }}>
                    Hostname {ordering.includes('hostname') ? (ordering.startsWith('-') ? '↓' : '↑') : ''}
                  </th>
                  <th>Model</th>
                  <th>CPU</th>
                  <th>Firmware</th>
                  <th>IP Address</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th onClick={() => handleOrder('warranty_expiry')} style={{ cursor: 'pointer' }}>
                    Warranty {ordering.includes('warranty_expiry') ? (ordering.startsWith('-') ? '↓' : '↑') : ''}
                  </th>
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
                      {item.model_name}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {item.cpu_model || '—'}
                    </td>
                    <td><span style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{item.firmware_version || '—'}</span></td>
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
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h3 className="modal__title">Add New Device</h3>
              <button className="modal__close" onClick={handleCloseModal}>×</button>
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
                    <label className="form-label">Status</label>
                    <select
                      className="form-input form-select"
                      value={formData.status}
                      onChange={(e) => setFormData(f => ({ ...f, status: e.target.value }))}
                    >
                      <option value="active">Active</option>
                      <option value="deactivated">Deactivated</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </div>
                </div>

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Brand / Vendor *</label>
                    <select
                      className="form-input form-select"
                      value={selectedVendor}
                      onChange={(e) => {
                        setSelectedVendor(e.target.value);
                        setFormData(f => ({ ...f, model: '' }));
                      }}
                      required
                    >
                      <option value="">Select brand...</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Model *</label>
                    <select
                      className="form-input form-select"
                      value={formData.model}
                      onChange={(e) => setFormData(f => ({ ...f, model: e.target.value }))}
                      required
                      disabled={!selectedVendor}
                    >
                      <option value="">{selectedVendor ? 'Select model...' : 'Select brand first'}</option>
                      {models
                        .filter(m => String(m.vendor_id) === String(selectedVendor))
                        .map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.category})
                          </option>
                        ))
                      }
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
                <button type="button" className="btn btn--secondary" onClick={handleCloseModal}>
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

      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h3 className="modal__title">Import Inventory (Excel)</h3>
              <button className="modal__close" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <div className="modal__body">
              <p style={{ fontSize: '0.85rem', marginBottom: 15, color: 'var(--text-secondary)' }}>
                Upload an XLSX file. Columns should include: <strong>Serial Number, Asset Tag, Vendor, Model, Hostname, IP Address, Status, Purchase Date, Warranty Expiry</strong>.
              </p>
              
              {!importReport ? (
                <div style={{ padding: '20px', border: '2px dashed var(--border-default)', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                  {importing ? (
                    <div className="spinner" style={{ margin: '0 auto' }} />
                  ) : (
                    <input type="file" accept=".xlsx" onChange={handleImport} />
                  )}
                </div>
              ) : (
                <div className="report-panel">
                   <h4 style={{ color: 'var(--teal)', marginBottom: 8 }}>Import Complete!</h4>
                   <p style={{ fontSize: '0.9rem' }}>{importReport.message}</p>
                   {importReport.errors && importReport.errors.length > 0 && (
                     <div style={{ marginTop: 12, padding: 12, background: 'rgba(248, 81, 73, 0.1)', borderRadius: 4 }}>
                       <p style={{ fontSize: '0.78rem', color: 'var(--red)', fontWeight: 600 }}>Conflicts or Issues:</p>
                       <ul style={{ fontSize: '0.75rem', marginTop: 5, maxHeight: 150, overflowY: 'auto' }}>
                         {importReport.errors.map((err, i) => <li key={i}>{err}</li>)}
                       </ul>
                     </div>
                   )}
                </div>
              )}
            </div>
            <div className="modal__footer">
              <button className="btn btn--secondary" onClick={() => { setShowImportModal(false); setImportReport(null); }}>
                Close
              </button>
              {importReport && (
                <button className="btn btn--primary" onClick={() => { setImportReport(null); }}>
                  Import More
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
