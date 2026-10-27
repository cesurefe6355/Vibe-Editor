# Ortak IDE — ilk çalışan sürüm

Monaco Editor + Yjs ile HTML, CSS ve JavaScript için gerçek zamanlı ortak kod editörü.

## Gereksinimler

- Node.js 20 veya üzeri
- npm
- İnternetten erişim için Node.js uygulaması çalıştırabilen bir hosting (Render, Railway veya VPS gibi)

## Bilgisayarda çalıştırma

```bash
npm install
npm run dev
```

Arayüz `http://localhost:5173` adresinde açılır. Geliştirme sunucusu ve WebSocket eşzamanlama sunucusu birlikte çalışır. Test etmek için bağlantıyı iki farklı tarayıcı penceresinde açın ve **Davet bağlantısı** düğmesiyle aynı oda bağlantısını diğerine kopyalayın.

## Üretim sürümü

```bash
npm install
npm run build
npm start
```

`NODE_ENV=production` ayarıyla sunucu `dist` klasörünü sunar ve aynı portta `/sync` WebSocket bağlantılarını kabul eder. Hosting sağlayıcısının `PORT` ortam değişkeni otomatik kullanılır.

## Render üzerinde yayınlama

1. Bu klasörü bir GitHub deposuna yükleyin.
2. Render'da **New → Web Service** ile depoyu bağlayın.
3. Build Command: `npm install && npm run build`
4. Start Command: `npm start`
5. Environment: `NODE_ENV=production`
6. Deploy tamamlanınca oluşan HTTPS adresini açın. WebSocket bağlantısı otomatik olarak `wss://` kullanır.

Ücretsiz hosting planları uykuya geçebilir veya kalıcı disk sunmayabilir. Bu ilk sürümde oda içerikleri sunucu belleğinde tutulur; sunucu yeniden başlarsa içerik kaybolabilir. Kalıcı kayıt bir sonraki aşamada eklenmelidir.

## Önemli güvenlik sınırı

Bu, geliştirme amaçlı bir MVP'dir. Oda bağlantısına sahip herkes odaya katılabilir ve kodu değiştirebilir. Kimlik doğrulama, oda sahibi izinleri, hız sınırı, kalıcı depolama ve kötüye kullanım koruması henüz yoktur. Gizli/özel kod paylaşmayın. Gerçek kullanım öncesinde bu kontrolleri ekleyin.

Önizleme, HTML/JS kodunu `sandbox="allow-scripts"` ile sınırlandırılmış bir iframe içinde çalıştırır. Bu bir güvenlik katmanıdır, ancak tek başına tam bir güvenlik garantisi değildir.
