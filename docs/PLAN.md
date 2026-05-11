# Bülten Ay Seçici & Değerlendirme Slaytı Geliştirme Planı

## Özet
Bülten ve KPI raporlarına ay bazlı filtreleme özelliği eklenmesi, bültenin sonuna otomatik IOPS/Response Time yorumları ve manuel madde girişi içeren "Değerlendirme" slaytı eklenmesi.

---

## 1. Frontend Değişiklikleri (Bulletin.jsx)

### 1.1 Ay Seçici (Month Picker)
- Bülten oluştur formuna Ay/Yıl seçici dropdown eklenir
- Varsayılan: Bir önceki ay (Mayıs'taysak → Nisan)
- Format: { month: 0-11, year: 2026 } olarak backend'e gönderilir
- KPI butonu da aynı ay seçiciden faydalanır

### 1.2 Manuel Madde Girişi (Text Area)
- "Bülten Oluştur" butonuna tıklandığında önce bir modal/dialog açılır
- Dialog içinde:
  - Seçilen ay bilgisi gösterilir
  - Çok satırlı text alanı ("Ek değerlendirme maddeleri") yer alır
  - Her satır ayrı bir bullet point olarak slayta basılır
  - "Oluştur" ve "İptal" butonları
- "Oluştur"a tıklandığında customNotes olarak backend'e POST edilir

### 1.3 API İstek Formatı (Güncelleme)
POST /api/bulletin/generate
- serialNumbers, targetMonth, targetYear, customNotes

POST /api/bulletin/generate-excel
- targetMonth, targetYear

---

## 2. Backend — Bulletin Controller Değişiklikleri

### 2.1 Tarih Aralığı Hesaplama
- targetMonth ve targetYear request body'den alınır
- Seçilen ayın 1. günü ile son günü arasındaki IOPS/Response Time verileri çekilir
- Kapasite grafikleri: Seçilen aydan geriye 6 aylık veri
- Varsayılan (parametre yoksa): Bir önceki ay

### 2.2 Kapak Slaytı Güncelleme
- Başlık: "BT Storage Yönetimi" (sabit)
- Alt başlık: "BT Açık Sistemler Depolama ve Yedekleme Sistemleri Yönetimi" (sabit)
- Alt satır: "Storage {Ay Adı} Ayı Bülteni" (dinamik)
- Logo: backend/assets/logo.png dosyasından (varsa) sağ üst köşeye eklenir

### 2.3 Değerlendirme Slaytı (Son Slayt)
- Başlık: "Değerlendirme (Disk - SAN) – {Ay Adı} -{Yıl}"
- Otomatik maddeler (her seçilen cihaz için):
  - Seçilen aydaki ortalama Response Time ve IOPS hesaplanır
  - Format: "{Cihaz} disklerinde cevap süreleri {avg_rt} ms seyretmektedir. Disk I/O rate ay ortalamasında {avg_iops} IOPS civarındadır."
- Manuel maddeler: customNotes dizisindeki her eleman ayrı bullet point olarak eklenir
- Sıralama: Önce manuel maddeler, sonra otomatik maddeler

### 2.4 Logo Desteği
- backend/assets/logo.png dosyası varsa kapak ve değerlendirme slaytlarının sağ üst köşesine eklenir
- Dosya yoksa logo alanı boş bırakılır (hata vermez)

---

## 3. Backend — KPI Controller Değişiklikleri

### 3.1 Ay Filtresi
- targetMonth ve targetYear request body'den alınır
- Seçilen ayın verileri ile önceki ayların verilerini birlikte gösterir
- Varsayılan: Mevcut ay

---

## 4. Dosya Değişiklik Listesi

| Dosya | Değişiklik |
|-------|-----------|
| frontend/src/pages/Bulletin.jsx | Ay seçici, modal dialog, customNotes text area |
| backend/src/controllers/bulletin.controller.ts | targetMonth/Year, kapak slaytı, değerlendirme slaytı, logo |
| backend/src/controllers/kpi.controller.ts | targetMonth/Year, tarih filtreleme |
| backend/assets/logo.png | Kullanıcı tarafından yüklenir |

---

## 5. Uygulama Sırası

1. Backend: Bulletin controller — ay filtresi + değerlendirme slaytı + kapak güncelleme
2. Backend: KPI controller — ay filtresi
3. Frontend: Bulletin.jsx — ay seçici + modal dialog
4. Test: Build doğrulama
