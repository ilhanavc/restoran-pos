import { describe, it, expect } from 'vitest';
import { beforeSendRedact, initSentry, isSentryEnabled } from '../utils/sentry.js';
import config from '../config/index.js';

describe('sentry beforeSendRedact', () => {
  it('null event — güvenli döner', () => {
    expect(beforeSendRedact(null)).toBeNull();
    expect(beforeSendRedact(undefined)).toBeUndefined();
  });

  it('Authorization header → *** (case-insensitive)', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer secret123',
          Authorization: 'Bearer secret456',
          'x-bridge-token': 'bridge-abc',
          'content-type': 'application/json',
        },
      },
    };
    const out = beforeSendRedact(event);
    expect(out.request.headers.authorization).toBe('***');
    expect(out.request.headers.Authorization).toBe('***');
    expect(out.request.headers['x-bridge-token']).toBe('***');
    expect(out.request.headers['content-type']).toBe('application/json');
  });

  it('cookie header → ***', () => {
    const event = {
      request: { headers: { cookie: 'sid=xyz; token=abc' } },
    };
    const out = beforeSendRedact(event);
    expect(out.request.headers.cookie).toBe('***');
  });

  it('request.data.password → ***', () => {
    const event = {
      request: {
        data: {
          email: 'admin@demo.com',
          password: '123456',
          newPassword: 'yeni-sifre',
        },
      },
    };
    const out = beforeSendRedact(event);
    expect(out.request.data.email).toBe('admin@demo.com');
    expect(out.request.data.password).toBe('***');
    expect(out.request.data.newPassword).toBe('***');
  });

  it('iç içe nested token alanı → ***', () => {
    const event = {
      extra: {
        payload: {
          user: {
            id: 1,
            refreshToken: 'refresh-abc',
            nested: { accessToken: 'at-xyz' },
          },
        },
      },
    };
    const out = beforeSendRedact(event);
    expect(out.extra.payload.user.id).toBe(1);
    expect(out.extra.payload.user.refreshToken).toBe('***');
    expect(out.extra.payload.user.nested.accessToken).toBe('***');
  });

  it('array içindeki objeler de taranır', () => {
    const event = {
      extra: {
        users: [
          { id: 1, password: 'aaa' },
          { id: 2, password: 'bbb' },
        ],
      },
    };
    const out = beforeSendRedact(event);
    expect(out.extra.users[0].password).toBe('***');
    expect(out.extra.users[1].password).toBe('***');
    expect(out.extra.users[0].id).toBe(1);
  });

  it('hassas olmayan alanlara dokunmaz', () => {
    const event = {
      request: {
        data: {
          orderId: 42,
          items: [{ productId: 1, quantity: 2 }],
          customerPhone: '05551234567',
        },
      },
    };
    const out = beforeSendRedact(event);
    expect(out.request.data.orderId).toBe(42);
    expect(out.request.data.items[0].productId).toBe(1);
    expect(out.request.data.customerPhone).toBe('05551234567');
  });

  it('jwtSecret ve bridgeToken alanları → ***', () => {
    const event = {
      contexts: {
        config: {
          jwtSecret: 'super-secret-32-char-min',
          bridgeToken: 'bridge-xyz',
          port: 3001,
        },
      },
    };
    const out = beforeSendRedact(event);
    expect(out.contexts.config.jwtSecret).toBe('***');
    expect(out.contexts.config.bridgeToken).toBe('***');
    expect(out.contexts.config.port).toBe(3001);
  });

  it('derin nesting (>6) döngüye girmez', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { password: 'x' } } } } } } } };
    const event = { extra: deep };
    expect(() => beforeSendRedact(event)).not.toThrow();
  });
});

describe('sentry init', () => {
  it('DSN durumu config ile tutarlı — boşsa disabled, doluysa enabled', () => {
    initSentry();
    const shouldBeEnabled = Boolean(config.sentry.dsn);
    expect(isSentryEnabled()).toBe(shouldBeEnabled);
  });
});

