import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regresyon: server/config/index.js TRUST_PROXY_HOPS env'ini doğru parse etmeli.
 *
 * - Eksik  → 0 (güvenli default, rate-limit X-Forwarded-For'a güvenmez)
 * - "1"    → 1 (Nginx tek hop)
 * - "2"    → 2 (Cloudflare + Nginx)
 * - "abc"  → 0 (geçersiz değer düşür)
 * - "-3"   → 0 (negatifi reddet)
 *
 * dotenv mock'lanır ki server/.env testi kirletmesin.
 */

const originalEnv = { ...process.env };

vi.mock('dotenv', () => ({
  default: { config: () => ({ parsed: {} }) },
  config: () => ({ parsed: {} }),
}));

async function loadConfig() {
  vi.resetModules();
  const mod = await import('../config/index.js');
  return mod.default;
}

describe('server/config/index.js — TRUST_PROXY_HOPS parsing', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRUST_PROXY_HOPS;
    delete process.env.NODE_ENV;
    // 32+ char — prod guard'ına takılmamak için (testler dev'de çalışsa da garanti)
    process.env.JWT_SECRET = 'test-secret-key-32-chars-minimum-';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('env eksikse trustProxyHops = 0', async () => {
    const cfg = await loadConfig();
    expect(cfg.trustProxyHops).toBe(0);
  });

  it('"1" → 1 (Nginx)', async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    const cfg = await loadConfig();
    expect(cfg.trustProxyHops).toBe(1);
  });

  it('"2" → 2 (Cloudflare + Nginx)', async () => {
    process.env.TRUST_PROXY_HOPS = '2';
    const cfg = await loadConfig();
    expect(cfg.trustProxyHops).toBe(2);
  });

  it('geçersiz string → 0', async () => {
    process.env.TRUST_PROXY_HOPS = 'abc';
    const cfg = await loadConfig();
    expect(cfg.trustProxyHops).toBe(0);
  });

  it('negatif değer → 0', async () => {
    process.env.TRUST_PROXY_HOPS = '-3';
    const cfg = await loadConfig();
    expect(cfg.trustProxyHops).toBe(0);
  });

  it('boş string → 0', async () => {
    process.env.TRUST_PROXY_HOPS = '';
    const cfg = await loadConfig();
    expect(cfg.trustProxyHops).toBe(0);
  });
});
