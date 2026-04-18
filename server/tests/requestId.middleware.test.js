/**
 * requestId middleware unit testi.
 *
 * Test edilen davranışlar:
 *   1. Geçerli UUID başlığı gönderilirse aynısı kullanılır (uçtan-uca trace).
 *   2. Eksik başlık → yeni UUID üretilir.
 *   3. Geçersiz/enjekte edilmiş başlık → yeni UUID üretilir (injection koruması).
 *   4. Her durumda X-Request-Id response header'ına yazılır.
 *   5. req.requestId set edilir.
 */
import { describe, it, expect } from 'vitest';
import { requestIdMiddleware } from '../middleware/requestId.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeReqRes(incomingRequestId) {
  const headers = {};
  if (incomingRequestId !== undefined) {
    headers['x-request-id'] = incomingRequestId;
  }

  const req = { headers, requestId: undefined };

  const resHeaders = {};
  const res = {
    setHeader(name, value) { resHeaders[name.toLowerCase()] = value; },
    getResponseHeader(name) { return resHeaders[name.toLowerCase()]; },
  };

  let nextCalled = false;
  const next = () => { nextCalled = true; };

  return { req, res, next, nextCalled: () => nextCalled, resHeaders };
}

describe('requestIdMiddleware', () => {
  it('geçerli UUID gönderilirse aynısını kullanır', () => {
    const incoming = '550e8400-e29b-41d4-a716-446655440000';
    const { req, res, next } = makeReqRes(incoming);
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toBe(incoming);
    expect(res.getResponseHeader('x-request-id')).toBe(incoming);
  });

  it('header yoksa yeni UUID üretir', () => {
    const { req, res, next } = makeReqRes(undefined);
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toMatch(UUID_RE);
    expect(res.getResponseHeader('x-request-id')).toBe(req.requestId);
  });

  it('geçersiz değer varsa yeni UUID üretir (injection koruması)', () => {
    const invalid = 'INJECT\r\nX-Evil: yes';
    const { req, res, next } = makeReqRes(invalid);
    requestIdMiddleware(req, res, next);
    expect(req.requestId).not.toBe(invalid);
    expect(req.requestId).toMatch(UUID_RE);
  });

  it('boş string varsa yeni UUID üretir', () => {
    const { req, res, next } = makeReqRes('');
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toMatch(UUID_RE);
  });

  it('her durumda next() çağrılır', () => {
    const { req, res, next, nextCalled } = makeReqRes(undefined);
    requestIdMiddleware(req, res, next);
    expect(nextCalled()).toBe(true);
  });
});
