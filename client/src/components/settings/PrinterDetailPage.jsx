import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import PrinterDeleteModal from './PrinterDeleteModal.jsx';
import {
  createEmptyPrintOptions,
  normalizePrintOptions,
  primaryTypeLabel,
  ROLE_LABELS,
} from './printerDefaults.js';

function ToggleRow({ label, checked, onChange, disabled }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid var(--border)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
    </label>
  );
}

function ReceiptPreview({ type, printOptions }) {
  const o = printOptions?.output || {};
  const groups = printOptions?.kitchenGroups || {};
  const activeGroups = Object.entries(groups)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ');
  const now = new Date().toLocaleString('tr-TR');

  if (type === 'kitchen') {
    return (
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          lineHeight: 1.45,
          color: 'var(--text-primary)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 14,
          minHeight: 280,
        }}
      >
        <div style={{ color: 'var(--accent, #f97316)', fontWeight: 700, marginBottom: 8 }}>Mutfak önizleme</div>
        <div style={{ fontWeight: 700 }}>{now}</div>
        <div>Adisyon No: 222705187</div>
        <div>Bahçe | Masa 1</div>
        {activeGroups ? <div style={{ marginTop: 6 }}>Gruplar: {activeGroups}</div> : null}
        <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
        <div>Hellim Peynirli Salata × 1</div>
        <div>Mevsim Salata × 1</div>
        {o.showOrderNumber !== false ? <div style={{ marginTop: 12, textAlign: 'center' }}>- 136 -</div> : null}
        {o.footerNote ? <div style={{ marginTop: 8, fontSize: 11 }}>{o.footerNote}</div> : null}
      </div>
    );
  }

  if (type === 'bar') {
    return (
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          lineHeight: 1.45,
          color: 'var(--text-primary)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 14,
          minHeight: 280,
        }}
      >
        <div style={{ color: 'var(--accent, #f97316)', fontWeight: 700, marginBottom: 8 }}>Bar / içecek</div>
        <div>{now}</div>
        <div>Masa 12</div>
        <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
        <div>Filtre Kahve × 2</div>
        <div>Ayran × 1</div>
        {o.footerNote ? <div style={{ marginTop: 10, fontSize: 11 }}>{o.footerNote}</div> : null}
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 1.45,
        color: 'var(--text-primary)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        minHeight: 280,
      }}
    >
      <div style={{ textAlign: 'center', fontWeight: 700 }}>Demo Restoran</div>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>{now}</div>
      <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
      <div>Ürün A × 2 {o.showPrices ? '120,00' : ''}</div>
      <div>Ürün B × 1 {o.showPrices ? '85,00' : ''}</div>
      <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
      {o.showOrderTotal ? <div>Ara toplam: 325,00</div> : null}
      {o.showVat ? <div>KDV: 32,50</div> : null}
      {o.showOrderNumber ? <div>Sipariş No: 222705187</div> : null}
      <div style={{ marginTop: 8, fontWeight: 700 }}>TOPLAM: 325,00</div>
      {o.footerNote ? <div style={{ marginTop: 10, fontSize: 11 }}>{o.footerNote}</div> : null}
    </div>
  );
}

