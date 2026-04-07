import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

describe('validate middleware', () => {
  const schema = {
    body: z.object({
      amount: z.number().positive(),
      type: z.enum(['cash', 'card']),
    }),
  };

  it('Geçerli body → next çağrılır, req.body parse edilir', () => {
    const req = { body: { amount: 100, type: 'cash' } };
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body.amount).toBe(100);
  });

  it('Eksik alan → 400 ve details döner', () => {
    const req = { body: { amount: 50 } }; // type eksik
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Geçersiz istek verisi');
    expect(res._body.details.some(d => d.field === 'type')).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('Yanlış tip → 400 döner', () => {
    const req = { body: { amount: -5, type: 'cash' } }; // negatif tutar
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(res._status).toBe(400);
    expect(res._body.details.some(d => d.field === 'amount')).toBe(true);
  });

  it('Şema yoksa body değişmez, next çağrılır', () => {
    const req = { body: { foo: 'bar' } };
    const res = mockRes();
    const next = vi.fn();

    validate({})(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ foo: 'bar' });
  });

  it('query şeması doğrulanır', () => {
    const qSchema = { query: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }) };
    const req = { query: { date: 'invalid' } };
    const res = mockRes();
    const next = vi.fn();

    validate(qSchema)(req, res, next);

    expect(res._status).toBe(400);
  });
});
