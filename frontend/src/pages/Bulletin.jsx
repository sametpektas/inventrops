import { useState, useEffect } from 'react';
import api from '../api/client';

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export default function Bulletin() {
  const [devices, setDevices] = useState([]);
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

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
    <div className="bulletin-page" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text)' }}>Bülten</h2>
          <p style={{ color: 'var(--text-muted)', margin: '5px 0 0' }}>
            Raporlamak istediğiniz depolama cihazlarını seçin, hedef ayı belirleyin ve bülten oluşturun.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Month/Year Selector */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: '600' }}>Hedef Ay:</label>
            <select 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              style={{
                background: 'var(--bg-panel)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer'
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
                background: 'var(--bg-panel)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                cursor: 'pointer'
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
