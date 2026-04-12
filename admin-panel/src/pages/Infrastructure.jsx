import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Infrastructure() {
  const [datacenters, setDatacenters] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [racks, setRacks] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Modals state
  const [showDcModal, setShowDcModal] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [showRackModal, setShowRackModal] = useState(false);

  // Forms state
  const [dcForm, setDcForm] = useState({ name: '', location: '', address: '', team: '' });
  const [roomForm, setRoomForm] = useState({ name: '', datacenter: '' });
  const [rackForm, setRackForm] = useState({ name: '', total_units: 42, room: '' });

  useEffect(() => {
    fetchData();
    api.get('/auth/teams').then(res => setTeams(res?.results || []));
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [dc, r, rk] = await Promise.all([
        api.get('/infrastructure/datacenters'),
        api.get('/infrastructure/rooms'),
        api.get('/infrastructure/racks')
      ]);
      setDatacenters(dc?.results || []);
      setRooms(r?.results || []);
      setRacks(rk?.results || []);
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

  // --- Create Handlers ---
  const handleCreateDc = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...dcForm };
      if (!payload.team) delete payload.team;
      await api.post('/infrastructure/datacenters', payload);
      setShowDcModal(false);
      setDcForm({ name: '', location: '', address: '', team: '' });
      fetchData();
      showToastMsg('Datacenter created');
    } catch (err) {
      const msg = err?.data?.error || 'Error creating Datacenter';
      showToastMsg(msg, 'error');
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    try {
      await api.post('/infrastructure/rooms', roomForm);
      setShowRoomModal(false);
      setRoomForm({ name: '', datacenter: '' });
      fetchData();
      showToastMsg('Room created');
    } catch (err) {
      const msg = err?.data?.error || 'Error creating Room';
      showToastMsg(msg, 'error');
    }
  };

  const handleCreateRack = async (e) => {
    e.preventDefault();
    try {
      await api.post('/infrastructure/racks', rackForm);
      setShowRackModal(false);
      setRackForm({ name: '', total_units: 42, room: '' });
      fetchData();
      showToastMsg('Rack created');
    } catch (err) {
      const msg = err?.data?.error || 'Error creating Rack';
      showToastMsg(msg, 'error');
    }
  };

  // --- Delete Handlers ---
  const handleDelete = async (endpoint, id) => {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    try {
      await api.del(`/infrastructure/${endpoint}/${id}`);
      fetchData();
      showToastMsg('Deleted successfully');
    } catch (err) {
      showToastMsg('Deletion failed or constrained by dependencies', 'error');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="grid-2" style={{ gap: 24, marginBottom: 24 }}>
        {/* Datacenters Panel */}
        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Datacenters</h2>
            <button className="btn btn--sm btn--primary" onClick={() => setShowDcModal(true)}>+ Add DC</button>
          </div>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Location</th><th>Rooms</th><th>Actions</th></tr></thead>
            <tbody>
              {datacenters.map(dc => (
                <tr key={dc.id}>
                  <td style={{ fontWeight: 600 }}>{dc.name}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{dc.location || '—'}</td>
                  <td className="mono">{dc.room_count}</td>
                  <td>
                    <button className="btn btn--sm btn--danger" onClick={() => handleDelete('datacenters', dc.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rooms Panel */}
        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Rooms</h2>
            <button className="btn btn--sm btn--primary" onClick={() => setShowRoomModal(true)}>+ Add Room</button>
          </div>
          <table className="data-table">
            <thead><tr><th>Room Name</th><th>Datacenter</th><th>Racks</th><th>Actions</th></tr></thead>
            <tbody>
              {rooms.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ fontSize: '0.8rem' }}>{r.datacenter_name}</td>
                  <td className="mono">{r.rack_count}</td>
                  <td>
                    <button className="btn btn--sm btn--danger" onClick={() => handleDelete('rooms', r.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Racks Panel */}
      <div className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Racks Overview</h2>
          <button className="btn btn--sm btn--primary" onClick={() => setShowRackModal(true)}>+ Add Rack</button>
        </div>
        <table className="data-table">
          <thead><tr><th>Rack Name</th><th>Room</th><th>Capacity</th><th>Utilization</th><th>Actions</th></tr></thead>
          <tbody>
            {racks.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td style={{ fontSize: '0.8rem' }}>{r.room_name}</td>
                <td className="mono">{r.total_units}U</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="progress-bar" style={{ width: 60 }}>
                      <div className="progress-bar__fill" style={{ width: `${r.utilization_percent || 0}%` }} />
                    </div>
                    <span className="mono" style={{ fontSize: '0.75rem' }}>{r.utilization_percent || 0}%</span>
                  </div>
                </td>
                <td>
                  <button className="btn btn--sm btn--danger" onClick={() => handleDelete('racks', r.id)}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- Modals --- */}
      {showDcModal && (
        <div className="modal-overlay" onClick={() => setShowDcModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header"><h3 className="modal__title">Create Datacenter</h3><button className="modal__close" onClick={() => setShowDcModal(false)}>×</button></div>
            <form onSubmit={handleCreateDc}>
              <div className="modal__body">
                <div className="form-group"><label className="form-label">Name *</label><input className="form-input" required value={dcForm.name} onChange={e => setDcForm({ ...dcForm, name: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={dcForm.location} onChange={e => setDcForm({ ...dcForm, location: e.target.value })} /></div>
                <div className="form-group"><label className="form-label">Address</label><textarea className="form-input" value={dcForm.address} onChange={e => setDcForm({ ...dcForm, address: e.target.value })} /></div>
                <div className="form-group">
                  <label className="form-label">Assigned Team (Optional)</label>
                  <select className="form-input form-select" value={dcForm.team} onChange={e => setDcForm({ ...dcForm, team: e.target.value })}>
                    <option value="">No specific team</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal__footer"><button type="button" className="btn btn--secondary" onClick={() => setShowDcModal(false)}>Cancel</button><button type="submit" className="btn btn--primary">Create</button></div>
            </form>
          </div>
        </div>
      )}

      {showRoomModal && (
        <div className="modal-overlay" onClick={() => setShowRoomModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header"><h3 className="modal__title">Create Room</h3><button className="modal__close" onClick={() => setShowRoomModal(false)}>×</button></div>
            <form onSubmit={handleCreateRoom}>
              <div className="modal__body">
                <div className="form-group">
                  <label className="form-label">Datacenter *</label>
                  <select className="form-input form-select" required value={roomForm.datacenter} onChange={e => setRoomForm({ ...roomForm, datacenter: e.target.value })}>
                    <option value="">Select DC</option>
                    {datacenters.map(dc => <option key={dc.id} value={dc.id}>{dc.name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Room Name / Label *</label><input className="form-input" required value={roomForm.name} onChange={e => setRoomForm({ ...roomForm, name: e.target.value })} /></div>
              </div>
              <div className="modal__footer"><button type="button" className="btn btn--secondary" onClick={() => setShowRoomModal(false)}>Cancel</button><button type="submit" className="btn btn--primary">Create</button></div>
            </form>
          </div>
        </div>
      )}

      {showRackModal && (
        <div className="modal-overlay" onClick={() => setShowRackModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header"><h3 className="modal__title">Create Rack</h3><button className="modal__close" onClick={() => setShowRackModal(false)}>×</button></div>
            <form onSubmit={handleCreateRack}>
              <div className="modal__body">
                <div className="form-group">
                  <label className="form-label">Room *</label>
                  <select className="form-input form-select" required value={rackForm.room} onChange={e => setRackForm({ ...rackForm, room: e.target.value })}>
                    <option value="">Select Room</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.datacenter_name} — {r.name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Rack Identifier *</label><input className="form-input" required value={rackForm.name} onChange={e => setRackForm({ ...rackForm, name: e.target.value })} placeholder="e.g., Row A - Rack 01" /></div>
                <div className="form-group"><label className="form-label">Total U Capacity *</label><input className="form-input" type="number" required min="1" max="100" value={rackForm.total_units} onChange={e => setRackForm({ ...rackForm, total_units: e.target.value })} /></div>
              </div>
              <div className="modal__footer"><button type="button" className="btn btn--secondary" onClick={() => setShowRackModal(false)}>Cancel</button><button type="submit" className="btn btn--primary">Create</button></div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast--${toast.type}`}>{toast.type === 'success' ? '✓' : '✕'} {toast.message}</div>}
    </div>
  );
}
