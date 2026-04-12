import { useState, useEffect } from 'react';
import api from '../api/client';

export default function LdapConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Form State
  const [form, setForm] = useState({
    server_uri: 'ldaps://server:636',
    bind_dn: '',
    bind_password: '',
    user_search_base: 'ou=users,dc=example,dc=com',
    ca_certificate: '',
    is_active: false
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    setLoading(true);
    try {
      const data = await api.get('/auth/ldap-config/');
      if (data?.results && data.results.length > 0) {
        setConfig(data.results[0]);
        setForm(data.results[0]);
      }
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

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (config && config.id) {
        await api.patch(`/auth/ldap-config/${config.id}/`, form);
      } else {
        const res = await api.post('/auth/ldap-config/', form);
        setConfig(res);
      }
      showToastMsg('LDAP configuration saved.');
    } catch (err) {
      showToastMsg('Failed to save LDAP configuration.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>LDAP / Active Directory Integration</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 8 }}>
            Configure your LDAPS server to allow external user authentication.
          </p>
        </div>
      </div>

      <div className="panel" style={{ padding: 24 }}>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input 
              type="checkbox" 
              checked={form.is_active} 
              id="ldap-active"
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              style={{ width: 18, height: 18, accentColor: 'var(--primary)' }}
            />
            <label htmlFor="ldap-active" style={{ fontWeight: 600, fontSize: '1.05rem', cursor: 'pointer' }}>
              Enable LDAP Authentication Backend
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="form-group">
              <label className="form-label">Server URI</label>
              <input 
                className="form-input" 
                value={form.server_uri} 
                onChange={e => setForm({...form, server_uri: e.target.value})} 
                placeholder="ldaps://ad.contoso.com:636" 
                required
              />
              <small style={{color: 'var(--text-muted)'}}>Must start with ldap:// or ldaps://</small>
            </div>
            <div className="form-group">
              <label className="form-label">Search Base (Base DN)</label>
              <input 
                className="form-input" 
                value={form.user_search_base} 
                onChange={e => setForm({...form, user_search_base: e.target.value})} 
                placeholder="ou=users,dc=contoso,dc=com" 
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="form-group">
              <label className="form-label">Bind DN</label>
              <input 
                className="form-input" 
                value={form.bind_dn} 
                onChange={e => setForm({...form, bind_dn: e.target.value})} 
                placeholder="cn=admin,dc=contoso,dc=com" 
              />
            </div>
            <div className="form-group">
              <label className="form-label">Bind Password</label>
              <input 
                className="form-input" 
                type="password"
                onChange={e => setForm({...form, bind_password: e.target.value})} 
                placeholder={config ? "•••••••• (Leave blank to keep existing)" : "Your LDAP Password"} 
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">LDAPS Root CA Certificate</label>
            <textarea 
              className="form-input" 
              rows={8} 
              value={form.ca_certificate} 
              onChange={e => setForm({...form, ca_certificate: e.target.value})} 
              placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----" 
              style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
            <small style={{color: 'var(--text-muted)'}}>
              If using self-signed LDAPS, provide the BASE64 encoded Root CA Certificate here to establish SSL trust.
            </small>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>

      {toast && <div className={`toast toast--${toast.type}`}>{toast.type === 'success' ? '✓' : '✕'} {toast.message}</div>}
    </div>
  );
}
