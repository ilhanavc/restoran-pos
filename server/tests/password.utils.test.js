import { describe, it, expect } from 'vitest';
import { validatePassword, isValidPassword } from '../utils/password.js';

/**
 * Regresyon: Şifre politikası (FAZ 0 — Görev 0.5).
 * Kurallar: min 8 karakter, en az bir büyük harf, en az bir rakam.
 * Yalnızca YENİ şifre belirlenirken kullanılır — login'de değil.
 */

describe('validatePassword', () => {
  it('null/undefined → hata', () => {
    expect(validatePassword(null)).toBe('Şifre gerekli');
    expect(validatePassword(undefined)).toBe('Şifre gerekli');
  });

  it('string olmayan → hata', () => {
    expect(validatePassword(12345678)).toBe('Şifre metin olmalı');
    expect(validatePassword({})).toBe('Şifre metin olmalı');
  });

  it('çok kısa (< 8) → hata', () => {
    expect(validatePassword('Ab1')).toBe('Şifre en az 8 karakter olmalı');
    expect(validatePassword('Abc123')).toBe('Şifre en az 8 karakter olmalı');
    expect(validatePassword('')).toBe('Şifre en az 8 karakter olmalı');
  });

  it('çok uzun (> 128) → hata', () => {
    const pw = 'Ab1' + 'x'.repeat(130);
    expect(validatePassword(pw)).toBe('Şifre en fazla 128 karakter olabilir');
  });

  it('büyük harf eksik → hata', () => {
    expect(validatePassword('abcdef12')).toBe('Şifre en az bir büyük harf içermeli');
    expect(validatePassword('password1')).toBe('Şifre en az bir büyük harf içermeli');
  });

  it('rakam eksik → hata', () => {
    expect(validatePassword('Password')).toBe('Şifre en az bir rakam içermeli');
    expect(validatePassword('Abcdefgh')).toBe('Şifre en az bir rakam içermeli');
  });

  it('eski demo parola (123456) → reddedilir', () => {
    expect(validatePassword('123456')).toBe('Şifre en az 8 karakter olmalı');
  });

  it('geçerli parola → null', () => {
    expect(validatePassword('Password1')).toBeNull();
    expect(validatePassword('Restoran2026')).toBeNull();
    expect(validatePassword('Aa1!' + 'x'.repeat(4))).toBeNull();
  });

  it('tam 8 karakter, büyük + rakam → geçerli', () => {
    expect(validatePassword('Pass1234')).toBeNull();
  });
});

describe('isValidPassword', () => {
  it('geçerli → true, geçersiz → false', () => {
    expect(isValidPassword('Password1')).toBe(true);
    expect(isValidPassword('123456')).toBe(false);
    expect(isValidPassword(null)).toBe(false);
  });
});
