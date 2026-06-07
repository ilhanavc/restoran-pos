import { describe, it, expect } from 'vitest';
import { buildCorsOriginChecker, buildCorsOriginCallback } from '../utils/corsOrigin.js';

/**
 * Regresyon: CORS whitelist davranışı.
 *
 * Production:
 *   - Yalnızca explicit whitelist geçer, bilinmeyen origin reddedilir.
 *   - Boş whitelist → cross-origin tamamen reddedilir (same-origin / no-origin geçer).
 * Development:
 *   - Whitelist + localhost/127.0.0.1/LAN regex'leri geçer.
 *   - "evil.com" gibi arbitrary origin'ler yine reddedilir.
 *
 * "No origin" (undefined/null/'') her zaman geçer — mobile app, curl, same-origin browser
 * istekleri Origin header'ı eklemez.
 */

describe('buildCorsOriginChecker — production', () => {
  const isAllowed = buildCorsOriginChecker({
    origins: ['https://pos.example.com', 'https://admin.example.com'],
    isProduction: true,
  });

  it('whitelist içindeki origin geçer', () => {
    expect(isAllowed('https://pos.example.com')).toBe(true);
    expect(isAllowed('https://admin.example.com')).toBe(true);
  });

  it('whitelist dışındaki origin reddedilir', () => {
    expect(isAllowed('https://evil.com')).toBe(false);
    expect(isAllowed('http://localhost:5173')).toBe(false);
    expect(isAllowed('http://192.168.1.5:5173')).toBe(false);
  });

  it('no-origin (mobile app, curl, same-origin) geçer', () => {
    expect(isAllowed(undefined)).toBe(true);
    expect(isAllowed(null)).toBe(true);
    expect(isAllowed('')).toBe(true);
  });

  it('boş whitelist → no-origin geçer, tüm cross-origin reddedilir', () => {
    const strict = buildCorsOriginChecker({ origins: [], isProduction: true });
    expect(strict(undefined)).toBe(true);
    expect(strict('https://pos.example.com')).toBe(false);
    expect(strict('http://localhost:5173')).toBe(false);
  });

  it('subdomain farkı reddedilir (exact match)', () => {
    expect(isAllowed('https://evil.example.com')).toBe(false);
    expect(isAllowed('https://pos.example.com.evil.com')).toBe(false);
  });
});

describe('buildCorsOriginChecker — development', () => {
  const isAllowed = buildCorsOriginChecker({
    origins: ['https://pos.example.com'],
    isProduction: false,
  });

  it('whitelist içindeki origin geçer', () => {
    expect(isAllowed('https://pos.example.com')).toBe(true);
  });

  it('localhost herhangi port geçer', () => {
    expect(isAllowed('http://localhost:5173')).toBe(true);
    expect(isAllowed('http://localhost:3001')).toBe(true);
    expect(isAllowed('http://localhost')).toBe(true);
  });

  it('127.0.0.1 herhangi port geçer', () => {
    expect(isAllowed('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowed('http://127.0.0.1:8080')).toBe(true);
  });

  it('192.168.x LAN IP geçer', () => {
    expect(isAllowed('http://192.168.1.5:5173')).toBe(true);
    expect(isAllowed('http://192.168.100.42:3001')).toBe(true);
  });

  it('10.x LAN IP geçer', () => {
    expect(isAllowed('http://10.0.0.5:5173')).toBe(true);
  });

  it('public internet origin yine reddedilir (dev modda bile)', () => {
    expect(isAllowed('https://evil.com')).toBe(false);
    expect(isAllowed('http://attacker.example.org')).toBe(false);
  });

  it('HTTPS localhost dev regex\'i sadece HTTP yakaladığı için reddeder', () => {
    // Dev pattern'ler sadece http:// olanı yakalıyor; eğer geliştirici HTTPS localhost
    // kullanıyorsa CORS_ORIGINS env'ine eklemeli.
    expect(isAllowed('https://localhost:5173')).toBe(false);
  });
});

describe('buildCorsOriginCallback', () => {
  it('izin verilen origin → cb(null, true)', () => {
    const cb = buildCorsOriginCallback({
      origins: ['https://pos.example.com'],
      isProduction: true,
    });
    const calls = [];
    cb('https://pos.example.com', (err, allow) => calls.push([err, allow]));
    expect(calls[0][0]).toBeNull();
    expect(calls[0][1]).toBe(true);
  });

  it('reddedilen origin → cb(Error, false)', () => {
    const cb = buildCorsOriginCallback({
      origins: ['https://pos.example.com'],
      isProduction: true,
    });
    const calls = [];
    cb('https://evil.com', (err, allow) => calls.push([err, allow]));
    expect(calls[0][0]).toBeInstanceOf(Error);
    expect(calls[0][0].message).toBe('CORS: origin not allowed');
    expect(calls[0][1]).toBe(false);
  });

  it('no-origin → cb(null, true)', () => {
    const cb = buildCorsOriginCallback({ origins: [], isProduction: true });
    const calls = [];
    cb(undefined, (err, allow) => calls.push([err, allow]));
    expect(calls[0][0]).toBeNull();
    expect(calls[0][1]).toBe(true);
  });
});
