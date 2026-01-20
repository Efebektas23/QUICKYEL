# 🔐 Railway Google Cloud Credentials Setup

Bu rehber, Railway'de Google Cloud credentials'ı environment variable olarak nasıl ekleyeceğinizi açıklar.

## ⚠️ ÖNEMLİ GÜVENLİK NOTU

**Google Cloud credentials dosyasını (`google-cloud-vision-key.json`) asla GitHub'a commit etmeyin!**
Bu dosya `.gitignore` içinde olmalı ve sadece environment variable olarak Railway'e eklenmelidir.

---

## 📋 Adım Adım Kurulum

### 1. Google Cloud Credentials Dosyasını Hazırlayın

1. Bilgisayarınızda `backend/google-cloud-vision-key.json` dosyasını açın
2. **Tüm içeriğini** kopyalayın (JSON formatında, tırnak işaretleri dahil)

Örnek format:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "...",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

### 2. Railway'de Environment Variable Ekleyin

1. Railway dashboard'da **Backend servisine** (QUICKYEL) tıklayın
2. **"Variables"** sekmesine gidin
3. **"New Variable"** butonuna tıklayın
4. **Name:** `GOOGLE_APPLICATION_CREDENTIALS_JSON` veya `GOOGLE_CREDENTIALS_JSON`
   - Her iki isim de desteklenir
5. **Value:** Kopyaladığınız JSON içeriğini **tam olarak** yapıştırın
6. **"Add"** butonuna tıklayın

### 3. Backend'i Redeploy Edin

1. **"Deployments"** sekmesine gidin
2. Sağ üstteki **"..."** menüsüne tıklayın
3. **"Redeploy"** seçeneğini seçin

---

## ✅ Kontrol

Backend loglarında şunu görmelisiniz:
```
Created temporary Google Cloud credentials file: /tmp/tmpXXXXXX.json
Google Cloud credentials configured: /tmp/tmpXXXXXX.json
Google services initialized successfully
```

Eğer hata görürseniz:
```
⚠️ No Google Cloud credentials found!
⚠️ Please set GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_JSON environment variable
```

Bu durumda:
1. Environment variable'ın doğru eklendiğinden emin olun
2. JSON formatının doğru olduğunu kontrol edin
3. Backend'i yeniden deploy edin

---

## 🔍 Sorun Giderme

### Hata: "Failed to parse Google credentials JSON"

**Sebep:** JSON formatı hatalı veya eksik

**Çözüm:**
1. JSON içeriğinin tam olduğundan emin olun
2. Tırnak işaretlerinin doğru olduğunu kontrol edin
3. Özel karakterlerin escape edildiğinden emin olun

### Hata: "File ./google-cloud-vision-key.json was not found"

**Sebep:** Environment variable eklenmemiş veya yanlış isimle eklenmiş

**Çözüm:**
1. Railway'de `GOOGLE_APPLICATION_CREDENTIALS_JSON` veya `GOOGLE_CREDENTIALS_JSON` değişkeninin olduğunu kontrol edin
2. Değişken adının doğru olduğundan emin olun (büyük/küçük harf duyarlı)
3. Backend'i redeploy edin

### Hata: "Failed to initialize Google services"

**Sebep:** Credentials dosyası oluşturuldu ama Google SDK'sı okuyamıyor

**Çözüm:**
1. Logları kontrol edin - credentials dosyası oluşturuldu mu?
2. Google Cloud project ID'nin doğru olduğundan emin olun
3. Service account'un gerekli izinlere sahip olduğunu kontrol edin

---

## 📝 Notlar

- Environment variable **tek satır** olarak eklenmelidir (JSON formatında)
- Railway otomatik olarak geçici dosya oluşturur ve `GOOGLE_APPLICATION_CREDENTIALS` environment variable'ını ayarlar
- Google SDK'ları (`vision.ImageAnnotatorClient`, `storage.Client`) otomatik olarak bu environment variable'ı kullanır
- Local development için dosya yolu kullanılabilir (fallback)

---

**Başarılar! 🚀**
