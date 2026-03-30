/**
 * CID 812 / HID caller ID — StoreBridge süreci içinde çalışır.
 *
 * HID protokolü net değilse "parse kapalı" modunda ham report loglar.
 * Parse ancak CID812_ENABLE_PARSE=1 veya CID812_PHONE_REGEX dolu ise "gated" olarak denenir.
 *
 * Bu dosya backend ve frontend çağrı akışını bozmaz:
 *  - numara çıkarılırsa: POST ${API_BASE}/api/bridge/caller-id/incoming
 *  - parse yoksa: sadece raw log
 */

function digitsKey(s) {
  return String(s || '').replace(/\D/g, '');
}

function normalizeHexString(v) {
  return String(v || '').trim().replace(/^0x/i, '').toUpperCase();
}

function parseHexCsvToIntList(str) {
  const raw = String(str || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => normalizeHexString(x))
    .filter(Boolean)
    .map((x) => parseInt(x, 16))
    .filter((n) => Number.isFinite(n));
}

function bytesToAsciiSafe(buf) {
  try {
    const ascii = Buffer.from(buf).toString('ascii');
    // Sadece yazdırılabilirleri bırak, kontrol karakterleri noktaya çevir.
    return ascii.replace(/[^\x20-\x7E]/g, '.');
  } catch {
    return '';
  }
}

export class Cid812Provider {
  /**
   * @param {{ api: { postCallerIdIncoming?: (b: object) => Promise<unknown> }, cfg: Record<string, unknown>, log?: Console }} options
   */
  constructor(options = {}) {
    this.api = options.api;
    this.cfg = options.cfg || {};
    this.log = options.log || console;

    this._started = false;
    this._stopped = false;

    this._device = null;
    this._deviceInfo = null;

    this._debounce = { key: '', at: 0 };
    this._phoneRegex = null;

    // Parse gated: ilk sürümde varsayılan kapalı.
    this._shouldParse = Boolean(this.cfg.cid812EnableParse) || Boolean(String(this.cfg.cid812PhoneRegex || '').trim());
    const reStr = String(this.cfg.cid812PhoneRegex || '');
    if (this._shouldParse && reStr.trim()) {
      try {
        this._phoneRegex = new RegExp(reStr.trim());
      } catch (e) {
        this.log.error?.('[cid812][hid] CID812_PHONE_REGEX geçersiz; parse kapatıldı:', e?.message || e);
        this._shouldParse = false;
        this._phoneRegex = null;
      }
    }
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._stopped = false;

    if (!this.cfg.cid812Enabled) {
      this.log.log?.('[cid812][hid] devre dışı (CID812_ENABLED=0 veya false)');
      return;
    }

    this._openHid().catch((e) => {
      this.log.error?.('[cid812][hid] start: HID açılamadı:', e?.message || e);
    });
  }

