/**
 * CID 812 / HID caller ID (deprecated experimental path).
 *
 * Aktif ve önerilen üretim akışı clipboard script + bridge endpoint'tir.
 * Bu provider yalnızca CID812_MODE=hid-experimental ise çalıştırılır.
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

function parseTraceRanges(raw) {
  const src = String(raw || '').trim();
  if (!src) return [];
  const out = [];
  for (const tokenRaw of src.split(',')) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const m = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) continue;
    out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

function formatRangeBytes(buf, start, end) {
  const slice = Array.from(buf.subarray(start, end + 1));
  const hex = slice.map((v) => v.toString(16).padStart(2, '0')).join(' ');
  const dec = slice.join(' ');
  const ascii = bytesToAsciiSafe(Buffer.from(slice));
  return { hex, dec, ascii };
}

function byteToAscii(v) {
  if (v >= 0x20 && v <= 0x7e) return String.fromCharCode(v);
  return '.';
}

function avgAt(frames, idx) {
  if (!frames.length) return 0;
  let sum = 0;
  for (const f of frames) sum += f.bytes[idx];
  return sum / frames.length;
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
    this._frameCount = 0;
    this._traceSample = [];
    this._frames = [];
    this._pendingTransitions = [];
    this._lastTransitionAtMs = 0;
    this._lastFrameBytes = null;
    this._idleScoreEma = null;
    this._currentMode = 'idleLike';

    // Parse gated: ilk sürümde varsayılan kapalı.
    this._shouldParse = Boolean(this.cfg.cid812EnableParse) || Boolean(String(this.cfg.cid812PhoneRegex || '').trim());
    this._traceMode = Boolean(this.cfg.cid812TraceMode);
    this._traceRanges = parseTraceRanges(this.cfg.cid812TraceOffsets);
    this._traceWindow = this.cfg.cid812TraceSampleWindow ?? 10;
    this._transitionMode = Boolean(this.cfg.cid812TransitionMode);
    this._transitionWindow = this.cfg.cid812TransitionWindow ?? 10;
    this._transitionMinGapMs = this.cfg.cid812TransitionMinGapMs ?? 1500;
    this._transitionTopN = this.cfg.cid812TransitionTopN ?? 12;
    this._transitionVerboseTable = Boolean(this.cfg.cid812TransitionVerboseTable);
    this._candidateMode = Boolean(this.cfg.cid812CandidateMode);
    this._candidateSummaryEvery = this.cfg.cid812CandidateSummaryEvery ?? 5;
    this._candidateTopN = this.cfg.cid812CandidateTopN ?? 8;
    this._candidateCounts = new Array(64).fill(0);
    this._candidateDeltaSums = new Array(64).fill(0);
    this._transitionReportCount = 0;
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
    if (String(this.cfg.cid812Mode || 'clipboard') !== 'hid-experimental') {
      this.log.log?.(
        '[cid812] mode=clipboard: HID provider pasif. Numarayı clipboard watcher script ile /api/bridge/caller-id/incoming endpointine gönderin.',
      );
      return;
    }
    this.log.warn?.('[cid812][hid] DEPRECATED: hid-experimental mod sadece analiz amaçlıdır.');

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
    if (this._transitionMode) {
      this.log.log?.(
        `[cid812][transition] mode=ON window=${this._transitionWindow} minGapMs=${this._transitionMinGapMs} topN=${this._transitionTopN} verbose=${this._transitionVerboseTable ? 1 : 0}`,
      );
      if (this._candidateMode) {
        this.log.log?.(
          `[cid812][candidate] mode=ON summaryEvery=${this._candidateSummaryEvery} topN=${this._candidateTopN}`,
        );
      }
    }
  }

  _handleReport(buf) {
    this._frameCount += 1;
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
    if (this._traceMode) {
      this._emitTrace(ts, buf, info);
    }
    if (this._transitionMode) {
      this._captureFrameAndAnalyze(ts, buf, info);
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

  _captureFrameAndAnalyze(ts, buf, info) {
    const bytes = Array.from(buf.subarray(0, 64));
    if (bytes.length < 64) {
      while (bytes.length < 64) bytes.push(0);
    }

    let score = 0;
    if (this._lastFrameBytes) {
      let sum = 0;
      for (let i = 0; i < 64; i += 1) {
        sum += Math.abs(bytes[i] - this._lastFrameBytes[i]);
      }
      score = sum / 64;
    }
    this._lastFrameBytes = bytes;

    // Basit mode detector: idle score ema'nın üstüne çıkarsa event-like
    if (this._idleScoreEma == null) this._idleScoreEma = score;
    const isEvent = score > Math.max(22, this._idleScoreEma * 2.2);
    const nextMode = isEvent ? 'eventLike' : 'idleLike';
    if (!isEvent) {
      this._idleScoreEma = this._idleScoreEma * 0.9 + score * 0.1;
    }

    const frame = {
      idx: this._frameCount,
      ts,
      mode: nextMode,
      score,
      bytes,
      info: { ...info },
    };
    this._frames.push(frame);
    const keep = Math.max(64, this._transitionWindow * 6);
    if (this._frames.length > keep) {
      this._frames.splice(0, this._frames.length - keep);
    }

    // Önce pending transition'ları tamamlamayı dene.
    this._flushPendingTransitions();

    if (nextMode !== this._currentMode) {
      const now = Date.now();
      if (now - this._lastTransitionAtMs >= this._transitionMinGapMs) {
        const before = this._frames.slice(-this._transitionWindow - 1, -1).map((f) => ({ ...f, bytes: [...f.bytes] }));
        if (before.length >= this._transitionWindow) {
          this._pendingTransitions.push({
            atFrameIdx: frame.idx,
            atTs: ts,
            fromMode: this._currentMode,
            toMode: nextMode,
            beforeFrames: before,
            expectedAfter: this._transitionWindow,
          });
          this._lastTransitionAtMs = now;
          this.log.log?.(
            `[cid812][transition] detected ${this._currentMode} -> ${nextMode} at frame=${frame.idx} score=${score.toFixed(2)}`,
          );
        }
      }
      this._currentMode = nextMode;
    }
  }

  _flushPendingTransitions() {
    if (!this._pendingTransitions.length) return;
    const remaining = [];
    for (const t of this._pendingTransitions) {
      const after = this._frames
        .filter((f) => f.idx > t.atFrameIdx)
        .slice(0, t.expectedAfter)
        .map((f) => ({ ...f, bytes: [...f.bytes] }));
      if (after.length < t.expectedAfter) {
        remaining.push(t);
        continue;
      }
      this._emitTransitionReport(t, after);
    }
    this._pendingTransitions = remaining;
  }

  _emitTransitionReport(t, afterFrames) {
    const rows = [];
    for (let i = 0; i < 64; i += 1) {
      const beforeAvg = avgAt(t.beforeFrames, i);
      const afterAvg = avgAt(afterFrames, i);
      const delta = afterAvg - beforeAvg;
      const b = Math.max(0, Math.min(255, Math.round(beforeAvg)));
      const a = Math.max(0, Math.min(255, Math.round(afterAvg)));
      rows.push({
        index: i,
        beforeAvg,
        afterAvg,
        delta,
        absDelta: Math.abs(delta),
        asciiBefore: byteToAscii(b),
        asciiAfter: byteToAscii(a),
      });
    }

    const topRows = [...rows].sort((x, y) => y.absDelta - x.absDelta).slice(0, this._transitionTopN);
    this.log.log?.(
      `[cid812][transition] snapshot at=${t.atTs} from=${t.fromMode} to=${t.toMode} before=${t.beforeFrames.length} after=${afterFrames.length}`,
    );
    for (const r of topRows) {
      this.log.log?.(
        `[cid812][transition][top] idx=${String(r.index).padStart(2, '0')} before=${r.beforeAvg.toFixed(2)} after=${r.afterAvg.toFixed(2)} delta=${r.delta.toFixed(2)} ascii=${r.asciiBefore}->${r.asciiAfter}`,
      );
    }

    if (this._transitionVerboseTable) {
      for (const r of rows) {
        this.log.log?.(
          `[cid812][transition][row] idx=${String(r.index).padStart(2, '0')} before=${r.beforeAvg.toFixed(2)} after=${r.afterAvg.toFixed(2)} delta=${r.delta.toFixed(2)} ascii=${r.asciiBefore}->${r.asciiAfter}`,
        );
      }
    }

    if (this._candidateMode) {
      this._updateCandidateStats(topRows);
    }
  }

  _updateCandidateStats(topRows) {
    this._transitionReportCount += 1;
    for (const r of topRows) {
      this._candidateCounts[r.index] += 1;
      this._candidateDeltaSums[r.index] += r.absDelta;
    }
    if (this._transitionReportCount % this._candidateSummaryEvery !== 0) return;

    const scored = [];
    for (let i = 0; i < 64; i += 1) {
      const c = this._candidateCounts[i];
      if (!c) continue;
      scored.push({
        index: i,
        hits: c,
        avgAbsDelta: this._candidateDeltaSums[i] / c,
      });
    }
    scored.sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return b.avgAbsDelta - a.avgAbsDelta;
    });
    const top = scored.slice(0, this._candidateTopN);
    const compact = top
      .map((x) => `${String(x.index).padStart(2, '0')}(hits=${x.hits},avg=${x.avgAbsDelta.toFixed(2)})`)
      .join(', ');
    this.log.log?.(
      `[cid812][candidate] transitions=${this._transitionReportCount} top=${compact || '-'}`,
    );
  }

  _emitTrace(ts, buf, info) {
    if (!this._traceRanges.length) return;
    const max = buf.length - 1;
    if (max < 0) return;

    const normalized = this._traceRanges
      .map(([s, e]) => [Math.min(s, max), Math.min(e, max)])
      .filter(([s, e]) => s <= e);
    if (!normalized.length) return;

    const chunks = [];
    const signatureParts = [];
    for (const [s, e] of normalized) {
      const f = formatRangeBytes(buf, s, e);
      chunks.push(`${s}-${e} hex=[${f.hex}] dec=[${f.dec}] ascii=[${f.ascii}]`);
      signatureParts.push(`${s}-${e}:${f.hex}`);
    }
    const signature = signatureParts.join('|');
    const prev = this._traceSample.length ? this._traceSample[this._traceSample.length - 1] : null;
    const changed = prev ? prev.signature !== signature : true;

    this.log.log?.(
      `[cid812][trace] ${ts} frame=${this._frameCount} vid=${info.vendorId ?? '?'} pid=${info.productId ?? '?'} serial=${info.serialNumber ?? '-'} changed=${changed ? '1' : '0'} ${chunks.join(' | ')}`,
    );

    this._traceSample.push({ signature });
    if (this._traceSample.length > this._traceWindow) {
      this._traceSample.shift();
    }

    // Özet: pencere içinde kaç farklı imza var (idle/event geçişini fark etmeyi kolaylaştırır)
    if (this._frameCount % this._traceWindow === 0) {
      const uniq = new Set(this._traceSample.map((x) => x.signature)).size;
      this.log.log?.(
        `[cid812][trace-summary] frames=${this._traceSample.length} window=${this._traceWindow} unique_signatures=${uniq}`,
      );
    }
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
    this._pendingTransitions = [];
    this._frames = [];
    this._traceSample = [];
    this._lastFrameBytes = null;
    this._idleScoreEma = null;
  }

  get started() {
    return this._started;
  }
}
