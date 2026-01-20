# 🔧 Deployment Düzeltmeleri ve İyileştirmeleri

Bu dokümantasyon, Railway.app deployment için yapılan kritik düzeltmeleri açıklar.

## ✅ Yapılan Düzeltmeler

### 1. Google Cloud Yetkilendirme Mantığı (Backend)

**Sorun:** Railway'de dosya sistemi olmadığı için Google Cloud credentials'ı environment variable olarak saklamak gerekiyordu.

**Çözüm:**
- `config.py` içinde `setup_google_credentials()` fonksiyonu eklendi
- Bu fonksiyon `GOOGLE_APPLICATION_CREDENTIALS_JSON` environment variable'ını okuyor
- JSON içeriğini geçici bir dosyaya yazıyor (`tempfile` kullanarak)
- `GOOGLE_APPLICATION_CREDENTIALS` environment variable'ını bu dosya yoluna ayarlıyor
- Fonksiyon `main.py` içindeki `lifespan` startup aşamasında çağrılıyor

**Kullanım:**
Railway'de backend servisinin "Variables" sekmesine şunu ekleyin:
```
GOOGLE_APPLICATION_CREDENTIALS_JSON=<google-cloud-vision-key.json dosyasının tüm içeriği>
```

**Dosyalar:**
- `backend/config.py` - `setup_google_credentials()` fonksiyonu
- `backend/main.py` - Startup aşamasında credentials setup

---

### 2. CORS Ayarlarının Esnek Hale Getirilmesi (Backend)

**Sorun:** Production'da hem `domain.com` hem de `www.domain.com` üzerinden istek gelebilir.

**Çözüm:**
- `config.py` içinde `cors_origins_list` property zaten mevcut
- Bu property `cors_origins` string'ini virgülle ayırarak liste yapıyor
- `main.py` içinde `settings.cors_origins_list` kullanılıyor

**Kullanım:**
Railway'de backend servisinin "Variables" sekmesine şunu ekleyin:
```
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

**Dosyalar:**
- `backend/config.py` - `cors_origins_list` property (zaten mevcuttu)
- `backend/main.py` - CORS middleware'de kullanılıyor

---

### 3. Next.js Build Süreci ve API URL Yönetimi (Frontend)

**Sorun:** Next.js `NEXT_PUBLIC_*` değişkenlerini build-time'da koda gömer. Railway'de değişken değiştirilse bile rebuild gerekir.

**Çözüm:**
- `frontend/src/lib/runtime-config.ts` dosyası oluşturuldu
- API URL merkezi bir yerden yönetiliyor
- Build-time ve runtime'da validation ve log mekanizması eklendi
- `next.config.js` içinde build-time validation eklendi
- Production'da fallback URL kullanılırsa uyarı veriliyor

**Kullanım:**
Railway'de frontend servisinin "Variables" sekmesine şunu ekleyin:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**ÖNEMLİ:** `NEXT_PUBLIC_API_URL` değiştirildiğinde frontend'i **mutlaka yeniden deploy** etmeniz gerekir!

**Dosyalar:**
- `frontend/src/lib/runtime-config.ts` - Merkezi API URL yönetimi
- `frontend/src/lib/api.ts` - Runtime config kullanıyor
- `frontend/src/lib/firebase-api.ts` - Runtime config kullanıyor
- `frontend/next.config.js` - Build-time validation

---

### 4. Database Bağlantı Sağlamlığı (Backend)

**Sorun:** Railway PostgreSQL bağlantıları bazen uyku moduna geçebilir veya kısa süreli kopmalar yaşayabilir.

**Çözüm:**
- `database.py` içinde SQLAlchemy engine'e connection pool ayarları eklendi:
  - `pool_pre_ping=True` - Bağlantı kullanılmadan önce canlılık kontrolü yapar
  - `pool_size=5` - 5 bağlantı tutar
  - `max_overflow=10` - Ekstra 10 bağlantıya izin verir
  - `pool_timeout=30` - 30 saniye bekler
  - `pool_recycle=3600` - 1 saat sonra bağlantıları yeniler

**Dosyalar:**
- `backend/database.py` - Connection pool ayarları

---

## 📋 Railway Deployment Checklist

### Backend Servisi

- [ ] Root Directory: `backend` ayarlandı
- [ ] Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT` eklendi
- [ ] `DATABASE_URL` eklendi (PostgreSQL'den)
- [ ] `GOOGLE_APPLICATION_CREDENTIALS_JSON` eklendi (JSON içeriği)
- [ ] `GOOGLE_CLOUD_PROJECT` eklendi
- [ ] `GCS_BUCKET_NAME` eklendi
- [ ] `GEMINI_API_KEY` eklendi
- [ ] `JWT_SECRET` eklendi (güçlü şifre)
- [ ] `CORS_ORIGINS` eklendi (domain'ler virgülle ayrılmış)

### Frontend Servisi

- [ ] Root Directory: `frontend` ayarlandı
- [ ] `NEXT_PUBLIC_API_URL` eklendi (backend URL'i)
- [ ] Domain bağlandıktan sonra `NEXT_PUBLIC_API_URL` güncellendi ve **redeploy** yapıldı

---

## 🔍 Debugging İpuçları

### Backend Logları

Railway'de backend servisinin "Logs" sekmesine bakın:
- Google Cloud credentials başarıyla yüklendi mi?
- Database bağlantısı başarılı mı?
- CORS origins doğru mu?

### Frontend Logları

Browser console'da kontrol edin:
- API URL doğru mu? (`🌐 Frontend API URL:`)
- Fallback URL kullanılıyor mu? (Production'da uyarı verir)

### Database Bağlantı Sorunları

Eğer database bağlantı hataları görüyorsanız:
- `DATABASE_URL` doğru mu?
- PostgreSQL servisi çalışıyor mu?
- Connection pool ayarları yeterli mi?

---

## 🚀 Sonraki Adımlar

1. Tüm değişiklikleri GitHub'a push edin
2. Railway'de backend servisini redeploy edin
3. Railway'de frontend servisini redeploy edin
4. Logları kontrol edin
5. Health check endpoint'ini test edin: `https://api.yourdomain.com/health`

---

## 📝 Notlar

- **Google Cloud Credentials:** Railway'de environment variable olarak saklanıyor, güvenli geçici dosya kullanılıyor
- **CORS:** Virgülle ayrılmış liste destekleniyor, hem domain hem www.domain çalışır
- **API URL:** Frontend rebuild gerektirir, değişken değiştirildiğinde redeploy yapın
- **Database:** Connection pool ayarları Railway'in uyku moduna karşı koruma sağlıyor

---

**Başarılar! 🎉**
