import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Modals state
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);

  // Forms state
  const [vendorForm, setVendorForm] = useState({ name: '', support_contact: '' });
  const [modelForm, setModelForm] = useState({ name: '', vendor: '', device_type: 'server', rack_unit_size: 1 });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [v, m] = await Promise.all([
        api.get('/inventory/vendors'),
        api.get('/inventory/models')
      ]);
      setVendors(v?.results || []);
      setModels(m?.results || []);
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

  const handleCreateVendor = async (e) => {
    e.preventDefault();
    try {
      await api.post('/inventory/vendors', vendorForm);
      setShowVendorModal(false);
      setVendorForm({ name: '', support_contact: '' });
      fetchData();
      showToastMsg('Vendor created');
    } catch (err) {
      showToastMsg('Error creating vendor', 'error');
    }
  };

  const handleCreateModel = async (e) => {
    e.preventDefault();
    try {
      await api.post('/inventory/models', modelForm);
      setShowModelModal(false);
      setModelForm({ name: '', vendor: '', device_type: 'server', rack_unit_size: 1 });
      fetchData();
      showToastMsg('Hardware model created');
    } catch (err) {
      showToastMsg('Error creating model', 'error');
    }
  };

  const handleDelete = async (endpoint, id) => {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    try {
      await api.del(`/inventory/${endpoint}/${id}`);
      fetchData();
      showToastMsg('Deleted successfully');
    } catch (err) {
      showToastMsg('Deletion failed due to dependencies', 'error');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="grid-2" style={{ gap: 24 }}>
        {/* Vendors Panel */}
        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Vendors</h2>
            <button className="btn btn--sm btn--primary" onClick={() => setShowVendorModal(true)}>+ Add Vendor</button>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Support Contact</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {vendors.map(v => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 600 }}>{v.name}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{v.support_contact || '—'}</td>
                  <td>
                    <button className="btn btn--sm btn--danger" onClick={() => handleDelete('vendors', v.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Models Panel */}
        <div className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Models</h2>
            <button className="btn btn--sm btn--primary" onClick={() => setShowModelModal(true)}>+ Add Model</button>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Model Name</th><th>Vendor</th><th>Category</th><th>Type</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td>
                  <td>{m.vendor_name}</td>
                  <td><span className="badge badge--secondary">{m.category}</span></td>
                  <td><span className="badge badge--info">{m.device_type}</span></td>
                  <td>
                    <button className="btn btn--sm btn--danger" onClick={() => handleDelete('models', m.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Vendor Modal --- */}
      {showVendorModal && (
        <div className="modal-overlay" onClick={() => setShowVendorModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal__header">
              <h3 className="modal__title">Create Vendor</h3>
              <button className="modal__close" onClick={() => setShowVendorModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateVendor}>
              <div className="modal__body">
                <div className="form-group">
                  <label className="form-label">Vendor Name *</label>
                  <input className="form-input" required value={vendorForm.name} onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Support Contact</label>
                  <input className="form-input" value={vendorForm.support_contact} onChange={e => setVendorForm({ ...vendorForm, support_contact: e.target.value })} />
                </div>
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setShowVendorModal(false)}>Cancel</button>
                <button type="submit" className="btn btn--primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Model Modal --- */}
      {showModelModal && (
        <div className="modal-overlay" onClick={() => setShowModelModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal__header">
              <h3 className="modal__title">Create Model</h3>
              <button className="modal__close" onClick={() => setShowModelModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateModel}>
              <div className="modal__body">
                <div className="form-group">
                  <label className="form-label">Vendor *</label>
                  <select className="form-input form-select" required value={modelForm.vendor} onChange={e => setModelForm({ ...modelForm, vendor: e.target.value })}>
                    <option value="">Select Vendor</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Model Name *</label>
                  <input className="form-input" required value={modelForm.name} onChange={e => setModelForm({ ...modelForm, name: e.target.value })} />
                </div>
                <div className="grid-2" style={{ gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <select 
                      className="form-input form-select" 
                      value={modelForm.category || 'hardware'} 
                      onChange={e => {
                        const cat = e.target.value;
                        setModelForm({ 
                          ...modelForm, 
                          category: cat,
                          device_type: cat === 'software' ? 'software' : 'server',
                          rack_unit_size: cat === 'software' ? 0 : 1
                        });
                      }}
                    >
                      <option value="hardware">Hardware</option>
                      <option value="software">Software</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select className="form-input form-select" value={modelForm.device_type} onChange={e => setModelForm({ ...modelForm, device_type: e.target.value })}>
                      {modelForm.category === 'software' ? (
                        <option value="software">Software / Platform</option>
                      ) : (
                        <>
                          <option value="server">Server</option>
                          <option value="network_switch">Network Switch</option>
                          <option value="san_switch">SAN Switch</option>
                          <option value="firewall">Firewall</option>
                          <option value="storage">Storage</option>
                          <option value="backup">Backup</option>
                          <option value="pdu">PDU</option>
                          <option value="ups">UPS</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
                {modelForm.category !== 'software' && (
                  <div className="form-group">
                    <label className="form-label">Rack Units (Size)</label>
                    <input 
                      type="number" 
                      className="form-input" 
                      min="1" 
                      value={modelForm.rack_unit_size} 
                      onChange={e => setModelForm({ ...modelForm, rack_unit_size: parseInt(e.target.value) })}
                    />
                  </div>
                )}
              </div>
              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={() => setShowModelModal(false)}>Cancel</button>
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
