import { describe, it, expect } from 'vitest';
import { normalizePhoneDigits, isTurkishMobile } from '../utils/phoneNormalize.js';

describe('normalizePhoneDigits', () => {
  it('boş/null girdi → boş string döner', () => {
    expect(normalizePhoneDigits(null)).toBe('');
    expect(normalizePhoneDigits(undefined)).toBe('');
    expect(normalizePhoneDigits('')).toBe('');
  });

  it('05XX (11 hane) → aynen kalır', () => {
    expect(normalizePhoneDigits('05321112233')).toBe('05321112233');
  });

  it('5XX (10 hane) → başına 0 ekler', () => {
    expect(normalizePhoneDigits('5321112233')).toBe('05321112233');
  });

  it('90XX (12 hane) → 0XX biçimine çevirir', () => {
    expect(normalizePhoneDigits('905321112233')).toBe('05321112233');
  });

  it('+90 ve boşluk/tire içeren formatı temizler', () => {
    expect(normalizePhoneDigits('+90 532 111 22 33')).toBe('05321112233');
    expect(normalizePhoneDigits('+90-532-111-22-33')).toBe('05321112233');
  });

  it('parantezli formatı temizler', () => {
    expect(normalizePhoneDigits('(0532) 111 22 33')).toBe('05321112233');
  });

  it('13 haneli 905... girdiyi 11 haneye indirir', () => {
    expect(normalizePhoneDigits('9053211122339')).toBe('05321112233');
  });

  it('sabit hat / kısa numara ham halde saklanır (reddedilmez)', () => {
    expect(normalizePhoneDigits('5287717')).toBe('5287717');
    expect(normalizePhoneDigits('02125551234')).toBe('02125551234');
    expect(normalizePhoneDigits('112')).toBe('112');
  });

  it('yabancı/uzun numara rakamları aynen saklanır', () => {
    expect(normalizePhoneDigits('0044 7700 900123')).toBe('00447700900123');
  });
});

describe('isTurkishMobile', () => {
  it('cep numarasını tanır', () => {
    expect(isTurkishMobile('05321112233')).toBe(true);
    expect(isTurkishMobile('+90 532 111 22 33')).toBe(true);
  });

  it('sabit hattı cep olarak tanımaz', () => {
    expect(isTurkishMobile('5287717')).toBe(false);
    expect(isTurkishMobile('02125551234')).toBe(false);
  });
});
