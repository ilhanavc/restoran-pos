/**
 * CID 812 / USB-serial caller ID — StoreBridge süreci içinde çalışır.
 * Protokol net değilse yalnızca ham satır loglanır; POST yalnızca CID812_PHONE_REGEX ile
 * üretici formatı tanımlandığında veya manuel test çağrısında yapılır.
 */

function parityOption(p) {
  const x = String(p || 'none').toLowerCase();
  if (x === 'even' || x === 'odd' || x === 'none') return x;
  return 'none';
}

function digitsKey(s) {
  return String(s || '').replace(/\D/g, '');
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
    this._port = null;
    this._buf = Buffer.alloc(0);
    this._debounce = { key: '', at: 0 };
    /** @type {RegExp | null} */
    this._phoneRegex = null;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._stopped = false;

    if (!this.cfg.cid812Enabled) {
      this.log.log?.('[cid812] devre dışı (CID812_ENABLED=0 veya false)');
      return;
    }

    if (!this.cfg.cid812Port) {
      this.log.warn?.('[cid812] CID812_PORT boş — seri port açılmadı');
      return;
    }

    const reStr = this.cfg.cid812PhoneRegex;
    if (reStr && String(reStr).trim()) {
      try {
        this._phoneRegex = new RegExp(String(reStr).trim());
      } catch (e) {
        this.log.error?.('[cid812] CID812_PHONE_REGEX geçersiz — sadece ham log modu:', e?.message || e);
        this._phoneRegex = null;
      }
    }

    this._openSerial().catch((e) => {
      this.log.error?.('[cid812] seri port açılamadı:', e?.message || e);
    });
  }

  async _openSerial() {
    let SerialPort;
    try {
      ({ SerialPort } = await import('serialport'));
    } catch (e) {
      this.log.error?.('[cid812] serialport paketi yok veya yüklenemedi:', e?.message || e);
      return;
    }

    if (this._stopped) return;

    const path = this.cfg.cid812Port;
    const baudRate = this.cfg.cid812BaudRate ?? 9600;
    const dataBits = this.cfg.cid812DataBits ?? 8;
    const stopBits = this.cfg.cid812StopBits ?? 1;
    const parity = parityOption(this.cfg.cid812Parity);

    this.log.log?.(`[cid812] port açılıyor path=${path} baud=${baudRate} ${dataBits}${parity[0].toUpperCase()}${stopBits}`);

    this._port = new SerialPort({
      path,
      baudRate,
      dataBits,
      stopBits,
      parity,
      autoOpen: true,
    });

    this._port.on('open', () => {
      this.log.log?.('[cid812] port açık — ham satırlar loglanacak; POST için CID812_PHONE_REGEX veya API testi kullanın');
    });

    this._port.on('error', (err) => {
      if (!this._stopped) this.log.error?.('[cid812] port hatası:', err?.message || err);
    });

    this._port.on('data', (chunk) => {
      if (this._stopped) return;
      if (this.cfg.cid812LogHex) {
        this.log.log?.(`[cid812][hex] ${Buffer.from(chunk).toString('hex')}`);
      }
      this._appendChunk(chunk);
    });
  }

  /**
   * @param {Buffer} chunk
   */
  _appendChunk(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    const max = 65536;
    if (this._buf.length > max) {
      this._buf = this._buf.subarray(this._buf.length - max);
    }

    let nl;
    while ((nl = this._buf.indexOf(0x0a)) >= 0) {
      const lineBuf = this._buf.subarray(0, nl);
      this._buf = this._buf.subarray(nl + 1);
      let line = lineBuf.toString('utf8');
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this._handleLine(line);
    }
  }

  /**
   * @param {string} line
   */
  _handleLine(line) {
    const safe = line.length > 2000 ? `${line.slice(0, 2000)}…` : line;
    this.log.log?.(`[cid812][raw] ${JSON.stringify(safe)}`);

    if (!this._phoneRegex || !this.api?.postCallerIdIncoming) return;

    const m = line.match(this._phoneRegex);
    if (!m || m[1] == null) return;

    const phone = String(m[1]).trim();
    if (!phone) return;

    const key = digitsKey(phone);
    if (!key || key.length < 10) return;

    const debounceMs = this.cfg.cid812DebounceMs ?? 3500;
    const now = Date.now();
    if (key === this._debounce.key && now - this._debounce.at < debounceMs) {
      this.log.log?.('[cid812] debounce — aynı numara kısa sürede tekrarlandı, atlandı');
      return;
    }
    this._debounce = { key, at: now };

    this._postIncoming(phone, line).catch((e) => {
      this.log.error?.('[cid812] API POST hatası:', e?.message || e);
    });
  }

  /**
   * @param {string} phone
   * @param {string} rawLine
   */
  async _postIncoming(phone, rawLine) {
    await this.api.postCallerIdIncoming({
      phone,
      raw_payload: { line: rawLine, source: 'cid812' },
      source_type: 'cid812',
    });
    this.log.log?.(`[cid812] gönderildi: ${phone}`);
  }

  /**
   * Manuel test: doğrudan backend’e numara gönder (cihaz olmadan).
   * @param {string} phone
   */
  async submitTestPhone(phone) {
    if (!this.api?.postCallerIdIncoming) throw new Error('api yok');
    await this.api.postCallerIdIncoming({
      phone: String(phone),
      raw_payload: { test: true },
      source_type: 'cid812_test',
    });
  }

  stop() {
    this._stopped = true;
    try {
      if (this._port) {
        if (this._port.isOpen) {
          this._port.close((err) => {
            if (err) this.log.error?.('[cid812] kapanırken:', err?.message || err);
          });
        }
        this._port = null;
      }
    } catch (e) {
      this.log.error?.('[cid812] stop:', e?.message || e);
    }
    this._buf = Buffer.alloc(0);
  }

  get started() {
    return this._started;
  }
}
