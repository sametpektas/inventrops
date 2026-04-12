import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function PasswordChangeModal() {
  const { user, logout } = useAuth();
  const [passwords, setPasswords] = useState({
    old_password: '',
    new_password: '',
    confirm_password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user?.require_password_change) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (passwords.new_password !== passwords.confirm_password) {
      setError('New passwords do not match');
      return;
    }

    if (passwords.new_password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change-password/', {
        old_password: passwords.old_password,
        new_password: passwords.new_password
      });
      alert('Password changed successfully. Please login again.');
      logout();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal__header">
          <h3 className="modal__title">Change Password</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Your security is important. Please update your temporary password to continue.
            </p>

            {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group">
              <label className="form-label">Current Password</label>
              <input
                type="password"
                className="form-input"
                required
                value={passwords.old_password}
                onChange={(e) => setPasswords({ ...passwords, old_password: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">New Password</label>
              <input
                type="password"
                className="form-input"
                required
                value={passwords.new_password}
                onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input
                type="password"
                className="form-input"
                required
                value={passwords.confirm_password}
                onChange={(e) => setPasswords({ ...passwords, confirm_password: e.target.value })}
              />
            </div>
          </div>
          <div className="modal__footer">
            <button type="submit" disabled={loading} className="btn btn--primary" style={{ width: '100%' }}>
              {loading ? 'Updating...' : 'Update Password & Login'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
