import { describe, it, expect } from 'vitest';
import { getPrinterPreviewPlainLines } from '../../store-bridge/printers/renderers.js';

describe('getPrinterPreviewPlainLines', () => {
  it('kitchen: üretilen satırlar boş değil ve demo ürün adı içerir', () => {
    const lines = getPrinterPreviewPlainLines('kitchen', 42, {});
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined.trim().length).toBeGreaterThan(0);
    expect(joined).toContain('Hellim Peynirli Salata');
  });

  it('receipt: üretilen satırlar boş değil ve demo işletme veya toplam içerir', () => {
    const lines = getPrinterPreviewPlainLines('receipt', 42, {});
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined).toMatch(/Demo Restoran|325/);
  });

  it('bar: mutfak ile aynı kod yolu, istasyon metni BAR olabilir', () => {
    const lines = getPrinterPreviewPlainLines('bar', 42, {});
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined).toMatch(/BAR|Hellim/);
  });

  it('şablon açık olsa bile güvenli varsayılan fiş düzeni korunur', () => {
    const lines = getPrinterPreviewPlainLines('kitchen', 42, {
      template: {
        enabled: true,
        body: '{business_name}\n{{items}}\nAlt satır',
      },
    });
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined).toContain('Demo Restoran');
    expect(joined).toContain('Hellim Peynirli Salata');
    expect(joined).not.toContain('Alt satır');
    expect(joined).toMatch(/MUTFAK|MASA SİPARİŞİ/);
  });
});
