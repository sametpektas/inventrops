import { useState, useEffect, useRef } from 'react';
import { FileText, Upload, CheckCircle2, AlertTriangle, Image, Download, Settings } from 'lucide-react';
import api from '../api/client';

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export default function Bulletin() {
  const [devices, setDevices] = useState([]);
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Logo state
  const [logoStatus, setLogoStatus] = useState(null); // { has_logo: bool }
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  // Month/Year selector state (default: previous month)
  const now = new Date();
  const defaultMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedYear, setSelectedYear] = useState(defaultYear);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [customNotes, setCustomNotes] = useState('');

  useEffect(() => {
    fetchStorageDevices();
    fetchLogoStatus();
  }, []);


  const fetchStorageDevices = async () => {
    try {
      setLoading(true);
      const data = await api.get('/inventory/items?device_type=storage&limit=5000');
      const storageDevices = (data.results || []).filter(
        (d) => d.model?.device_type === 'storage' || !d.model?.device_type
      );
      setDevices(storageDevices);
    } catch (err) {
      console.error(err);
      setError('Cihazlar yüklenirken hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLogoStatus = async () => {
    try {
      const data = await api.get('/bulletin/logo-status');
      setLogoStatus(data);
    } catch {}
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    try {
      setUploadingLogo(true);
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/bulletin/upload-logo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setLogoStatus({ has_logo: true });
      setToast({ type: 'success', message: 'Logo başarıyla yüklendi! Tüm bültenlerde kullanılacak.' });
      setTimeout(() => setToast(null), 3500);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Logo yüklenemedi.' });
      setTimeout(() => setToast(null), 3500);
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };


  const handleSelect = (serial_number) => {
    setSelectedSerials(prev => 
      prev.includes(serial_number) 
        ? prev.filter(s => s !== serial_number)
        : [...prev, serial_number]
    );
  };

  const openBulletinModal = () => {
    if (selectedSerials.length === 0) {
      alert("Lütfen en az bir cihaz seçin.");
      return;
    }
    setCustomNotes('');
    setShowModal(true);
  };

  const generateReport = async () => {
    try {
      setShowModal(false);
      setGenerating(true);
      setError(null);

      const notesArray = customNotes
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      const res = await api.request('/bulletin/generate-pptx', {
        method: 'POST',
        body: JSON.stringify({ 
          serialNumbers: selectedSerials,
          targetMonth: selectedMonth,
          targetYear: selectedYear,
          customNotes: notesArray
        })
      });

      if (!res.ok) throw new Error('API Error');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', `bulten-${MONTHS_TR[selectedMonth]}-${selectedYear}.pptx`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError('Bülten oluşturulurken hata oluştu. Lütfen konsolu kontrol edin.');
    } finally {
      setGenerating(false);
    }
  };

  const generateExcelReport = async () => {
    try {
      setGenerating(true);
      setError(null);

      const res = await api.request('/bulletin/generate-excel', {
        method: 'POST',
        body: JSON.stringify({
          targetMonth: selectedMonth,
          targetYear: selectedYear
        }) 
      });

      if (!res.ok) throw new Error('API Error');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', `kpi-${MONTHS_TR[selectedMonth]}-${selectedYear}.xlsx`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError('Excel oluşturulurken hata oluştu. Lütfen konsolu kontrol edin.');
    } finally {
      setGenerating(false);
    }
  };

  // Generate year options (current year and 2 years back)
  const yearOptions = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    yearOptions.push(y);
  }

  return (
    <div style={{ padding: 32, color: '#fff', minHeight: '100vh' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 32, right: 32, zIndex: 1000, padding: '16px 24px', borderRadius: 16, background: 'rgba(30,41,59,0.9)', backdropFilter: 'blur(12px)', border: `1px solid ${toast.type === 'success' ? '#10b981' : '#f43f5e'}`, boxShadow: '0 20px 40px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {toast.type === 'success' ? <CheckCircle2 size={20} color="#10b981" /> : <AlertTriangle size={20} color="#f43f5e" />}
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#6366f1', fontWeight: 600, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
          <FileText size={18} /> Raporlama
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, background: 'linear-gradient(to right,#fff,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Bülten &amp; Raporlar</h1>
        <p style={{ color: '#64748b', marginTop: 8, fontSize: '0.95rem' }}>Depolama cihazları seçerek PowerPoint ve Excel raporları oluşturun.</p>
      </div>

      {/* Control Command Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 20, marginBottom: 28 }}>
        
        {/* Left Card: Report Period & Action */}
        <div style={{
          background: '#0f172a',
          borderRadius: 16,
          border: '1px solid var(--border-default)',
          padding: '24px',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(to right, #6366f1, #3b82f6)' }} />
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(99,102,241,0.15)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.98rem', color: '#f8fafc' }}>Raporlama Dönemi &amp; Çıktılar</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Bülten ve KPI raporu için hedef zaman aralığı</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', background: '#0a0e1a', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.84rem', fontWeight: 600 }}>Hedef Dönem:</span>
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              style={{
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '7px 14px',
                borderRadius: 8,
                fontSize: '0.86rem',
                cursor: 'pointer',
                outline: 'none',
                fontWeight: 500
              }}
            >
              {MONTHS_TR.map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
            <select 
              value={selectedYear} 
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              style={{
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '7px 14px',
                borderRadius: 8,
                fontSize: '0.86rem',
                cursor: 'pointer',
                outline: 'none',
                fontWeight: 500
              }}
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button 
              onClick={generateExcelReport}
              disabled={generating}
              title="Tüm Storage ve SAN Switch'ler için Aylık KPI oluşturur"
              style={{
                flex: 1,
                background: 'linear-gradient(135deg,#10b981,#059669)',
                color: '#fff',
                border: 'none',
                padding: '11px 18px',
                borderRadius: 10,
                cursor: generating ? 'not-allowed' : 'pointer',
                opacity: generating ? 0.7 : 1,
                fontWeight: 600,
                fontSize: '0.86rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 4px 16px rgba(16,185,129,0.25)',
                transition: 'all 0.2s'
              }}
            >
              {generating ? 'Oluşturuluyor...' : 'Aylık KPI (Excel)'}
            </button>
            
            <button 
              onClick={openBulletinModal}
              disabled={generating || selectedSerials.length === 0}
              style={{
                flex: 1,
                background: 'linear-gradient(135deg,#6366f1,#4f46e5)',
                color: '#fff',
                border: 'none',
                padding: '11px 18px',
                borderRadius: 10,
                cursor: generating || selectedSerials.length === 0 ? 'not-allowed' : 'pointer',
                opacity: generating || selectedSerials.length === 0 ? 0.6 : 1,
                fontWeight: 600,
                fontSize: '0.86rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
                transition: 'all 0.2s'
              }}
            >
              {generating ? 'Oluşturuluyor...' : 'Bülten Oluştur (PPTX)'}
            </button>
          </div>
        </div>

        {/* Right Card: Corporate Branding / Logo Upload */}
        <div style={{
          background: '#0f172a',
          borderRadius: 16,
          border: '1px solid var(--border-default)',
          padding: '24px',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(to right, #10b981, #059669)' }} />
          
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(16,185,129,0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Image size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.98rem', color: '#f8fafc' }}>Sunum Marka &amp; Logo Yönetimi</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>PowerPoint bülten şablonu özelleştirme</div>
                </div>
              </div>
              
              <div>
                {logoStatus === null ? (
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Kontrol ediliyor...</span>
                ) : logoStatus.has_logo ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, fontSize: '0.74rem', fontWeight: 700, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                    <CheckCircle2 size={13} /> LOGO AKTİF
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, fontSize: '0.74rem', fontWeight: 700, background: 'rgba(251,146,60,0.15)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.3)' }}>
                    <AlertTriangle size={13} /> LOGO BEKLENİYOR
                  </span>
                )}
              </div>
            </div>

            <div style={{
              background: '#0a0e1a',
              border: '1px dashed rgba(255,255,255,0.14)',
              borderRadius: 12,
              padding: '18px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              transition: 'border-color 0.2s'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 50,
                  height: 50,
                  borderRadius: 12,
                  background: logoStatus?.has_logo ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)',
                  border: `1px solid ${logoStatus?.has_logo ? 'rgba(16,185,129,0.25)' : 'rgba(99,102,241,0.25)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: logoStatus?.has_logo ? '#10b981' : '#818cf8',
                  flexShrink: 0
                }}>
                  {logoStatus?.has_logo ? <CheckCircle2 size={24} /> : <Image size={24} />}
                </div>
                <div>
                  <div style={{ fontSize: '0.86rem', color: '#e2e8f0', fontWeight: 600, marginBottom: 3 }}>
                    {logoStatus?.has_logo ? 'Kurumsal Logo Yüklendi' : 'Henüz Logo Tanımlanmadı'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>
                    {logoStatus?.has_logo
                      ? 'Oluşturduğunuz tüm PowerPoint sunumlarının sağ üst köşesine otomatik ekleniyor.'
                      : 'Sunumlarınıza firma logosu eklemek için sağdan dosya seçin.'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-muted)' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>
              Desteklenen formatlar: <strong style={{ color: '#94a3b8' }}>PNG, JPG</strong> (Maks. 5 MB)
            </span>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoUpload} style={{ display: 'none' }} id="logo-upload-input" />
              <label 
                htmlFor="logo-upload-input" 
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 18px',
                  borderRadius: 8,
                  background: logoStatus?.has_logo ? '#1e293b' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
                  color: logoStatus?.has_logo ? '#f8fafc' : '#fff',
                  border: logoStatus?.has_logo ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  boxShadow: logoStatus?.has_logo ? 'none' : '0 4px 14px rgba(99,102,241,0.35)',
                  transition: 'all 0.2s',
                  opacity: uploadingLogo ? 0.6 : 1,
                  pointerEvents: uploadingLogo ? 'none' : 'auto'
                }}
              >
                <Upload size={15} /> {uploadingLogo ? 'Yükleniyor...' : logoStatus?.has_logo ? 'Logoyu Değiştir' : 'Logo Seç & Yükle'}
              </label>
            </div>
          </div>
        </div>
      </div>

      {error && <div style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontSize: '0.9rem' }}>{error}</div>}

      <div style={{ background: '#0f172a', padding: '24px', borderRadius: '16px', border: '1px solid var(--border-default)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '18px', color: '#f8fafc', fontSize: '1.1rem', fontWeight: 700 }}>Depolama Cihazları ({devices.length})</h3>
        
        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Cihazlar yükleniyor...</div>
        ) : devices.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Sistemde storage cihazı bulunamadı.</div>
        ) : (
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'rgba(15, 23, 42, 0.8)' }}>
                <th style={{ padding: '12px 14px' }}>
                  <input 
                    type="checkbox" 
                    onChange={(e) => {
                      if (e.target.checked) setSelectedSerials(devices.map(d => d.serial_number));
                      else setSelectedSerials([]);
                    }}
                    checked={selectedSerials.length === devices.length && devices.length > 0}
                  />
                </th>
                <th style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>Hostname</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>Seri No</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>Model</th>
                <th style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>Lokasyon (Veri Merkezi)</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(device => (
                <tr key={device.serial_number} style={{ borderBottom: '1px solid var(--border-muted)' }}>
                  <td style={{ padding: '12px 14px' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedSerials.includes(device.serial_number)}
                      onChange={() => handleSelect(device.serial_number)}
                    />
                  </td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-primary)', fontWeight: 500 }}>{device.hostname || '-'}</td>
                  <td className="mono" style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{device.serial_number}</td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-primary)' }}>{device.model?.vendor?.name} {device.model?.name}</td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                    {device.rack?.room?.datacenter?.name || 'Belirtilmemiş'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Custom Notes Modal */}
      {showModal && (
        <div className="modal-overlay" style={{ background: 'rgba(0, 0, 0, 0.82)', backdropFilter: 'blur(8px)', zIndex: 9999 }}>
          <div className="modal" style={{ background: '#0f172a', border: '1px solid rgba(255, 255, 255, 0.16)', borderRadius: '16px', maxWidth: '560px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.9)', overflow: 'hidden' }}>
            
            <div className="modal__header" style={{ background: 'rgba(19, 28, 53, 0.95)', padding: '18px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <h3 className="modal__title" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                Bülten Oluştur (PPTX)
              </h3>
              <button className="modal__close" onClick={() => setShowModal(false)} style={{ color: 'var(--text-muted)', fontSize: '1.5rem', background: 'transparent', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div className="modal__body" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#0f172a' }}>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '0.92rem', lineHeight: 1.5 }}>
                <strong style={{ color: '#f8fafc' }}>{MONTHS_TR[selectedMonth]} {selectedYear}</strong> dönemi için PowerPoint bülteni oluşturulacak. 
                Değerlendirme slaytına eklemek istediğiniz maddeleri aşağıya yazabilirsiniz.
              </p>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ color: '#818cf8', fontWeight: 600, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
                  Ek Değerlendirme Maddeleri (Opsiyonel)
                </label>
                <p style={{ color: '#64748b', margin: '0 0 10px', fontSize: '0.8rem' }}>
                  Her satır ayrı bir madde olarak sunumdaki Değerlendirme slaytına eklenir.
                </p>
                <textarea
                  className="form-input"
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder={"Cloud projesine destek verilmeye devam edilmekte.\nNAS ortamının kurulumu devam ediyor."}
                  rows={6}
                  style={{
                    width: '100%',
                    background: '#1e293b !important',
                    color: '#f8fafc !important',
                    border: '1px solid rgba(255, 255, 255, 0.15) !important',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    fontSize: '0.9rem',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div className="modal__footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', background: '#0a0e1a' }}>
              <button 
                className="btn btn--secondary"
                onClick={() => setShowModal(false)}
                style={{
                  background: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  padding: '9px 20px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.86rem'
                }}
              >
                İptal
              </button>
              <button 
                className="btn btn--primary"
                onClick={generateReport}
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 24px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)'
                }}
              >
                Bülteni İndir (PPTX)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
