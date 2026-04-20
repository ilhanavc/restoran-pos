# Sentry Kurulum Runbook

> FAZ 0 — Görev 0.7 kapsamındaki Sentry entegrasyonunu aktive etmek için operatör adım rehberi.
> Hedef: Backend + Frontend hatalarını Sentry'ye yollamak, source map ile okunabilir stack, session replay ile hata anında kullanıcı akışı.

---

## 0. Ön Koşullar

- Kod tarafı hazır: `@sentry/node`, `@sentry/react`, `@sentry/vite-plugin` bağımlı.
- Kod DSN **olmadan** da sorunsuz çalışır — `SENTRY_DSN` / `VITE_SENTRY_DSN` boşsa Sentry init atlanır, uygulama kırılmaz.
- Bu runbook adımları DSN alıp aktive etmek içindir.

---

## 1. Sentry Hesabı Aç

1. https://sentry.io/signup/ adresine git.
2. **Ücretsiz plan** yeterli: 5.000 error + 10.000 performance + 50 replay / ay.
3. E-posta ile kayıt ol (ör. `ilhanavci499@gmail.com`).
4. E-posta doğrulama linkine tıkla.
5. Organization adı: `ilhan-restoran-pos` (veya tercih ettiğin ad) → **Create Organization**.

---

## 2. Backend Projesi Oluştur

1. Sentry dashboard → sol menü **Projects** → **Create Project**.
2. **Platform**: Node.js.
3. **Project name**: `restoran-pos-backend`.
4. **Team**: default team seç.
5. **Create Project** tıkla.
6. Açılan ekranda **DSN** değerini kopyala:
   ```
   https://<hash>@o<org-id>.ingest.sentry.io/<project-id>
   ```
   Bu değer: `SENTRY_DSN` (server/.env).

---

## 3. Frontend Projesi Oluştur

1. **Projects** → **Create Project**.
2. **Platform**: React.
3. **Project name**: `restoran-pos-client`.
4. **Create Project** tıkla.
5. DSN değerini kopyala → bu `VITE_SENTRY_DSN` (root .env veya build env).

---

## 4. Auth Token (Source Map Upload İçin)

Source map upload olmadan prod stack trace okunmaz. Auth token olmadan build kırılmaz, sadece source map atlanır.

1. Sentry dashboard → sağ üst profil → **Settings** → **Account** → **API** → **Auth Tokens**.
2. **Create New Token** tıkla.
3. **Name**: `restoran-pos-source-map-upload`.
4. **Scopes**: aşağıdakileri işaretle:
   - `project:releases`
   - `org:read`
5. **Create Token** → değeri kopyala (sadece bir kez gösterilir).
6. Bu değer: `SENTRY_AUTH_TOKEN` (client build env).

---

## 5. Organization + Project Slug'ları

`@sentry/vite-plugin` source map upload için org + project slug ister. Sentry URL'den oku:

- URL: `https://<org-slug>.sentry.io/projects/<project-slug>/`
- Örnek: `https://ilhan-restoran-pos.sentry.io/projects/restoran-pos-client/`
  - `SENTRY_ORG` = `ilhan-restoran-pos`
  - `SENTRY_PROJECT` = `restoran-pos-client`

---

## 6. Env Değerlerini Yerleştir

### 6.1 Backend (`server/.env`)

```env
SENTRY_DSN=https://<backend-hash>@o<id>.ingest.sentry.io/<project-id>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
SENTRY_RELEASE=restoran-pos@1.0.9
```

### 6.2 Frontend (`.env` — proje kökü, Vite tarafından okunur)

```env
VITE_SENTRY_DSN=https://<frontend-hash>@o<id>.ingest.sentry.io/<project-id>
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1.0
VITE_SENTRY_RELEASE=restoran-pos@1.0.9
```

### 6.3 Build-time (client source map upload — sadece build makinesinde)

```env
SENTRY_AUTH_TOKEN=<auth-token>
SENTRY_ORG=ilhan-restoran-pos
SENTRY_PROJECT=restoran-pos-client
```

> ⚠️ `SENTRY_AUTH_TOKEN` **asla** client JS bundle'ına girmez — sadece `vite build` sırasında Node process'i okur.

---

## 7. Dosya Gitignore Kontrolü

`.env` ve varyasyonları git'te OLMAMALI. `.gitignore` içinde şunlar olmalı (zaten var):

```
.env
.env.local
.env.production
server/.env
```

Kontrol:
```bash
git check-ignore -v .env server/.env
```

---

## 8. Doğrulama — Backend

### 8.1 DSN Set, Restart

```bash
# server/.env içinde SENTRY_DSN doluyken
npm run dev
```

Log'da şunu görmelisin:
```
{"ts":"...","level":"info","msg":"Sentry initialized","dsn":"https://***"}
```

(DSN değeri redact edilmiş görünmeli.)

### 8.2 Test Hatası Gönder

Geliştirme sırasında bir endpoint'te bilerek `throw new Error('sentry-test')` at, endpoint'i çağır. Sentry dashboard → **Issues** listesinde 10-30 sn içinde görünmeli.

### 8.3 Redact Doğrulaması

Hata payload'ında **Authorization header** ve **password** alanları `***` olarak görünmeli. Sentry Issue detay → **Headers** sekmesi kontrol et.

---

## 9. Doğrulama — Frontend

### 9.1 DSN Set, Restart

```bash
# .env içinde VITE_SENTRY_DSN doluyken
npm run dev
```

Browser console'da:
```
[Sentry] initialized (env=development)
```

(DSN yoksa `[Sentry] disabled (no DSN)` yazar — kırılma yok.)

### 9.2 Test Hatası

Browser console:
```js
throw new Error('frontend-sentry-test');
```

Sentry dashboard → `restoran-pos-client` → **Issues** listesinde görünmeli.

### 9.3 Session Replay Doğrulaması

Hatalı bir akış deniyerek (örn. boş form submit) hata tetikle. Sentry Issue detay → **Replays** sekmesinde video benzeri DOM snapshot dizisi olmalı. Input değerlerinin `*` ile maskelendiğini doğrula.

---

## 10. Doğrulama — Source Map Upload

```bash
npm run build
```

Build log'unda:
```
[sentry-vite-plugin] Successfully uploaded source maps to Sentry
```

Prod build'de oluşan bir hatada stack trace:
- Önceden: `at a.b.c (index-abc123.js:1:45672)`
- Şimdi: `at TablesScreen.handleClick (src/components/tables/TablesScreen.jsx:142)`

Auth token yoksa build log'unda:
```
[sentry-vite-plugin] SENTRY_AUTH_TOKEN not set — source map upload skipped
```
(Build kırılmaz.)

---

## 11. Prod Deploy'da Dikkat

- `.env` prod makinede ayrı tutulur, git'e girmez.
- `SENTRY_RELEASE` her release'de güncellensin (ör. CI pipeline'da `package.json` version'ı oku).
- `SENTRY_AUTH_TOKEN` sadece CI/CD runner'da olsun, hiçbir developer makinesinde olmak zorunda değil.
- Rate limiting: Sentry ücretsiz plan ayda 5K hata — sürekli 500 üreten bir bug varsa kota dolabilir. Issue'ları düzelt, eskiyi resolve et.

---

## 12. Geri Alma (Sentry'yi Kapat)

`.env` dosyalarından `SENTRY_DSN` / `VITE_SENTRY_DSN` satırlarını sil veya boşalt → restart. Kod otomatik no-op moduna düşer. Hiçbir kod değişikliği gerekmez.
