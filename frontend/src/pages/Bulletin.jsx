import { useState, useEffect } from 'react';
import api from '../api/client';

export default function Bulletin() {
  const [devices, setDevices] = useState([]);
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

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

  const generateReport = async () => {
    if (selectedSerials.length === 0) {
      alert("Lütfen en az bir cihaz seçin.");
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      const res = await api.request('/bulletin/generate-pptx', {
        method: 'POST',
        body: JSON.stringify({ serialNumbers: selectedSerials })
      });

      if (!res.ok) throw new Error('API Error');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', 'inventrops-bulten.pptx');
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

      // Artık backend tüm storage ve san_switch'leri kendisi çekecek
      const res = await api.request('/bulletin/generate-excel', {
        method: 'POST',
        body: JSON.stringify({}) 
      });

      if (!res.ok) throw new Error('API Error');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.setAttribute('download', 'inventrops-aylik-kpi.xlsx');
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

  return (
    <div className="bulletin-page" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text)' }}>Bülten</h2>
          <p style={{ color: 'var(--text-muted)', margin: '5px 0 0' }}>
            Raporlamak istediğiniz depolama (Storage/SAN) cihazlarını seçin ve 6 aylık performans bültenini indirin.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={generateExcelReport}
            disabled={generating}
            title="Tüm Storage ve SAN Switch'ler için Aylık KPI oluşturur (Seçime gerek yok)"
            style={{
              background: 'var(--green)', // Using a green color for Excel
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
            onClick={generateReport}
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
    </div>
  );
}
