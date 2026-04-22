# 🚀 QuickYel Domain'e Yükleme Rehberi (Railway.app)

Bu rehber, projenizi en kolay ve ucuz şekilde kendi domain'inize yüklemeniz için hazırlanmıştır.

## 📋 İçindekiler
1. [Railway.app Hesabı Oluşturma](#1-railwayapp-hesabı-oluşturma)
2. [PostgreSQL Veritabanı Kurulumu](#2-postgresql-veritabanı-kurulumu)
3. [Backend Servisi Kurulumu](#3-backend-servisi-kurulumu)
4. [Frontend Servisi Kurulumu](#4-frontend-servisi-kurulumu)
5. [Environment Variables Ayarlama](#5-environment-variables-ayarlama)
6. [Domain Bağlama](#6-domain-bağlama)
7. [Google Cloud Credentials Ayarlama](#7-google-cloud-credentials-ayarlama)

---

## 1. Railway.app Hesabı Oluşturma

1. **Railway.app'e git**: https://railway.app
2. **"Start a New Project"** butonuna tıkla
3. **GitHub hesabınla giriş yap** (en kolay yöntem)
4. Railway otomatik olarak GitHub reposunu görecek

> 💡 **Not**: Eğer projen GitHub'da değilse, önce GitHub'a push etmen gerekiyor.

---

## 2. PostgreSQL Veritabanı Kurulumu

1. Railway dashboard'da **"New"** butonuna tıkla
2. **"Database"** seçeneğini seç
3. **"Add PostgreSQL"** seçeneğini tıkla
4. Railway otomatik olarak PostgreSQL servisi oluşturacak
5. **"Variables"** sekmesine git ve **`DATABASE_URL`** değişkenini kopyala
   - Bu değişkeni backend için kullanacağız

---

## 3. Backend Servisi Kurulumu

1. Railway dashboard'da **"New"** butonuna tıkla
2. **"GitHub Repo"** seçeneğini seç
3. QuickYel repository'ni seç
4. Railway otomatik olarak projeyi algılayacak
5. **"Settings"** sekmesine git:
   - **Root Directory**: `backend` olarak ayarla
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Railway otomatik olarak port'u ayarlayacak

### Backend için Environment Variables

**"Variables"** sekmesine git ve şu değişkenleri ekle:

```
DATABASE_URL=<PostgreSQL'den kopyaladığın URL>
GOOGLE_CLOUD_PROJECT=muhtar-5ab9b
GCS_BUCKET_NAME=quickyel-receipts
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=AIzaSyAkpM2NjfcmgemxW8LHFJz8FM0nxELWMfQ
JWT_SECRET=<güçlü-bir-şifre-buraya>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
DEBUG=false
VISION_MONTHLY_LIMIT=1000
```

> ⚠️ **ÖNEMLİ**: `JWT_SECRET` için güçlü bir şifre oluştur (en az 32 karakter)

### Google Cloud Credentials

Google Cloud credentials dosyasını Railway'e eklemek için:

1. **"Variables"** sekmesine git
2. **"New Variable"** butonuna tıkla
3. **Name**: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
4. **Value**: `google-cloud-vision-key.json` dosyasının içeriğini buraya yapıştır (tüm JSON içeriği)
5. Backend kodunu güncellememiz gerekecek (aşağıda açıklanacak)

---

## 4. Frontend Servisi Kurulumu

1. Railway dashboard'da tekrar **"New"** butonuna tıkla
2. **"GitHub Repo"** seçeneğini seç
3. Aynı QuickYel repository'ni seç
4. **"Settings"** sekmesine git:
   - **Root Directory**: `frontend` olarak ayarla
   - Railway Next.js'i otomatik algılayacak

### Frontend için Environment Variables

**"Variables"** sekmesine git ve şu değişkeni ekle:

```
NEXT_PUBLIC_API_URL=https://your-backend-url.railway.app
```

> 💡 Backend URL'ini Railway backend servisinin **"Settings"** > **"Domains"** bölümünden alabilirsin.

---

## 5. Environment Variables Ayarlama

### Backend Variables (Tam Liste)

Railway backend servisinin **"Variables"** sekmesinde şunlar olmalı:

| Değişken | Değer | Açıklama |
|----------|-------|----------|
| `DATABASE_URL` | PostgreSQL URL'i | Railway PostgreSQL'den otomatik |
| `GOOGLE_CLOUD_PROJECT` | `muhtar-5ab9b` | Google Cloud proje adı |
| `GCS_BUCKET_NAME` | `quickyel-receipts` | Google Cloud Storage bucket |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model adı |
| `GEMINI_API_KEY` | API anahtarın | Gemini API anahtarı |
| `JWT_SECRET` | Güçlü şifre | En az 32 karakter |
| `JWT_ALGORITHM` | `HS256` | JWT algoritması |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Token geçerlilik süresi |
| `CORS_ORIGINS` | Domain URL'leri | Frontend domain'leri (virgülle ayrılmış) |
| `DEBUG` | `false` | Production için false |
| `VISION_MONTHLY_LIMIT` | `1000` | Aylık OCR limiti |

### Frontend Variables

| Değişken | Değer | Açıklama |
|----------|-------|----------|
| `NEXT_PUBLIC_API_URL` | Backend URL'i | Railway backend URL'i |

---

## 6. Domain Bağlama

### Backend Domain

1. Backend servisinin **"Settings"** sekmesine git
2. **"Domains"** bölümüne git
3. **"Custom Domain"** butonuna tıkla
4. Domain'ini gir (örn: `api.yourdomain.com`)
5. Railway sana DNS kayıtlarını verecek
6. Domain sağlayıcına (Namecheap, GoDaddy, vs.) gidip bu DNS kayıtlarını ekle

### Frontend Domain

1. Frontend servisinin **"Settings"** sekmesine git
2. **"Domains"** bölümüne git
3. **"Custom Domain"** butonuna tıkla
4. Ana domain'ini gir (örn: `yourdomain.com` veya `www.yourdomain.com`)
5. DNS kayıtlarını domain sağlayıcına ekle

### DNS Kayıtları Örneği

Railway sana şöyle bir kayıt verecek:
```
Type: CNAME
Name: api (veya @ veya www)
Value: xxxxx.up.railway.app
```

Domain sağlayıcında bu kaydı ekle. DNS yayılması 5-60 dakika sürebilir.

---

## 7. Google Cloud Credentials Ayarlama

Railway'de dosya sistemi olmadığı için Google Cloud credentials'ı environment variable olarak eklememiz gerekiyor.

### Adım 1: Credentials Dosyasını Hazırla

1. `backend/google-cloud-vision-key.json` dosyasını aç
2. Tüm içeriğini kopyala (JSON formatında)

### Adım 2: Railway'e Ekle

1. Backend servisinin **"Variables"** sekmesine git
2. **"New Variable"** butonuna tıkla
3. **Name**: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
4. **Value**: JSON içeriğini yapıştır
5. **"Add"** butonuna tıkla

### Adım 3: Backend Kodunu Güncelle

Backend kodunu güncellememiz gerekiyor ki credentials'ı environment variable'dan okuyabilsin. Bu değişiklik yapılacak.

---

## 8. Deployment Sonrası Kontroller

### Backend Kontrolü

1. Backend URL'ine git: `https://api.yourdomain.com/health`
2. Şu cevabı görmelisin:
```json
{
  "status": "healthy",
  "project": "muhtar-5ab9b"
}
```

### Frontend Kontrolü

1. Frontend URL'ine git: `https://yourdomain.com`
2. Uygulama açılmalı

### Database Kontrolü

1. Railway PostgreSQL servisinin **"Data"** sekmesine git
2. Tabloların oluştuğunu kontrol et

---

## 💰 Maliyet Tahmini

### Railway.app Ücretsiz Tier
- **$5 kredi/ay** ücretsiz
- Küçük projeler için yeterli
- Aylık kullanım:
  - Backend: ~$2-3
  - Frontend: ~$1-2
  - PostgreSQL: ~$1-2

### Google Cloud (Mevcut)
- Vision API: İlk 1000 istek/ay ücretsiz
- Gemini: Ücretsiz tier mevcut
- Cloud Storage: 5GB ücretsiz

**Toplam**: İlk aylarda neredeyse ücretsiz! 🎉

---

## 🔧 Sorun Giderme

### Backend Başlamıyor

1. **Logs** sekmesine git ve hataları kontrol et
2. Environment variables'ın doğru olduğundan emin ol
3. `DATABASE_URL`'in doğru olduğunu kontrol et

### Frontend Backend'e Bağlanamıyor

1. `NEXT_PUBLIC_API_URL`'in doğru olduğundan emin ol
2. Backend'in çalıştığını kontrol et (`/health` endpoint'i)
3. CORS ayarlarını kontrol et

### Domain Çalışmıyor

1. DNS kayıtlarının doğru olduğundan emin ol
2. DNS yayılması için 1 saat bekle
3. Railway'de domain'in "Active" olduğunu kontrol et

---

## 📞 Yardım

Sorun yaşarsan:
1. Railway dashboard'daki **"Logs"** sekmesine bak
2. Backend ve Frontend loglarını kontrol et
3. Environment variables'ı tekrar gözden geçir

---

## ✅ Checklist

Deployment öncesi kontrol listesi:

- [ ] Railway.app hesabı oluşturuldu
- [ ] GitHub repository Railway'e bağlandı
- [ ] PostgreSQL servisi oluşturuldu
- [ ] Backend servisi oluşturuldu ve ayarlandı
- [ ] Frontend servisi oluşturuldu ve ayarlandı
- [ ] Tüm environment variables eklendi
- [ ] Google Cloud credentials eklendi
- [ ] Domain'ler bağlandı
- [ ] DNS kayıtları yapıldı
- [ ] Backend health check başarılı
- [ ] Frontend çalışıyor

---

**Başarılar! 🚀**
