import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null } }));

vi.mock('../config/database.js', () => ({
  get default() { return dbRef.current; },
}));

let helpers;
let service;
let seeds;

beforeAll(async () => {
  helpers = await import('./integration/helpers.js');
  service = await import('../services/callerIdService.js');
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
});

describe('callerIdService duplicate protection', () => {
  it('deduplicates repeated ringing events in a short window', () => {
    const first = service.processIncomingCall({
      businessId: seeds.businessId,
      userId: null,
      rawPhone: '0532 111 22 33',
      sourceType: 'cid812',
    });
    const second = service.processIncomingCall({
      businessId: seeds.businessId,
      userId: null,
      rawPhone: '0532 111 22 33',
      sourceType: 'cid812',
    });

    expect(second.duplicate).toBe(true);
    expect(second.callLogId).toBe(first.callLogId);

    const count = dbRef.current
      .prepare('SELECT COUNT(*) AS c FROM call_logs WHERE business_id = ?')
      .get(seeds.businessId).c;
    expect(count).toBe(1);
  });
});

// ── P2: CallerID durum geçişleri (service katmanı) ───────────────────────────

describe('callerIdService — updateCallLogStatus durum geçişleri (P2)', () => {
  function createRingingLog(phone = '0533 777 88 99') {
    const result = service.processIncomingCall({
      businessId: seeds.businessId,
      userId: null,
      rawPhone: phone,
      sourceType: 'simulate',
    });
    return result.callLogId;
  }

  it('ringing → opened_order geçişi log kaydını günceller', () => {
    const logId = createRingingLog('0533 111 00 01');

    const updated = service.updateCallLogStatus(seeds.businessId, logId, 'opened_order');

    expect(updated).not.toBeNull();
    expect(updated.status).toBe('opened_order');
    expect(updated.id).toBe(logId);
  });

  it('opened_order → completed geçişi başarılı olur', () => {
    const logId = createRingingLog('0533 111 00 02');
    service.updateCallLogStatus(seeds.businessId, logId, 'opened_order');

    const updated = service.updateCallLogStatus(seeds.businessId, logId, 'completed');

    expect(updated.status).toBe('completed');
  });

  it('ringing → dismissed geçişi başarılı olur', () => {
    const logId = createRingingLog('0533 111 00 03');

    const updated = service.updateCallLogStatus(seeds.businessId, logId, 'dismissed');

    expect(updated.status).toBe('dismissed');
  });

  it('geçersiz status değeri hata fırlatır (isBadRequest=true)', () => {
    const logId = createRingingLog('0533 111 00 04');

    expect(() => {
      service.updateCallLogStatus(seeds.businessId, logId, 'gecersiz_durum');
    }).toThrow();

    try {
      service.updateCallLogStatus(seeds.businessId, logId, 'gecersiz_durum');
    } catch (err) {
      expect(err.isBadRequest).toBe(true);
    }
  });

  it('var olmayan log id için null döner', () => {
    const result = service.updateCallLogStatus(seeds.businessId, 'olmayan-id', 'completed');
    expect(result).toBeNull();
  });

  it('farklı business_id ile log güncellenemez (izolasyon)', () => {
    const logId = createRingingLog('0533 111 00 05');

    const result = service.updateCallLogStatus('baska-isletme-id', logId, 'completed');
    expect(result).toBeNull();

    // Orijinal kayıt etkilenmemeli
    const row = dbRef.current.prepare('SELECT status FROM call_logs WHERE id = ?').get(logId);
    expect(row.status).toBe('ringing');
  });
});
