# 🔄 Railway Cache Buster Rehberi

Bu rehber, Railway'de frontend build cache'ini temizlemek için `CACHEBUST` environment variable'ını nasıl kullanacağınızı açıklar.

---

## 🎯 Neden Cache Buster?

Railway bazen Docker layer cache'ini kullanarak build'i çok hızlı tamamlar (10 saniye gibi). Bu, gerçek bir build yapılmadığı anlamına gelir. `CACHEBUST` environment variable'ı ile cache'i bypass edip tam build yapabilirsiniz.

---

## 📋 Adım Adım Kurulum

### 1. Railway'de Environment Variable Ekleyin

1. Railway dashboard'da **Frontend servisine** tıklayın
2. **"Variables"** sekmesine gidin
3. **"New Variable"** butonuna tıklayın
4. **Name:** `CACHEBUST`
5. **Value:** Bugünün tarihi (örn: `2026-01-20`) veya herhangi bir benzersiz değer
6. **"Add"** butonuna tıklayın

### 2. Frontend'i Redeploy Edin

1. **"Deployments"** sekmesine gidin
2. Sağ üstteki **"..."** menüsüne tıklayın
3. **"Redeploy"** seçeneğini seçin

---

## ✅ Kontrol

Build loglarında şunları görmelisiniz:

### 1. Cache Bust Mesajı
```
Cache bust: 2026-01-20
```

### 2. API URL Mesajı
```
✅ NEXT_PUBLIC_API_URL configured: https://your-backend-url.railway.app
```

### 3. Build Süresi
- **Önceki (cache ile):** 10-15 saniye ❌
- **Şimdi (cache buster ile):** 5-8 dakika ✅

---

## 🔄 Cache'i Yeniden Temizlemek İçin

Her seferinde cache'i temizlemek için:

1. Railway'de `CACHEBUST` değişkenini bulun
2. Değerini güncelleyin (örn: `2026-01-21`)
3. Frontend'i redeploy edin

**Veya:**

1. `CACHEBUST` değişkenini silin
2. Yeni bir değer ile tekrar ekleyin
3. Frontend'i redeploy edin

---

## 📝 Notlar

- `CACHEBUST` değeri herhangi bir string olabilir
- Tarih kullanmak pratik bir yöntemdir
- Değer değiştiğinde Docker cache'i invalidate olur
- Build süresi uzar ama gerçek bir build yapılır

---

## 🎯 Beklenen Sonuçlar

✅ Build süresi: **5-8 dakika** (10 saniye değil!)  
✅ Cache kullanımı: **YOK**  
✅ API URL: **Doğru şekilde build'e gömülü**  
✅ `localhost:8000`: **Artık yok**  

---

**Başarılar! 🚀**
