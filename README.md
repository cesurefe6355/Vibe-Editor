# Vibe Editor

Tarayıcıda, birden fazla kişiyle aynı anda kod yazma. React + Monaco + Yjs, Node/Express + ws.

## Çalıştırma

```bash
npm install
npm run dev          # http://localhost:5173
```

Üretim: `npm install && npm run build && npm start` (`NODE_ENV=production`).

## Akış

1. İlk girişte **ad** ve imleç rengi seçilir (tarayıcıda saklanır).
2. Ana sayfada oda oluşturulur (isteğe bağlı parola) ya da kod/bağlantı ile odaya katılınır.
3. Çalışma alanında dosyalar ortak düzenlenir; herkesin imleci, **altında adıyla** görünür.

## Özellikler

- Dosya ağacı (klasörler `js/app.js` gibi yazılarak oluşur), sekmeler, yeni dosya / silme
- **Dosya yükleme**: düğme veya sürükle-bırak (html, css, js, json, md, txt, svg, png, jpg, gif, webp…)
- Canlı önizleme (yalıtılmış iframe, yüklenen görseller ve bağlı css/js dahil), yeniden boyutlandırılabilir
- Katılımcı listesi, kimin hangi dosyada olduğu, kaydetme ve bağlantı durumu
- Mobilde Dosyalar / Editör / Önizleme sekmeleri
- Kalıcı kayıt: odalar `DATA_DIR` klasörüne yazılır (varsayılan `./data`)
- Oda parolası (scrypt ile saklanır), hız sınırları, WebSocket origin kontrolü

## Render

Build: `npm install && npm run build` · Start: `npm start` · `NODE_ENV=production`

Ücretsiz Render planında disk geçicidir; kalıcılık için bir **Disk** bağla ve `DATA_DIR`'i
bağlama yoluna ayarla (ör. `/var/data`).

## Sınırlar

Oda sahibi/rol ayrımı, kullanıcı hesabı ve sunucu tarafı Yjs içerik doğrulaması yoktur.
Dosya başına en fazla 500 KB (metin) / 1 MB (görsel).
