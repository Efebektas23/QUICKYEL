# 🔧 Railway Troubleshooting Guide

Bu rehber, Railway deployment sırasında karşılaşılan yaygın sorunları ve çözümlerini içerir.

---

## ❌ Sorun 1: Backend - ConnectionRefusedError

### Hata Mesajı
```
ConnectionRefusedError: [Errno 111] Connection refused
```

### Neden
Backend servisi PostgreSQL veritabanına **Public (Dış) URL** üzerinden bağlanmaya çalışıyor. Railway firewall'u internal servisler arası bağlantıları engelliyor.

### Çözüm

#### Adım 1: PostgreSQL Internal URL'ini Bulun

1. Railway dashboard'da **PostgreSQL servisine** tıklayın
2. **"Variables"** sekmesine gidin
3. **`DATABASE_URL`** değişkenini bulun
4. İki tür URL göreceksiniz:
   - **Internal URL:** `postgresql://...@containers-us-west-XXX.railway.app:5432/...`
   - **Public URL:** `postgresql://...@public.containers-us-west-XXX.railway.app:5432/...`

#### Adım 2: Backend'e Internal URL'i Ekleyin

1. **Backend servisine** tıklayın
2. **"Variables"** sekmesine gidin
3. **`DATABASE_URL`** değişkenini bulun veya ekleyin
4. **PostgreSQL'den kopyaladığınız Internal URL'i** yapıştırın
5. **"Save"** butonuna tıklayın

#### Adım 3: Backend'i Redeploy Edin

1. **"Deployments"** sekmesine gidin
2. Sağ üstteki **"..."** menüsüne tıklayın
3. **"Redeploy"** seçeneğini seçin

### Kontrol

Backend loglarında şunu görmelisiniz:
```
Using PostgreSQL database (asyncpg) with SSL
PostgreSQL engine created with connection pooling
Database initialized
```

---

## ❌ Sorun 2: Frontend - "next: not found"

### Hata Mesajı
```
sh: next: not found
```

### Neden
- Build süreci başarısız olmuş olabilir
- Root Directory yanlış ayarlanmış olabilir
- `node_modules` yüklenmemiş olabilir

### Çözüm

#### Adım 1: Root Directory Kontrolü

1. Railway dashboard'da **Frontend servisine** tıklayın
2. **"Settings"** sekmesine gidin
3. **"Root Directory"** alanını kontrol edin
4. Değer **`frontend`** olmalı
5. Değilse, **`frontend`** yazın ve **"Save"** butonuna tıklayın

#### Adım 2: Build Logs Kontrolü

1. **"Deployments"** sekmesine gidin
2. Son deployment'a tıklayın
3. **"Build Logs"** sekmesine gidin
4. Şu komutların başarılı olduğunu kontrol edin:
   ```
   npm install
   npm run build
   ```

**Eğer build başarısızsa:**
- Hata mesajlarını okuyun
- Genellikle dependency sorunları veya TypeScript hataları olabilir
- Hataları düzeltip yeniden deploy edin

#### Adım 3: Start Command Kontrolü

1. **"Settings"** sekmesine gidin
2. **"Start Command"** alanını kontrol edin
3. Değer **`npm run start`** olmalı
4. Değilse, **`npm run start`** yazın ve **"Save"** butonuna tıklayın

#### Adım 4: Yeniden Deploy

1. **"Deployments"** sekmesine gidin
2. Sağ üstteki **"..."** menüsüne tıklayın
3. **"Redeploy"** seçeneğini seçin

### Kontrol

Frontend loglarında şunu görmelisiniz:
```
> quickyel-frontend@1.0.0 start
> next start

- ready started server on 0.0.0.0:3000
```

---

## ✅ Kontrol Listesi

### Backend (QUICKYEL)

- [ ] PostgreSQL servisi **Active** (yeşil) durumda
- [ ] `DATABASE_URL` değişkeni **Internal URL** kullanıyor
- [ ] `DATABASE_URL` içinde port numarası **5432**
- [ ] Backend ve PostgreSQL **aynı projede**
- [ ] Backend loglarında "Database initialized" görünüyor

### Frontend (poetic-luck)

- [ ] Root Directory: **`frontend`** olarak ayarlı
- [ ] Start Command: **`npm run start`** olarak ayarlı
- [ ] Build Logs'da `npm install` başarılı
- [ ] Build Logs'da `npm run build` başarılı
- [ ] Frontend loglarında "ready started server" görünüyor

---

## 🔍 Debug İpuçları

### Backend Connection Sorunları

1. **PostgreSQL servisinin çalıştığını kontrol edin:**
   - PostgreSQL servisinin **"Metrics"** sekmesine bakın
   - CPU ve Memory kullanımını kontrol edin

2. **DATABASE_URL formatını kontrol edin:**
   ```
   ✅ Doğru: postgresql://user:pass@containers-us-west-XXX.railway.app:5432/dbname
   ❌ Yanlış: postgresql://user:pass@public.containers-us-west-XXX.railway.app:5432/dbname
   ```

3. **SSL ayarlarını kontrol edin:**
   - Railway internal bağlantılar için SSL otomatik yapılandırılıyor
   - Loglarda "SSL: prefer" görünmelidir

### Frontend Build Sorunları

1. **Build loglarını detaylı inceleyin:**
   - TypeScript hataları
   - Missing dependencies
   - Environment variable hataları

2. **package.json'ı kontrol edin:**
   - Tüm dependencies mevcut mu?
   - Scripts doğru tanımlanmış mı?

3. **Next.js config'i kontrol edin:**
   - `next.config.js` dosyası mevcut mu?
   - Hata var mı?

---

## 📞 Yardım

Sorun devam ederse:

1. Railway dashboard'daki **"Logs"** sekmesine bakın
2. Hata mesajlarını kopyalayın
3. Build loglarını kontrol edin
4. Environment variables'ı tekrar gözden geçirin

---

**Başarılar! 🚀**
