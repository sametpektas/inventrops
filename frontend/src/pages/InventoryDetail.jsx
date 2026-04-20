import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import DOMPurify from 'dompurify';
import RackVisualizer from '../components/RackVisualizer';

export default function InventoryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [storageLocation, setStorageLocation] = useState('');
  
  // Cascading location states
  const [datacenters, setDatacenters] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [racks, setRacks] = useState([]);
  const [selectedDc, setSelectedDc] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');

  const canEdit = user && ['admin', 'manager', 'operator'].includes(user.role);

  useEffect(() => {
    fetchItem();
  }, [id]);

  async function fetchItem() {
    try {
      const data = await api.get(`/inventory/items/${id}`);
      setItem(data);
      setFormData({
        hostname: data.hostname || '',
        ip_address: data.ip_address || '',
        warranty_expiry: data.warranty_expiry || '',
        purchase_date: data.purchase_date || '',
        rack: data.rack_id || '',
        rack_unit_start: data.rack_unit_start || '',
        rack_unit_size: data.rack_unit_size || '',
        storage_location: data.storage_location || '',
        notes: data.notes || '',
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = { ...formData };
      if (!payload.rack) payload.rack = null;
      if (!payload.rack_unit_start) payload.rack_unit_start = null;
      if (!payload.purchase_date) payload.purchase_date = null;
      if (!payload.warranty_expiry) payload.warranty_expiry = null;

      const updated = await api.patch(`/inventory/items/${id}`, payload);
      setItem(updated);
      setEditing(false);
      showToast('Device updated successfully', 'success');
    } catch (err) {
      const errors = err?.data;
      if (errors) {
        const msg = Object.entries(errors)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join(' | ');
        showToast(msg, 'error');
      } else {
        showToast('Failed to update device', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    try {
      await api.patch(`/inventory/items/${id}/set-status`, {
        status: 'inactive',
        storage_location: storageLocation,
      });
      setShowDeactivate(false);
      fetchItem();
      showToast('Device deactivated', 'success');
    } catch {
      showToast('Failed to deactivate', 'error');
    }
  }

  async function handleActivate() {
    try {
      await api.patch(`/inventory/items/${id}/set-status`, { status: 'active' });
      fetchItem();
      showToast('Device activated', 'success');
    } catch {
      showToast('Failed to activate', 'error');
    }
  }

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    if (editing && datacenters.length === 0) {
      api.get('/infrastructure/datacenters/').then(data => {
        setDatacenters(data?.results || []);
      });
      // If we already have a rack selected, we should figure out its DC and Room
      if (formData.rack) {
        api.get(`/infrastructure/racks/${formData.rack}/`).then(rackRes => {
          setSelectedRoom(rackRes.room_id);
          setSelectedDc(rackRes.room?.datacenter_id);
        });
      }
    }
  }, [editing]);

  useEffect(() => {
    if (selectedDc) {
      api.get(`/infrastructure/rooms/?datacenter=${selectedDc}`).then(res => setRooms(res?.results || []));
    } else {
      setRooms([]);
    }
  }, [selectedDc]);

  useEffect(() => {
    if (selectedRoom) {
      api.get(`/infrastructure/racks/?room=${selectedRoom}`).then(res => setRacks(res?.results || []));
    } else {
      setRacks([]);
    }
  }, [selectedRoom]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!item) return <div className="empty-state"><div className="empty-state__text">Device not found</div></div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/inventory" className="btn btn--sm btn--secondary">← Back to Inventory</Link>
      </div>

      <div className="detail-header">
        <div>
          <h2 className="detail-title">{item.serial_number}</h2>
          <p className="detail-subtitle">{item.model_name} ({item.category})</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className={`badge badge--${item.status}`} style={{ fontSize: '0.75rem', padding: '5px 12px' }}>
            {item.status}
          </span>
          {canEdit && !editing && (
            <button className="btn btn--sm btn--primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canEdit && item.status === 'active' && (
            <button className="btn btn--sm btn--danger" onClick={() => setShowDeactivate(true)}>
              Deactivate
            </button>
          )}
          {canEdit && item.status === 'inactive' && (
            <button className="btn btn--sm btn--primary" onClick={handleActivate}>
              Activate
            </button>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        <div className="panel">
          <div className="panel__header">
            <h3 className="panel__title">Device Information</h3>
          </div>
          <div className="panel__body">
            {editing ? (
              <div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Hostname</label>
                    <input
                      className="form-input"
                      value={formData.hostname}
                      onChange={e => setFormData(f => ({ ...f, hostname: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">IP Address</label>
                    <input
                      className="form-input"
                      value={formData.ip_address}
                      onChange={e => setFormData(f => ({ ...f, ip_address: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Purchase Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={formData.purchase_date}
                      onChange={e => setFormData(f => ({ ...f, purchase_date: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Warranty Expiry</label>
                    <input
                      className="form-input"
                      type="date"
                      value={formData.warranty_expiry}
                      onChange={e => setFormData(f => ({ ...f, warranty_expiry: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label" style={{ marginBottom: 4 }}>Location Placement</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
                      <select
                        className="form-input form-select"
                        value={selectedDc}
                        onChange={e => {
                          setSelectedDc(e.target.value);
                          setSelectedRoom('');
                          setFormData(f => ({ ...f, rack: '' }));
                        }}
                      >
                        <option value="">-- Datacenter --</option>
                        {datacenters.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>

                      <select
                        className="form-input form-select"
                        value={selectedRoom}
                        onChange={e => {
                          setSelectedRoom(e.target.value);
                          setFormData(f => ({ ...f, rack: '' }));
                        }}
                        disabled={!selectedDc}
                      >
                        <option value="">-- Room --</option>
                        {rooms.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>

                      <select
                        className="form-input form-select"
                        value={formData.rack}
                        onChange={e => setFormData(f => ({ ...f, rack: e.target.value }))}
                        disabled={!selectedRoom}
                      >
                        <option value="">-- Rack --</option>
                        {racks.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rack Unit (U)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      value={formData.rack_unit_start}
                      onChange={e => setFormData(f => ({ ...f, rack_unit_start: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Device Height (U Size)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      value={formData.rack_unit_size || ''}
                      onChange={e => setFormData(f => ({ ...f, rack_unit_size: e.target.value }))}
                    />
                  </div>
                </div>
                
                {formData.rack && (
                  <RackVisualizer 
                    rackId={formData.rack} 
                    currentItemId={item.id} 
                    currentUStart={formData.rack_unit_start} 
                    currentUSize={formData.rack_unit_size || item.rack_unit_size}
                    onSelectU={(u) => setFormData(f => ({ ...f, rack_unit_start: u }))}
                  />
                )}

                {item.status === 'inactive' && (
                  <div className="form-group">
                    <label className="form-label">Storage Location</label>
                    <input
                      className="form-input"
                      value={formData.storage_location}
                      onChange={e => setFormData(f => ({ ...f, storage_location: e.target.value }))}
                      placeholder="e.g., Depot A, Warehouse B"
                    />
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-input"
                    rows="3"
                    value={formData.notes}
                    onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button className="btn btn--secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="detail-grid">
                <div className="detail-field">
                  <div className="detail-field__label">Hostname</div>
                  <div className="detail-field__value detail-field__value--mono">
                    {item.hostname || '—'}
                  </div>
                </div>
                <div className="detail-field">
                  <div className="detail-field__label">IP Address</div>
                  <div className="detail-field__value detail-field__value--mono">
                    {item.ip_address || '—'}
                  </div>
                </div>
                <div className="detail-field">
                  <div className="detail-field__label">Serial Number</div>
                  <div className="detail-field__value detail-field__value--mono">
                    {item.serial_number}
                  </div>
                </div>
                <div className="detail-field">
                  <div className="detail-field__label">Asset Tag</div>
                  <div className="detail-field__value">{item.asset_tag || '—'}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-field__label">Purchase Date</div>
                  <div className="detail-field__value">{item.purchase_date || '—'}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-field__label">Warranty Expiry</div>
                  <div className="detail-field__value">{item.warranty_expiry || '—'}</div>
                </div>
                <div className="detail-field">
                  <div className="detail-field__label">Firmware Version</div>
                  <div className="detail-field__value detail-field__value--mono">{item.firmware_version || '—'}</div>
                </div>
                {item.firmware_updated_at && (
                  <div className="detail-field">
                    <div className="detail-field__label">Firmware Updated At</div>
                    <div className="detail-field__value" style={{ fontSize: '0.85rem', color: 'var(--teal)' }}>
                      {item.firmware_updated_at}
                    </div>
                  </div>
                )}
                {item.cpu_model && (
                  <div className="detail-field">
                    <div className="detail-field__label">CPU Model</div>
                    <div className="detail-field__value detail-field__value--mono">{item.cpu_model}</div>
                  </div>
                )}
                {item.ram_gb != null && (
                  <div className="detail-field">
                    <div className="detail-field__label">RAM</div>
                    <div className="detail-field__value">{item.ram_gb} GB</div>
                  </div>
                )}
                <div className="detail-field">
                  <div className="detail-field__label">Location</div>
                  <div className="detail-field__value">
                    {item.status === 'inactive' && item.storage_location
                      ? `📦 ${item.storage_location}`
                      : item.location_display || '—'}
                  </div>
                </div>
                <div className="detail-field">
                  <div className="detail-field__label">Team</div>
                  <div className="detail-field__value">{item.team_name || '—'}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <h3 className="panel__title">Metadata</h3>
          </div>
          <div className="panel__body">
            <div className="detail-grid">
              <div className="detail-field">
                <div className="detail-field__label">Model</div>
                <div className="detail-field__value">{item.model_name}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field__label">Discovered Via</div>
                <div className="detail-field__value detail-field__value--mono">
                  {item.discovered_via || 'manual'}
                </div>
              </div>
              <div className="detail-field">
                <div className="detail-field__label">Created At</div>
                <div className="detail-field__value">{item.created_at}</div>
              </div>
              <div className="detail-field">
                <div className="detail-field__label">Updated At</div>
                <div className="detail-field__value">{item.updated_at}</div>
              </div>
            </div>
            {item.notes && (
              <div className="detail-field" style={{ marginTop: 8 }}>
                <div className="detail-field__label">Notes</div>
                <div 
                  className="detail-field__value" 
                  style={{ whiteSpace: 'pre-wrap' }}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(item.notes) }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {!editing && item.status === 'active' && item.rack && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel__header">
            <h3 className="panel__title">Cabinet Layout</h3>
          </div>
          <div className="panel__body">
            <RackVisualizer 
              rackId={item.rack_id} 
              currentItemId={item.id} 
              currentUStart={item.rack_unit_start} 
              currentUSize={item.rack_unit_size}
            />
          </div>
        </div>
      )}

      {showDeactivate && (
        <div className="modal-overlay" onClick={() => setShowDeactivate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header">
              <h3 className="modal__title">Deactivate Device</h3>
              <button className="modal__close" onClick={() => setShowDeactivate(false)}>×</button>
            </div>
            <div className="modal__body">
              <p style={{ fontSize: '0.88rem', marginBottom: 16, color: 'var(--text-secondary)' }}>
                This will mark <strong>{item.serial_number}</strong> as inactive.
                Where will the device be stored?
              </p>
              <div className="form-group">
                <label className="form-label">Storage Location</label>
                <input
                  className="form-input"
                  value={storageLocation}
                  onChange={e => setStorageLocation(e.target.value)}
                  placeholder="e.g., Depot A, Warehouse, Storage Room B2"
                />
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--secondary" onClick={() => setShowDeactivate(false)}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDeactivate}>Deactivate</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast--${toast.type}`}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}
    </div>
  );
}
