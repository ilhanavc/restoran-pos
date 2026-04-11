import { describe, it, expect } from 'vitest';
import { encodePC857, encodeWin1254 } from '../../store-bridge/printers/renderers.js';

/**
 * PC857 (IBM Turkish) karakter kodlaması doğruluk testleri.
 * ESC t 12 ile seçilen bu kod sayfasında Türkçe karakterlerin
 * doğru byte değerlerine dönüştüğünü doğrular.
 */
describe('encodePC857', () => {
  // ── Temel davranış ───────────────────────────────────────────────────────

  it('null/undefined/boş → boş Buffer döner', () => {
    expect(encodePC857(null)).toEqual(Buffer.from([]));
    expect(encodePC857(undefined)).toEqual(Buffer.from([]));
    expect(encodePC857('')).toEqual(Buffer.from([]));
  });

  it('saf ASCII metni değişmeden geçer', () => {
    const result = encodePC857('HELLO 123');
    expect(result).toEqual(Buffer.from('HELLO 123', 'ascii'));
  });

  // ── Büyük Türkçe harfler ─────────────────────────────────────────────────

  it('Ç → 0x80', () => {
    expect(encodePC857('Ç')[0]).toBe(0x80);
  });

  it('Ğ → 0xA6', () => {
    expect(encodePC857('Ğ')[0]).toBe(0xa6);
  });

  it('İ → 0x98', () => {
    expect(encodePC857('İ')[0]).toBe(0x98);
  });

  it('Ö → 0x99', () => {
    expect(encodePC857('Ö')[0]).toBe(0x99);
  });

  it('Ş → 0xE0 (JP80H-UE uyumlu)', () => {
    expect(encodePC857('Ş')[0]).toBe(0xe0);
  });

  it('Ü → 0x9A', () => {
    expect(encodePC857('Ü')[0]).toBe(0x9a);
  });

  // ── Küçük Türkçe harfler ─────────────────────────────────────────────────

  it('ç → 0x87', () => {
    expect(encodePC857('ç')[0]).toBe(0x87);
  });

  it('ğ → 0xA7 (JP80H-UE uyumlu)', () => {
    expect(encodePC857('ğ')[0]).toBe(0xa7);
  });

  it('ı → 0x8D (noktalı olmayan i)', () => {
    expect(encodePC857('ı')[0]).toBe(0x8d);
  });

  it('ö → 0x94', () => {
    expect(encodePC857('ö')[0]).toBe(0x94);
  });

  it('ş → 0xE7 (JP80H-UE uyumlu)', () => {
    expect(encodePC857('ş')[0]).toBe(0xe7);
  });

  it('ü → 0x81', () => {
    expect(encodePC857('ü')[0]).toBe(0x81);
  });

  // ── Tüm Türkçe harfler bir arada ─────────────────────────────────────────

  it('ÇĞİÖŞÜçğıöşü tam sırayla doğru byte\'lara dönüşür', () => {
    const result = encodePC857('ÇĞİÖŞÜçğıöşü');
    const expected = Buffer.from([
      0x80, // Ç
      0xa6, // Ğ
      0x98, // İ
      0x99, // Ö
      0xe0, // Ş → 0xE0 (JP80H-UE)
      0x9a, // Ü
      0x87, // ç
      0xa7, // ğ → 0xA7 (JP80H-UE)
      0x8d, // ı
      0x94, // ö
      0xe7, // ş → 0xE7 (JP80H-UE)
      0x81, // ü
    ]);
    expect(result).toEqual(expected);
  });

  // ── Karışık metin ────────────────────────────────────────────────────────

  it('Karışık ASCII + Türkçe metin doğru encode edilir', () => {
    const result = encodePC857('Çorba');
    expect(result[0]).toBe(0x80);         // Ç
    expect(result[1]).toBe('o'.charCodeAt(0)); // o (ASCII)
    expect(result[2]).toBe('r'.charCodeAt(0)); // r
    expect(result[3]).toBe('b'.charCodeAt(0)); // b
    expect(result[4]).toBe('a'.charCodeAt(0)); // a
    expect(result.length).toBe(5);
  });

  // ── Özel durumlar ────────────────────────────────────────────────────────

  it('₺ → "TL" (2 byte: 0x54 0x4C)', () => {
    const result = encodePC857('₺');
    expect(result.length).toBe(2);
    expect(result[0]).toBe(0x54); // T
    expect(result[1]).toBe(0x4c); // L
  });

  it('₺ içeren fiyat metni: "150₺" → "150TL"', () => {
    const result = encodePC857('150₺');
    expect(result.toString('binary')).toBe('150TL');
  });

  it('Bilinmeyen Unicode karakter → 0x3F (?)', () => {
    expect(encodePC857('★')[0]).toBe(0x3f);
    expect(encodePC857('😀')[0]).toBe(0x3f);
  });

  it('Sayısal metin (fiyat, miktar) bozulmadan geçer', () => {
    const result = encodePC857('42.50');
    expect(result.toString('ascii')).toBe('42.50');
  });
});

// ── encodeWin1254 ────────────────────────────────────────────────────────────

describe('encodeWin1254', () => {
  it('null/undefined/boş → boş Buffer döner', () => {
    expect(encodeWin1254(null)).toEqual(Buffer.from([]));
    expect(encodeWin1254(undefined)).toEqual(Buffer.from([]));
    expect(encodeWin1254('')).toEqual(Buffer.from([]));
  });

  it('saf ASCII metni değişmeden geçer', () => {
    const result = encodeWin1254('HELLO 123');
    expect(result.toString('binary')).toBe('HELLO 123');
  });

  it('Tüm büyük Türkçe harfler doğru kodlanır (Windows-1254)', () => {
    // Windows-1254 byte values for Turkish uppercase chars
    const result = encodeWin1254('ÇĞİÖŞÜ');
    expect(result[0]).toBe(0xc7); // Ç
    expect(result[1]).toBe(0xd0); // Ğ
    expect(result[2]).toBe(0xdd); // İ
    expect(result[3]).toBe(0xd6); // Ö
    expect(result[4]).toBe(0xde); // Ş
    expect(result[5]).toBe(0xdc); // Ü
  });

  it('Tüm küçük Türkçe harfler doğru kodlanır (Windows-1254)', () => {
    const result = encodeWin1254('çğıöşü');
    expect(result[0]).toBe(0xe7); // ç
    expect(result[1]).toBe(0xf0); // ğ
    expect(result[2]).toBe(0xfd); // ı
    expect(result[3]).toBe(0xf6); // ö
    expect(result[4]).toBe(0xfe); // ş
    expect(result[5]).toBe(0xfc); // ü
  });

  it('₺ → "TL" (2 byte)', () => {
    const result = encodeWin1254('₺');
    expect(result.toString('binary')).toBe('TL');
  });

  it('Karışık metin doğru encode edilir', () => {
    const result = encodeWin1254('Çorba');
    expect(result[0]).toBe(0xc7); // Ç in Win-1254
    expect(result[1]).toBe('o'.charCodeAt(0));
    expect(result.length).toBe(5);
  });
});
