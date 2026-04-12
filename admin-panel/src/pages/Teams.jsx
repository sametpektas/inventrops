import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => { fetchTeams(); }, []);

  async function fetchTeams() {
    try {
      const data = await api.get('/auth/teams');
      setTeams(data?.results || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError('');
    try {
      await api.post('/auth/teams', formData);
      setShowModal(false);
      setFormData({ name: '', description: '' });
      fetchTeams();
      showToastMsg('Team created', 'success');
    } catch (err) {
      setFormError(JSON.stringify(err?.data || 'Failed'));
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this team?')) return;
    try {
      await api.del(`/auth/teams/${id}`);
      fetchTeams();
    } catch { showToastMsg('Failed to delete', 'error'); }
  }

  function showToastMsg(msg, type) {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="toolbar">
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{teams.length} teams</span>
        <button className="btn btn--primary" onClick={() => setShowModal(true)}>+ New Team</button>
      </div>

      <div className="panel">
        <table className="data-table">
          <thead>
            <tr><th>Team Name</th><th>Description</th><th>Members</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {teams.map(t => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                <td style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{t.description || '—'}</td>
                <td className="mono">{t.member_count}</td>
                <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
                <td>
                  <button className="btn btn--sm btn--danger" onClick={() => handleDelete(t.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header">
              <h3 className="modal__title">Create Team</h3>
              <button className="modal__close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal__body">
                {formError && <div className="login-error">{formError}</div>}
                <div className="form-group">
                  <label className="form-label">Team Name *</label>
                  <input className="form-input" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea className="form-input" rows="3" value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn--primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast--${toast.type}`}>{toast.type === 'success' ? '✓' : '✕'} {toast.message}</div>}
    </div>
  );
}
