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
      const data = await api.get('/inventory/items?limit=500');
      const storageDevices = data.results.filter(
        d => d.model?.device_type === 'storage'
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

      {/* Logo Settings Card */}
      <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', padding: '20px 24px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Image size={22} color="#818cf8" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 3 }}>Firma Logosu</div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {logoStatus === null ? 'Kontrol ediliyor...' : logoStatus.has_logo
                ? <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={13} /> Logo yüklü — PowerPoint\'a otomatik ekleniyor</span>
                : <span style={{ color: '#fb923c', display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={13} /> Logo yüklenmemiş — bültenlerde logo olmayacak</span>
              }
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoUpload} style={{ display: 'none' }} id="logo-upload-input" />
          <label htmlFor="logo-upload-input" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', boxShadow: '0 6px 16px rgba(99,102,241,0.35)', transition: 'opacity 0.2s', opacity: uploadingLogo ? 0.6 : 1, pointerEvents: uploadingLogo ? 'none' : 'auto' }}>
            <Upload size={16} /> {uploadingLogo ? 'Yükleniyor...' : logoStatus?.has_logo ? 'Logoyu Güncelle' : 'Logo Yükle'}
          </label>
          <div style={{ fontSize: '0.72rem', color: '#475569' }}>PNG / JPG &lt; 5MB</div>
        </div>
      </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Month/Year Selector */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: '600' }}>Hedef Ay:</label>
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              style={{
                background: '#1e293b', // Darker background for contrast
                color: '#f8fafc',      // Bright text
                border: '1px solid #475569',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer',
                outline: 'none'
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
                border: '1px solid #475569',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={generateExcelReport}
            disabled={generating}
            title="Tüm Storage ve SAN Switch'ler için Aylık KPI oluşturur (Seçime gerek yok)"
            style={{
              background: 'var(--green)',
              color: '#fff',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.7 : 1,
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {generating ? 'Oluşturuluyor...' : 'Aylık KPI (Excel)'}
          </button>
          
          <button 
            onClick={openBulletinModal}
            disabled={generating || selectedSerials.length === 0}
            style={{
              background: 'var(--teal)',
              color: '#fff',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: generating || selectedSerials.length === 0 ? 'not-allowed' : 'pointer',
              opacity: generating || selectedSerials.length === 0 ? 0.7 : 1,
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {generating ? 'Oluşturuluyor...' : 'Bülten Oluştur (PPTX)'}
          </button>
        </div>
      </div>

      {error && <div style={{ color: 'red', marginBottom: '20px' }}>{error}</div>}

      <div style={{ background: 'var(--bg-panel)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px', color: 'var(--text)' }}>Depolama Cihazları ({devices.length})</h3>
        
        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Cihazlar yükleniyor...</div>
        ) : devices.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>Sistemde storage cihazı bulunamadı.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px' }}>
                  <input 
                    type="checkbox" 
                    onChange={(e) => {
                      if (e.target.checked) setSelectedSerials(devices.map(d => d.serial_number));
                      else setSelectedSerials([]);
                    }}
                    checked={selectedSerials.length === devices.length && devices.length > 0}
                  />
                </th>
                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Hostname</th>
                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Seri No</th>
                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Model</th>
                <th style={{ padding: '10px', color: 'var(--text-muted)' }}>Lokasyon (Veri Merkezi)</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(device => (
                <tr key={device.serial_number} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedSerials.includes(device.serial_number)}
                      onChange={() => handleSelect(device.serial_number)}
                    />
                  </td>
                  <td style={{ padding: '10px', color: 'var(--text)' }}>{device.hostname || '-'}</td>
                  <td style={{ padding: '10px', color: 'var(--text)' }}>{device.serial_number}</td>
                  <td style={{ padding: '10px', color: 'var(--text)' }}>{device.model?.vendor?.name} {device.model?.name}</td>
                  <td style={{ padding: '10px', color: 'var(--text)' }}>
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
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '30px',
            width: '550px',
            maxWidth: '90vw',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
          }}>
            <h3 style={{ margin: '0 0 5px', color: 'var(--text)' }}>
              Bülten Oluştur
            </h3>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 20px', fontSize: '0.9rem' }}>
              <strong>{MONTHS_TR[selectedMonth]} {selectedYear}</strong> dönemi için bülten oluşturulacak. 
              Değerlendirme slaytına eklemek istediğiniz maddeleri aşağıya yazabilirsiniz.
            </p>

            <label style={{ color: 'var(--text)', fontWeight: '600', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>
              Ek Değerlendirme Maddeleri (opsiyonel)
            </label>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 8px', fontSize: '0.8rem' }}>
              Her satır ayrı bir madde olarak slayta eklenir.
            </p>
            <textarea
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder={"Cloud projesine destek verilmeye devam edilmekte.\nNAS ortamının kurulumu devam ediyor."}
              rows={6}
              style={{
                width: '100%',
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '0.9rem',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button 
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                İptal
              </button>
              <button 
                onClick={generateReport}
                style={{
                  background: 'var(--teal)',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Oluştur
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
