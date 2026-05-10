# Aylık KPI Raporu (Excel) Entegrasyon Planı

## 1. Genel Bakış
Kullanıcının talebi üzerine, Xormon üzerinden çekilen Storage ve SAN cihazlarına ait Aylık KPI verilerini hesaplayan, geçmiş aylar ile karşılaştırmalı olarak Excel formatında raporlayan bir sistem oluşturulacaktır. Her aya ait performans ve kapasite değerleri (Örn: Önceki Ay IOPS vs Bu Ay IOPS) veritabanında saklanarak tarihsel bütünlük korunacaktır.

## 2. Mimari ve Veritabanı (Database Architect)
### 2.1. Yeni Prisma Modeli (KPI History)
Aylık Kapasite KPI verilerinin dondurulup saklanması için Prisma şemasına yeni bir model eklenecektir.
* **Model:** `MonthlyCapacityKPI`
* **Alanlar:**
  * `id`: UUID
  * `deviceId`: String (InventoryItem bağlantısı)
  * `reportMonth`: DateTime (Hangi aya ait olduğu)
  * `capacityUsedPercent`: Float
  * `capacityUsedGiB`: Float (opsiyonel/gerekirse)
  * `createdAt`: DateTime

### 2.2. Veri Akışı
* Rapor oluşturulduğunda sistem önce `MonthlyCapacityKPI` tablosunda ilgili aya ait veri var mı diye bakar.
* Yoksa, o aya ait kapasite verilerini çekip dondurur (snapshot alır).
* Excel oluşturulurken cihaz bazında "Önceki Aylar" ve "Bu Ay" yan yana (ay bazlı kolonlar halinde) listelenir.

## 3. Backend (Backend Specialist)
### 3.1. API Uç Noktaları
* `GET /api/reports/kpi/excel`: Excel raporunu üretecek uç nokta.
* Parametre: Hangi ay/yıl aralığının isteneceği (varsayılan: son 6 ay vb.)

### 3.2. Excel Üretimi (ExcelJS)
* `exceljs` kullanılarak sadece **Kapasite Kullanım** verilerini içeren bir Excel üretilecek.
* Kolonlar (Örnek):
  - Cihaz Adı
  - Toplam Kapasite
  - Ocak Ayı Kullanım (%)
  - Şubat Ayı Kullanım (%)
  - Mart Ayı Kullanım (%)
  - Nisan Ayı Kullanım (%)
  - Mayıs Ayı Kullanım (%)

## 4. Frontend (Frontend Specialist)
### 4.1. UI Entegrasyonu
* Raporlama/Bülten veya Analytics sayfasına yeni bir **"Aylık KPI Raporu İndir (Excel)"** butonu eklenecek.
* Butona tıklandığında hangi ay için rapor alınacağı (Ay/Yıl seçici) sorulacak.

## 5. Doğrulama (Test Engineer)
* `schema_validator.py` çalıştırılarak yeni tablonun veritabanına sorunsuz eklendiği doğrulanacak.
* Excel dosyasının formatı test edilecek.

---
**Bekleyen Sorular / Kararlar (Socratic Gate):**
1. Excel görselini henüz iletmediniz, kolonlar yukarıdaki tahminim gibi (Önceki ay vs Bu ay yan yana) mi olacak yoksa eklemek istediğiniz başka kolonlar var mı?
2. KPI raporu tüm lokasyonlardaki cihazları tek sekmede mi göstersin, yoksa lokasyon bazlı Excel sekmeleri (Ankara, İstanbul) mi oluşturalım?
