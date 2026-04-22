# 🚀 Railway Environment Variables Checklist

Bu dosya, Railway deployment için gerekli tüm environment variable'ları listeler.

## Backend Servisi (QUICKYEL)

### Database
```
DATABASE_URL=<Railway PostgreSQL servisinden otomatik olarak alınır>
```
**Not:** Railway otomatik olarak `DATABASE_URL` değişkenini oluşturur. PostgreSQL servisinin "Variables" sekmesinden kopyalayın.

### Google Cloud
```
GOOGLE_APPLICATION_CREDENTIALS_JSON=<google-cloud-vision-key.json dosyasının TÜM içeriği>
GOOGLE_CLOUD_PROJECT=muhtar-5ab9b
GCS_BUCKET_NAME=quickyel-receipts
GEMINI_API_KEY=AIzaSyAkpM2NjfcmgemxW8LHFJz8FM0nxELWMfQ
GEMINI_MODEL=gemini-2.5-flash
```

### Security
```
JWT_SECRET=<güçlü-32-karakter-şifre-buraya>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

### CORS (ÖNEMLİ!)
```
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,https://api.yourdomain.com
```
**⚠️ ÖNEMLİ:** Production domain'lerinizi mutlaka ekleyin! Sadece `localhost` yeterli değil.

### App Settings
```
DEBUG=false
VISION_MONTHLY_LIMIT=1000
```

---

## Frontend Servisi (poetic-luck veya frontend)

### API URL
```
NEXT_PUBLIC_API_URL=https://your-backend-url.railway.app
```
**Not:** Domain bağlandıktan sonra bunu güncelleyin:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**⚠️ ÖNEMLİ:** `NEXT_PUBLIC_API_URL` değiştirildiğinde frontend'i **mutlaka yeniden deploy** edin!

---

## Kontrol Listesi

### Backend
- [ ] `DATABASE_URL` eklendi (PostgreSQL'den)
- [ ] `GOOGLE_APPLICATION_CREDENTIALS_JSON` eklendi (JSON içeriği)
- [ ] `GOOGLE_CLOUD_PROJECT` eklendi
- [ ] `GCS_BUCKET_NAME` eklendi
- [ ] `GEMINI_API_KEY` eklendi
- [ ] `JWT_SECRET` eklendi (güçlü şifre)
- [ ] `CORS_ORIGINS` eklendi (**production domain'leri ile!**)
- [ ] `DEBUG=false` ayarlandı

### Frontend
- [ ] `NEXT_PUBLIC_API_URL` eklendi (backend URL'i)
- [ ] Domain bağlandıktan sonra `NEXT_PUBLIC_API_URL` güncellendi
- [ ] Frontend yeniden deploy edildi (URL değişikliğinden sonra)

---

## Sorun Giderme

### Database Connection Refused
- `DATABASE_URL`'in doğru olduğundan emin olun
- PostgreSQL servisinin çalıştığını kontrol edin
- SSL ayarları otomatik olarak yapılandırılmıştır

### CORS Hatası
- `CORS_ORIGINS` değişkeninde production domain'lerinizin olduğundan emin olun
- Domain'leri virgülle ayırın: `https://domain1.com,https://domain2.com`

### Frontend "next: not found"
- Root Directory: `frontend` olarak ayarlandığından emin olun
- Start Command: `npm run start` olarak ayarlandığından emin olun

---

**Başarılar! 🚀**
