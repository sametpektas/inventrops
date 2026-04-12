import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Shares() {
  const { user } = useAuth();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState('');
  const [toast, setToast] = useState(null);

  const canCreate = user && ['admin', 'manager', 'operator'].includes(user.role);

  useEffect(() => {
    fetchLinks();
  }, []);

  async function fetchLinks() {
    try {
      const data = await api.get('/inventory/share-links');
      setLinks(data?.results || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    try {
      await api.post('/inventory/share-links', { label });
      setShowCreate(false);
      setLabel('');
      fetchLinks();
      showToast('Share link created', 'success');
    } catch (err) {
      showToast('Failed to create link', 'error');
    }
  }

  async function handleToggle(link) {
    try {
      await api.patch(`/inventory/share-links/${link.id}`, {
        is_active: !link.is_active,
      });
      fetchLinks();
    } catch {
      showToast('Failed to update link', 'error');
    }
  }

  async function handleDelete(link) {
    if (!window.confirm(`Are you sure you want to permanently delete this share link?`)) return;
    try {
      await api.del(`/inventory/share-links/${link.id}`);
      fetchLinks();
      showToast('Link deleted successfully', 'success');
    } catch {
      showToast('Failed to delete link', 'error');
    }
  }

  function copyLink(url) {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link copied to clipboard', 'success');
    });
  }

  function showToast(message, type) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Create readonly links to share your team's inventory dashboard with others.
            Recipients don't need an account.
          </p>
        </div>
        {canCreate && (
          <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
            + Create Link
          </button>
        )}
      </div>

      {links.length > 0 ? (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Team</th>
                <th>Created By</th>
                <th>Created</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.map(link => (
                <tr key={link.id}>
                  <td style={{ fontWeight: 500 }}>{link.label || 'Unnamed'}</td>
                  <td>{link.team_name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{link.created_by_name}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {new Date(link.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <span className={`badge badge--${link.is_active ? 'active' : 'inactive'}`}>
                      {link.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn--sm btn--secondary"
                        onClick={() => copyLink(link.share_url)}
                      >
                        Copy
                      </button>
                      <button
                        className="btn btn--sm btn--secondary"
                        onClick={() => handleToggle(link)}
                      >
                        {link.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={() => handleDelete(link)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-state__icon">⤤</div>
            <div className="empty-state__text">No shared links yet</div>
            {canCreate && (
              <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
                Create Your First Link
              </button>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header">
              <h3 className="modal__title">Create Shared Link</h3>
              <button className="modal__close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="modal__body">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
                This will create a readonly link showing your team's ({user?.team_name}) inventory.
              </p>
              <div className="form-group">
                <label className="form-label">Label (optional)</label>
                <input
                  className="form-input"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="e.g., Q1 Report, Management Review"
                />
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleCreate}>Create</button>
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
