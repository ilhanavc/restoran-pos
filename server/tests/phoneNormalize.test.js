import { describe, it, expect } from 'vitest';
import { normalizePhoneDigits } from '../utils/phoneNormalize.js';

describe('normalizePhoneDigits', () => {
  it('boş/null girdi → boş string döner', () => {
    expect(normalizePhoneDigits(null)).toBe('');
    expect(normalizePhoneDigits(undefined)).toBe('');
    expect(normalizePhoneDigits('')).toBe('');
  });

  it('05XX formatını 90XX yapar', () => {
    expect(normalizePhoneDigits('05321112233')).toBe('905321112233');
  });

  it('5XX (10 hane) formatını 90XX yapar', () => {
    expect(normalizePhoneDigits('5321112233')).toBe('905321112233');
  });

  it('90XX (12 hane) olduğu gibi kalır', () => {
    expect(normalizePhoneDigits('905321112233')).toBe('905321112233');
  });

  it('+90 ve boşluk/tire içeren formatı temizler', () => {
    expect(normalizePhoneDigits('+90 532 111 22 33')).toBe('905321112233');
    expect(normalizePhoneDigits('+90-532-111-22-33')).toBe('905321112233');
  });

  it('parantezli formatı temizler', () => {
    expect(normalizePhoneDigits('(0532) 111 22 33')).toBe('905321112233');
  });

  it('13 haneli 905... girdiyi 12 haneye kırpar', () => {
    expect(normalizePhoneDigits('9053211122339')).toBe('905321112233');
  });

  it('sayısal olmayan karakterleri temizler', () => {
    expect(normalizePhoneDigits('0532-111-22-33')).toBe('905321112233');
  });
});
