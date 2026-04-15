# 10 - Code Quality Hardening Raporu

Tarih: 2026-04-15  
Rol: Senior Code Quality Task Force  
Kapsam: Tekrarlayan kalite sorunlarının giderilmesi — guard strengthening, error context, test coverage.

---

## 1. Yönetici Özeti

| Metrik | Değer |
|--------|-------|
| İncelenen bileşen | 3 (admin.js, orders.js, tables.js) |
| Guard iyileştirmesi (G) | 3 |
| Loglama iyileştirmesi (L) | 2 |
| Yeni test | 5 (toplam 285'e yükseldi) |
| Regresyon | Yok — 285/285 test geçiyor |

---

## 2. Uygulanan İyileştirmeler

### G-1 — Şifre Minimum Uzunluk Guard (`admin.js`)

**Problem:** `PATCH /api/admin/users/:id` boş string veya 1–3 karakterlik şifre kabul ediyor, `bcryptjs.hashSync('')` ile boş hash üretiyordu.

**Düzeltme:**
```javascript
if (password !== undefined && password !== null) {
  const pwStr = String(password).trim();
  if (pwStr.length > 0 && pwStr.length < 4) {
    return res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır' });
  }
}
const hash = password && String(password).trim().length > 0
  ? bcryptjs.hashSync(String(password).trim(), 10) : null;
```

**Test coverage:** 4 test eklendi (`adminPrinters.integration.test.js`):
- 3 karakter → 400
- 1 karakter → 400
- 4 karakter (sınırda) → 200
- şifre gönderilmezse mevcut hash korunur → 200

---

### G-2 — Takeaway + `table_id` Çakışma Guard (`orders.js`)

**Problem:** `POST /api/orders` paket siparişte `table_id` gönderilirse siparişe bağlanıyor, beklenen davranış değil.

**Düzeltme:**
```javascript
const resolvedType = order_type || 'dine_in';
if (resolvedType === 'takeaway' && table_id) {
  return res.status(400).json({ error: 'Paket siparişlerde masa kimliği (table_id) gönderilemez' });
}
```

**Test coverage:** 1 test eklendi (`orders.integration.test.js`):
- takeaway + table_id → 400, hata mesajı `table_id` içeriyor

---

### G-3 — Transfer Zod Schema (`tables.js`)

**Problem:** `POST /api/tables/:id/transfer` manuel `if (!targetTableId)` kontrolü ile Zod dışında ek bir validation katmanı oluşturuyordu.

**Düzeltme:** Zod schema tanımlandı, manuel kontrol kaldırıldı:
```javascript
const transferTableSchema = {
  body: z.object({
    targetTableId: z.string().min(1, 'Hedef masa kimliği gerekli'),
  }),
};
router.post('/:id/transfer', tableStaff, validate(transferTableSchema), ...);
```

**Test coverage:** Mevcut test (`targetTableId olmadan 400 döner`) G-3 guard'ını zaten kapsıyor.

---

### L-1 — `console.error` Context Etiketleri (`admin.js`)

**Problem:** `admin.js` içindeki 25 bare `console.error(err)` çağrısı hangi route veya işlemin hata ürettiğini log dosyasında göstermiyordu. Alan teşhisini zorlaştırıyor.

**Düzeltme:** Tüm çağrılara `[admin:route:action]` formatında etiket eklendi. Örnekler:
```javascript
console.error('[admin:business:get]', err);
console.error('[admin:printers:create]', err);
console.error('[admin:users:update]', err);
console.error('[admin:print-jobs:retry]', err);
```

25 ayrı etiket, route/action bazlı — toplamda admin.js içindeki tüm `catch` blokları kapsanıyor.

---

### L-2 — Test Coverage for G-1, G-2 Guards

Yukarıda G-1 ve G-2 başlıklarında detaylı listelenmiştir. Toplam 5 yeni test.

---

## 3. Değiştirilen Dosyalar

| Dosya | Değişiklik | Tür |
|-------|-----------|-----|
| `server/routes/admin.js` | G-1 şifre guard + 25 console.error etiketi | Güncellendi |
| `server/routes/orders.js` | G-2 takeaway+table_id guard | Güncellendi |
| `server/routes/tables.js` | G-3 transferTableSchema Zod + validate() | Güncellendi |
| `server/tests/integration/adminPrinters.integration.test.js` | G-1 için 4 test | Güncellendi |
| `server/tests/integration/orders.integration.test.js` | G-2 için 1 test | Güncellendi |

---

## 4. Doğrulama

```
npm test
```

```
Test Files  20 passed (20)
     Tests  285 passed (285)
  Duration  ~6s
```

280 → **285 test**. Regresyon yok.

---

## 5. Korunan Yapılar

- `isBadRequest` paterni dokunulmadı — domain validation hataları intentional
- ESLint CI gate (`npm run lint:ci`) hâlâ `--max-warnings 27` sınırında geçiyor
- Tüm mevcut Zod schema'ları korundu

---

*Son güncelleme: Nisan 2026 — Restoran POS v1.0.9*