  async _openHid() {
    let HID;
    try {
      const mod = await import('node-hid');
      HID = mod.default || mod;
    } catch (e) {
      this.log.error?.('[cid812][hid] node-hid paketi yok veya yüklenemedi:', e?.message || e);
      return;
    }

    const hidVids = parseHexCsvToIntList(this.cfg.cid812HidVid);
    const hidPids = parseHexCsvToIntList(this.cfg.cid812HidPid);
    const hidSerial = String(this.cfg.cid812HidSerial || '').trim().toUpperCase();

    const devices = HID.devices ? HID.devices() : [];
    if (!Array.isArray(devices) || devices.length === 0) {
      this.log.warn?.('[cid812][hid] HID cihaz listesi boş');
      return;
    }

    const matches = devices.filter((d) => {
      const vidOk = hidVids.length ? hidVids.includes(d.vendorId) : true;
      const pidOk = hidPids.length ? hidPids.includes(d.productId) : true;
      const serialOk = hidSerial ? String(d.serialNumber || '').trim().toUpperCase() === hidSerial : true;
      return vidOk && pidOk && serialOk;
    });

    if (!matches.length) {
      this.log.warn?.(
        '[cid812][hid] eşleşen cihaz bulunamadı. vid/pid/serial filtresi: ',
        { hidVids, hidPids, hidSerial, devicesCount: devices.length },
      );
      return;
    }

    // İlk eşleşeni aç.
    const selected = matches[0];
    this._deviceInfo = {
      path: selected.path,
      vendorId: selected.vendorId,
      productId: selected.productId,
      serialNumber: selected.serialNumber,
    };

    const openPath = selected.path || '';
    this.log.log?.('[cid812][hid] cihaz açılıyor:', this._deviceInfo);

    // node-hid genelde path ile açılabiliyor; path yoksa vid/pid denenecek.
    try {
      if (openPath) this._device = new HID.HID(openPath);
      else this._device = new HID.HID(selected.vendorId, selected.productId);
    } catch (e) {
      this.log.error?.('[cid812][hid] cihaz açma hatası:', e?.message || e);
      return;
    }

    this._device.on?.('data', (data) => {
      if (this._stopped) return;
      const buf = Buffer.from(data || []);
      this._handleReport(buf);
    });

    this._device.on?.('error', (err) => {
      if (!this._stopped) this.log.error?.('[cid812][hid] device error:', err?.message || err);
    });

    this._device.on?.('close', () => {
      if (!this._stopped) this.log.warn?.('[cid812][hid] device close');
    });

    this.log.log?.('[cid812][hid] parse:', this._shouldParse ? 'AÇIK(gated)' : 'KAPALI');
  }

  _handleReport(buf) {
    const ts = new Date().toISOString();
    const hex = buf.toString('hex');
    const ascii = bytesToAsciiSafe(buf);
    const info = this._deviceInfo || {};

    // Ham log (ilk sürüm)
    const maybeTrunc = hex.length > 2000 ? `${hex.slice(0, 2000)}…` : hex;
    const asciiSnippet = ascii.length > 300 ? `${ascii.slice(0, 300)}…` : ascii;
    this.log.log?.(
      `[cid812][raw] ${ts} vid=${info.vendorId ?? '?'} pid=${info.productId ?? '?'} serial=${info.serialNumber ?? '-'} len=${buf.length} hex=${maybeTrunc} ascii=${asciiSnippet}`,
    );
    if (this.cfg.cid812LogHex) {
      this.log.log?.(`[cid812][ascii] ${ascii}`);
    }

    // Parse kapalıyken POST etmiyoruz.
    if (!this._shouldParse || !this._phoneRegex || !this.api?.postCallerIdIncoming) return;

    const m = ascii.match(this._phoneRegex);
    if (!m) return;

    const capture = m[1] != null ? m[1] : m[0];
    const phone = String(capture || '').trim();
    if (!phone) return;

    const key = digitsKey(phone);
    if (!key || key.length < 10) return;

    const debounceMs = this.cfg.cid812DebounceMs ?? 3500;
    const now = Date.now();
    if (key === this._debounce.key && now - this._debounce.at < debounceMs) {
      this.log.log?.('[cid812][hid] debounce — aynı numara kısa sürede tekrarlandı, atlandı');
      return;
    }
    this._debounce = { key, at: now };

    const rawPayload = {
      ascii,
      hex,
      report_length: buf.length,
      device: { ...info },
    };

    this._postIncoming(phone, rawPayload).catch((e) => {
      this.log.error?.('[cid812][hid] API POST hatası:', e?.message || e);
    });
  }

  async _postIncoming(phone, rawPayload) {
    await this.api.postCallerIdIncoming({
      phone,
      raw_payload: rawPayload,
      source_type: 'cid812',
    });
    this.log.log?.(`[cid812][hid] gönderildi: ${phone}`);
  }

  stop() {
    this._stopped = true;
    try {
      if (this._device) {
        try {
          this._device.close();
        } catch {
          // ignore
        }
        this._device = null;
      }
    } catch (e) {
      this.log.error?.('[cid812][hid] stop:', e?.message || e);
    }
  }

  get started() {
    return this._started;
  }
}
