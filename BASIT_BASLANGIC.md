# 🚀 Hızlı Başlangıç - Railway.app ile Deployment

Bu rehber, projenizi 15 dakikada domain'inize yüklemeniz için hazırlanmıştır.

## ⚡ Hızlı Adımlar (Özet)

1. **Railway.app hesabı oluştur** → https://railway.app
2. **GitHub'a push et** (eğer yoksa)
3. **PostgreSQL ekle** (Railway'de)
4. **Backend ekle** (Railway'de)
5. **Frontend ekle** (Railway'de)
6. **Environment variables ayarla**
7. **Domain bağla**

---

## 📝 Detaylı Adımlar

### Adım 1: Railway.app Hesabı

1. https://railway.app adresine git
2. **"Start a New Project"** tıkla
3. **"Deploy from GitHub repo"** seç
4. GitHub hesabınla giriş yap
5. QuickYel repository'ni seç

✅ Railway hesabın hazır!

---

### Adım 2: PostgreSQL Veritabanı

1. Railway dashboard'da **"New"** butonuna tıkla
2. **"Database"** → **"Add PostgreSQL"** seç
3. Birkaç saniye bekle, PostgreSQL hazır olacak
4. PostgreSQL servisinin **"Variables"** sekmesine git
5. **`DATABASE_URL`** değişkenini kopyala (bunu backend için kullanacağız)

✅ Veritabanın hazır!

---

### Adım 3: Backend Servisi

1. Railway dashboard'da tekrar **"New"** butonuna tıkla
2. **"GitHub Repo"** seç
3. Aynı QuickYel repository'ni seç
4. **"Settings"** sekmesine git:
   - **Root Directory**: `backend` yaz
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. **"Variables"** sekmesine git ve şu değişkenleri ekle:

```
DATABASE_URL=<PostgreSQL'den kopyaladığın URL>
GOOGLE_CLOUD_PROJECT=muhtar-5ab9b
GCS_BUCKET_NAME=quickyel-receipts
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=AIzaSyAkpM2NjfcmgemxW8LHFJz8FM0nxELWMfQ
JWT_SECRET=<32-karakter-güçlü-şifre-buraya>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
CORS_ORIGINS=https://yourdomain.com
DEBUG=false
VISION_MONTHLY_LIMIT=1000
```

> 💡 **JWT_SECRET için**: https://randomkeygen.com/ adresinden 32 karakterlik bir şifre oluştur

6. **Google Cloud Credentials ekle**:
   - `backend/google-cloud-vision-key.json` dosyasını aç
   - Tüm içeriğini kopyala
   - Railway'de **"New Variable"** tıkla
   - **Name**: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   - **Value**: Kopyaladığın JSON içeriğini yapıştır

✅ Backend hazır!

---

### Adım 4: Frontend Servisi

1. Railway dashboard'da tekrar **"New"** butonuna tıkla
2. **"GitHub Repo"** seç
3. Aynı QuickYel repository'ni seç
4. **"Settings"** sekmesine git:
   - **Root Directory**: `frontend` yaz
5. **"Variables"** sekmesine git ve şu değişkeni ekle:

```
NEXT_PUBLIC_API_URL=https://your-backend-url.railway.app
```

> 💡 Backend URL'ini backend servisinin **"Settings"** > **"Domains"** bölümünden alabilirsin.

✅ Frontend hazır!

---

### Adım 5: Domain Bağlama

#### Backend Domain (api.yourdomain.com)

1. Backend servisinin **"Settings"** sekmesine git
2. **"Domains"** bölümüne git
3. **"Custom Domain"** tıkla
4. Domain'ini gir: `api.yourdomain.com`
5. Railway sana DNS kayıtlarını verecek
6. Domain sağlayıcına (Namecheap, GoDaddy, vs.) git
7. DNS kayıtlarını ekle (CNAME kaydı)

#### Frontend Domain (yourdomain.com)

1. Frontend servisinin **"Settings"** sekmesine git
2. **"Domains"** bölümüne git
3. **"Custom Domain"** tıkla
4. Domain'ini gir: `yourdomain.com` veya `www.yourdomain.com`
5. DNS kayıtlarını domain sağlayıcına ekle

> ⏰ DNS yayılması 5-60 dakika sürebilir

✅ Domain'ler bağlandı!

---

### Adım 6: CORS Ayarlarını Güncelle

Domain'ler bağlandıktan sonra:

1. Backend servisinin **"Variables"** sekmesine git
2. `CORS_ORIGINS` değişkenini bul
3. Değerini güncelle: `https://yourdomain.com,https://www.yourdomain.com`
4. Backend otomatik olarak yeniden başlayacak

✅ CORS ayarları güncellendi!

---

### Adım 7: Frontend API URL'ini Güncelle

1. Frontend servisinin **"Variables"** sekmesine git
2. `NEXT_PUBLIC_API_URL` değişkenini bul
3. Değerini güncelle: `https://api.yourdomain.com`
4. Frontend otomatik olarak yeniden başlayacak

✅ Frontend API URL'i güncellendi!

---

## ✅ Kontrol Listesi

Her şeyin çalıştığını kontrol et:

- [ ] Backend health check: `https://api.yourdomain.com/health` → `{"status": "healthy"}`
- [ ] Frontend açılıyor: `https://yourdomain.com`
- [ ] Database bağlantısı çalışıyor (Railway PostgreSQL'de tablolar görünüyor)

---

## 🐛 Sorun Giderme

### Backend başlamıyor
- **Logs** sekmesine git ve hataları kontrol et
- Environment variables'ın doğru olduğundan emin ol
- `DATABASE_URL`'in doğru olduğunu kontrol et

### Frontend backend'e bağlanamıyor
- `NEXT_PUBLIC_API_URL`'in doğru olduğundan emin ol
- Backend'in çalıştığını kontrol et (`/health` endpoint'i)
- CORS ayarlarını kontrol et

### Domain çalışmıyor
- DNS kayıtlarının doğru olduğundan emin ol
- 1 saat bekle (DNS yayılması için)
- Railway'de domain'in "Active" olduğunu kontrol et

---

## 💰 Maliyet

- **Railway**: $5/ay ücretsiz kredi (küçük projeler için yeterli)
- **Google Cloud**: İlk 1000 OCR isteği/ay ücretsiz
- **Toplam**: İlk aylarda neredeyse ücretsiz! 🎉

---

## 📞 Yardım

Sorun yaşarsan:
1. Railway dashboard'daki **"Logs"** sekmesine bak
2. Backend ve Frontend loglarını kontrol et
3. Environment variables'ı tekrar gözden geçir

**Başarılar! 🚀**
