import { useEffect, useMemo, useState } from 'react';
import { Printer, X } from 'lucide-react';
import api from '../../services/api.js';

function roleLabel(type) {
  if (type === 'receipt') return 'Müşteri fişi yazıcısı';
  if (type === 'kitchen') return 'Mutfak yazıcısı';
  return 'Diğer';
}

function statusMeta(printer, discoveredSet) {
  if (!printer?.is_active) return { text: 'Pasif', tone: 'warning' };
  const physicalName = String(printer?.print_options?.device?.physicalName || '').trim();
  if (!physicalName) return { text: 'Eksik kurulum', tone: 'info' };
  if (printer.connection_type === 'network' && !String(printer.ip_address || '').trim()) {
    return { text: 'Eksik kurulum', tone: 'info' };
  }
  if (discoveredSet.size > 0 && !discoveredSet.has(physicalName.toLowerCase())) {
    return { text: 'Bağlı değil / sorunlu', tone: 'danger' };
  }
  return { text: 'Hazır', tone: 'success' };
}

function badgeClass(tone) {
  if (tone === 'success') return 'badge badge-success';
  if (tone === 'warning') return 'badge badge-warning';
  if (tone === 'danger') return 'badge badge-danger';
  return 'badge badge-info';
}

export default function ManualPrintSelectorModal({
  open,
  onClose,
  onConfirm,
  printRole = 'receipt',
  title = 'Yazdır',
  description = 'Hangi yazıcıdan yazdırmak istiyorsunuz?',
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [printers, setPrinters] = useState([]);
  const [defaultPrinterId, setDefaultPrinterId] = useState(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState('');
  const [errorText, setErrorText] = useState('');
  const [discoveredPrinters, setDiscoveredPrinters] = useState([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setErrorText('');
      try {
        const [settings, discovered] = await Promise.all([
          api.getPrinterSettings(),
          api.getDiscoveredPrinters().catch(() => ({ printers: [] })),
        ]);
        if (cancelled) return;
        const all = Array.isArray(settings?.printers) ? settings.printers : [];
        const filtered = all.filter((p) => p.type === printRole);
        setPrinters(filtered);
        setDiscoveredPrinters(Array.isArray(discovered?.printers) ? discovered.printers : []);
        const configDefault = settings?.config?.defaultPrinterId || null;
        setDefaultPrinterId(configDefault);

        const storageKey = `manualPrint:last:${printRole}`;
        const remembered = window.localStorage.getItem(storageKey);
        const rememberedValid = remembered && filtered.some((p) => p.id === remembered);
        const defaultValid = configDefault && filtered.some((p) => p.id === configDefault);
        const readyFirst = filtered.find((p) => p.is_active)?.id || '';
        setSelectedPrinterId(rememberedValid ? remembered : defaultValid ? configDefault : readyFirst);
      } catch (err) {
        if (!cancelled) setErrorText(err?.message || 'Yazıcılar yüklenemedi');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, printRole]);

  const discoveredSet = useMemo(
    () => new Set((discoveredPrinters || []).map((p) => String(p?.name || '').trim().toLowerCase()).filter(Boolean)),
    [discoveredPrinters],
  );

  if (!open) return null;

  const handleConfirm = async () => {
    if (!selectedPrinterId) {
      setErrorText('Lütfen bir yazıcı seçin');
      return;
    }
    setSubmitting(true);
    try {
      window.localStorage.setItem(`manualPrint:last:${printRole}`, selectedPrinterId);
      await onConfirm?.(selectedPrinterId);
      onClose?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: 'min(760px, 96vw)' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{description}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} title="Kapat">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {loading ? <div className="empty-state">Yazıcılar yükleniyor…</div> : null}
          {!loading && !printers.length ? (
            <div className="empty-state">
              Bu işlem için uygun yazıcı bulunamadı.
            </div>
          ) : null}
          {!loading && printers.length ? (
            <div style={{ display: 'grid', gap: 8, maxHeight: '52vh', overflowY: 'auto' }}>
              {printers.map((printer) => {
                const status = statusMeta(printer, discoveredSet);
                const physicalName = String(printer?.print_options?.device?.physicalName || '').trim() || 'Seçilmemiş';
                const selected = selectedPrinterId === printer.id;
                return (
                  <button
                    key={printer.id}
                    type="button"
                    onClick={() => setSelectedPrinterId(printer.id)}
                    style={{
                      border: selected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                      background: selected ? 'var(--accent-muted)' : 'var(--bg-secondary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <Printer size={15} />
                        <strong style={{ fontSize: 14 }}>{printer.name}</strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="badge badge-info">{roleLabel(printer.type)}</span>
                        <span className={badgeClass(status.tone)}>{status.text}</span>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                      Fiziksel cihaz: <strong>{physicalName}</strong>
                      {defaultPrinterId && defaultPrinterId === printer.id ? (
                        <span style={{ marginLeft: 8 }} className="badge badge-success">Varsayılan</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {errorText ? (
            <div style={{ marginTop: 10, color: 'var(--danger)', fontSize: 12 }}>{errorText}</div>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Vazgeç
          </button>
          <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={submitting || !selectedPrinterId}>
            {submitting ? 'Gönderiliyor…' : 'Yazdır'}
          </button>
        </div>
      </div>
    </div>
  );
}
