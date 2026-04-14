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