export default function PrinterDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error } = useToast();
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loadedSig, setLoadedSig] = useState('');
  const [config, setConfig] = useState({ defaultPrinterId: null });

  const [name, setName] = useState('');
  const [type, setType] = useState('receipt');
  const [connectionType, setConnectionType] = useState('network');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('9100');
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [printOptions, setPrintOptions] = useState(() => normalizePrintOptions(createEmptyPrintOptions(), 'receipt'));

  const dirty = useMemo(() => {
    const sig = JSON.stringify({
      name,
      type,
      connectionType,
      ip,
      port,
      isActive,
      isDefault,
      printOptions,
    });
    return sig !== loadedSig;
  }, [name, type, connectionType, ip, port, isActive, isDefault, printOptions, loadedSig]);

  const snapshotState = useCallback(
    (printer, cfg) => {
      const po = normalizePrintOptions(printer?.print_options || createEmptyPrintOptions(), printer?.type || 'receipt');
      const sig = JSON.stringify({
        name: printer?.name ?? '',
        type: printer?.type ?? 'receipt',
        connectionType: printer?.connection_type ?? 'network',
        ip: printer?.ip_address ?? '',
        port: String(printer?.port ?? 9100),
        isActive: printer?.is_active !== false,
        isDefault: cfg?.defaultPrinterId === printer?.id,
        printOptions: po,
      });
      setName(printer?.name ?? '');
      setType(printer?.type ?? 'receipt');
      setConnectionType(printer?.connection_type ?? 'network');
      setIp(printer?.ip_address ?? '');
      setPort(String(printer?.port ?? 9100));
      setIsActive(printer?.is_active !== false);
      setIsDefault(cfg?.defaultPrinterId === printer?.id);
      setPrintOptions(po);
      setLoadedSig(sig);
    },
    [],
  );

  const load = useCallback(async () => {
    if (isNew) {
      const data = await api.getPrinterSettings();
      setConfig(data.config || {});
      snapshotState(null, data.config);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [prRes, settings] = await Promise.all([api.getAdminPrinter(id), api.getPrinterSettings()]);
      setConfig(settings.config || {});
      snapshotState(prRes.printer, settings.config);
    } catch (e) {
      error(e.message || 'Yazıcı yüklenemedi');
      navigate('/settings/printers');
    } finally {
      setLoading(false);
    }
  }, [error, id, isNew, navigate, snapshotState]);

  useEffect(() => {
    load();
  }, [load]);

  const setRole = (key, val) => {
    setPrintOptions((prev) => {
      const next = {
        ...prev,
        roles: { ...prev.roles, [key]: val },
      };
      const pk = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
      next.roles[pk] = true;
      return next;
    });
  };

  const setKitchenGroup = (key, val) => {
    setPrintOptions((prev) => ({
      ...prev,
      kitchenGroups: { ...prev.kitchenGroups, [key]: val },
    }));
  };

  const setOutput = (key, val) => {
    setPrintOptions((prev) => ({
      ...prev,
      output: { ...prev.output, [key]: val },
    }));
  };

  const handleBack = () => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikler var. Çıkmak istiyor musunuz?')) return;
    navigate('/settings/printers');
  };

  const save = async () => {
    const n = name.trim();
    if (!n) {
      error('Yazıcı adı zorunludur');
      return;
    }
    const r = printOptions.roles;
    if (!r.receipt && !r.kitchen && !r.bar) {
      error('En az bir rol seçin (Adisyon, Mutfak veya Bar)');
      return;
    }
    let portNum = parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      error('Geçerli bir port girin');
      return;
    }

    const body = {
      name: n,
      type,
      connection_type: connectionType,
      ip_address: ip.trim() || null,
      port: portNum,
      is_active: isActive,
      print_options: printOptions,
    };

    setSaving(true);
    try {
      let printerId = id;
      if (isNew) {
        const res = await api.postAdminPrinter(body);
        printerId = res.printer?.id;
        success(res.message || 'Yazıcı oluşturuldu');
      } else {
        const res = await api.patchAdminPrinter(id, body);
        success(res.message || 'Yazıcı güncellendi');
      }

      const settingsBody = {};
      if (isDefault && printerId) {
        settingsBody.defaultPrinterId = printerId;
      } else if (!isNew && !isDefault && config.defaultPrinterId === id) {
        settingsBody.defaultPrinterId = null;
      }
      if (Object.keys(settingsBody).length > 0) {
        await api.patchPrinterSettings(settingsBody);
      }

      await load();
      if (isNew && printerId) navigate(`/settings/printers/${printerId}`, { replace: true });
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  const testPrint = async () => {
    if (isNew) {
      error('Önce yazıcıyı kaydedin.');
      return;
    }
    setTesting(true);
    try {
      const res = await api.postPrinterTest({ printer_id: id });
      success(res.message || 'Test tamamlandı');
    } catch (e) {
      error(e.message || 'Test başarısız');
    } finally {
      setTesting(false);
    }
  };

  const deactivate = async () => {
    if (isNew) return;
    if (!window.confirm('Bu yazıcı pasifleştirilsin mi?')) return;
    try {
      await api.patchAdminPrinter(id, { is_active: false });
      success('Yazıcı pasifleştirildi');
      navigate('/settings/printers');
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  useEffect(() => {
    setPrintOptions((prev) => normalizePrintOptions(prev, type));
  }, [type]);

  return (
    <div className="page-container">
      <SettingsDetailHeader title={isNew ? 'Yeni Yazıcı' : 'Yazıcı Detayı'} onBack={handleBack} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={loading || saving || !dirty}>
          Kaydet
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={testPrint} disabled={loading || testing || isNew}>
          {testing ? 'Test…' : 'Test çıktısı'}
        </button>
        {!isNew && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={deactivate} disabled={!isActive}>
            Pasif yap
          </button>
        )}
        {!isNew && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteOpen(true)}>
            Sil
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div className="card card-padded">
            <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 14 }}>Yazıcı bilgileri</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Yazıcı adı</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Birincil tür (önizleme / birincil rol)</span>
              <select className="input" value={type} onChange={(e) => setType(e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="receipt">Adisyon (fiş)</option>
                <option value="kitchen">Mutfak</option>
                <option value="bar">Bar</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Bağlantı</span>
              <select
                className="input"
                value={connectionType}
                onChange={(e) => setConnectionType(e.target.value)}
                style={{ cursor: 'pointer' }}
              >
                <option value="network">Ağ (Ethernet / Wi‑Fi)</option>
                <option value="usb">USB</option>
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10, marginBottom: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>IP adresi</span>
                <input className="input" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.100" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Port</span>
                <input className="input" value={port} onChange={(e) => setPort(e.target.value)} />
              </label>
            </div>
            <ToggleRow label="Aktif" checked={isActive} onChange={setIsActive} />
            <ToggleRow label="Varsayılan yazıcı" checked={isDefault} onChange={setIsDefault} />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
              Birincil tür veritabanında <code>type</code> alanına yazılır; ek roller aşağıda.
            </p>
          </div>

          <div className="card card-padded">
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Kullanım / çıktı</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Roller</div>
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <ToggleRow
                key={key}
                label={label}
                checked={!!printOptions.roles[key]}
                onChange={(v) => setRole(key, v)}
                disabled={key === (type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar')}
              />
            ))}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 10px' }}>Mutfak grupları</div>
            {Object.keys(printOptions.kitchenGroups || {}).map((key) => (
              <ToggleRow
                key={key}
                label={key === 'ICECEKLER' ? 'İÇECEKLER' : key}
                checked={!!printOptions.kitchenGroups[key]}
                onChange={(v) => setKitchenGroup(key, v)}
              />
            ))}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 10px' }}>Çıktı seçenekleri</div>
            <ToggleRow label="Ürün fiyatları" checked={!!printOptions.output.showPrices} onChange={(v) => setOutput('showPrices', v)} />
            <ToggleRow label="Sipariş toplamı" checked={!!printOptions.output.showOrderTotal} onChange={(v) => setOutput('showOrderTotal', v)} />
            <ToggleRow label="Sipariş numarası" checked={!!printOptions.output.showOrderNumber} onChange={(v) => setOutput('showOrderNumber', v)} />
            <ToggleRow label="KDV göster" checked={!!printOptions.output.showVat} onChange={(v) => setOutput('showVat', v)} />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Alt yazı / not</span>
              <textarea
                className="input"
                rows={2}
                value={printOptions.output.footerNote || ''}
                onChange={(e) => setOutput('footerNote', e.target.value)}
                placeholder="Teşekkür mesajı vb."
              />
            </label>
          </div>

          <div className="card card-padded">
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Çıktı önizleme</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Birincil tür: <strong>{primaryTypeLabel(type)}</strong>
            </div>
            <ReceiptPreview type={type} printOptions={printOptions} />
          </div>
        </div>
      )}

      <PrinterDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        printerId={id}
        printerName={name}
        onAfterDeactivate={() => navigate('/settings/printers')}
        onAfterDelete={() => navigate('/settings/printers')}
      />
    </div>
  );
}
