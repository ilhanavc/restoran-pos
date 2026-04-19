import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regresyon: server/config/index.js üretim ortamında JWT_SECRET için
 * fail-fast guard'larını korumalı.
 *
 * - Prod + JWT_SECRET eksik    → throw
 * - Prod + JWT_SECRET <32 char → throw
 * - Prod + JWT_SECRET ≥32 char → yüklenir
 *
 * dotenv mock'lanır ki server/.env (varsa) testi kirletmesin.
 */

const originalEnv = { ...process.env };

vi.mock('dotenv', () => ({
  default: { config: () => ({ parsed: {} }) },
  config: () => ({ parsed: {} }),
}));

describe('server/config/index.js — JWT_SECRET fail-fast', () => {
  beforeEach(() => {
    vi.resetModules();
    // Testler arası env sızıntısını engelle
    process.env = { ...originalEnv };
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('üretimde JWT_SECRET yoksa başlatma hatası verir', async () => {
    process.env.NODE_ENV = 'production';
    await expect(import('../config/index.js')).rejects.toThrow(
      /JWT_SECRET ortam değişkeni zorunludur/
    );
  });

  it('üretimde JWT_SECRET fallback değerine eşitse başlatma hatası verir', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'fallback-secret-change-me';
    await expect(import('../config/index.js')).rejects.toThrow(
      /varsayılan gizli anahtar kullanılamaz/
    );
  });

  it('üretimde JWT_SECRET 32 karakterden kısaysa başlatma hatası verir', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'kisa-anahtar-24-char-abcde'; // 26 char
    await expect(import('../config/index.js')).rejects.toThrow(
      /en az 32 karakter/
    );
  });

  it('üretimde JWT_SECRET 32+ karakterse config yüklenir', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(32);
    const mod = await import('../config/index.js');
    expect(mod.default.nodeEnv).toBe('production');
    expect(mod.default.jwt.secret).toHaveLength(32);
  });

  it('geliştirme ortamında JWT_SECRET olmasa bile yüklenir (fallback kullanır)', async () => {
    process.env.NODE_ENV = 'development';
    const mod = await import('../config/index.js');
    expect(mod.default.nodeEnv).toBe('development');
    expect(mod.default.jwt.secret).toBe('fallback-secret-change-me');
  });
});
