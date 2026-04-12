import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    username: '', email: '', password: '', first_name: '', last_name: '',
    role: 'viewer', team: '',
  });
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [u, t] = await Promise.all([
        api.get('/auth/users/'),
        api.get('/auth/teams/'),
      ]);
      setUsers(u?.results || []);
      setTeams(t?.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    try {
      const payload = { ...formData };
      if (!payload.team) delete payload.team;
      await api.post('/auth/users/', payload);
      setShowModal(false);
      setFormData({ username: '', email: '', password: '', first_name: '', last_name: '', role: 'viewer', team: '' });
      fetchData();
      showToastMsg('User created successfully', 'success');
    } catch (err) {
      const errors = err?.data;
      if (errors) {
        setFormError(Object.entries(errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n'));
      }
    }
  }

  async function handleToggleActive(user) {
    try {
      await api.patch(`/auth/users/${user.id}/`, { is_active: !user.is_active });
      fetchData();
    } catch {
      showToastMsg('Failed to update user', 'error');
    }
  }

  function showToastMsg(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {users.length} users total
          </span>
        </div>
        <button className="btn btn--primary" onClick={() => setShowModal(true)}>
          + New User
        </button>
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Team</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="mono" style={{ fontWeight: 600 }}>{u.username}</td>
                <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{u.email}</td>
                <td>{u.first_name} {u.last_name}</td>
                <td>
                  <span className={`badge ${u.role === 'admin' ? 'badge--warning' : u.role === 'manager' ? 'badge--info' : 'badge--active'}`}>
                    {u.role}
                  </span>
                </td>
                <td>{u.team_name || '—'}</td>
                <td>
                  <span className={`badge badge--${u.is_active ? 'active' : 'inactive'}`}>
                    {u.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>
                  <button
                    className="btn btn--sm btn--secondary"
                    onClick={() => handleToggleActive(u)}
                  >
                    {u.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h3 className="modal__title">Create New User</h3>
              <button className="modal__close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal__body">
                {formError && <div className="login-error" style={{ marginBottom: 16 }}>{formError}</div>}
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Username *</label>
                    <input className="form-input" value={formData.username} onChange={e => setFormData(f => ({ ...f, username: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email *</label>
                    <input className="form-input" type="email" value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))} required />
                  </div>
                </div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">First Name</label>
                    <input className="form-input" value={formData.first_name} onChange={e => setFormData(f => ({ ...f, first_name: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name</label>
                    <input className="form-input" value={formData.last_name} onChange={e => setFormData(f => ({ ...f, last_name: e.target.value }))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Password *</label>
                  <input className="form-input" type="password" value={formData.password} onChange={e => setFormData(f => ({ ...f, password: e.target.value }))} required minLength={8} />
                </div>
                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <select className="form-input form-select" value={formData.role} onChange={e => setFormData(f => ({ ...f, role: e.target.value }))}>
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="operator">Operator</option>
                      <option value="viewer">Viewer (Read-Only)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Team</label>
                    <select className="form-input form-select" value={formData.team} onChange={e => setFormData(f => ({ ...f, team: e.target.value }))}>
                      <option value="">No team</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn--primary">Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast--${toast.type}`}>{toast.type === 'success' ? '✓' : '✕'} {toast.message}</div>}
    </div>
  );
}
