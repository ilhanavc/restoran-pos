import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import PrinterDeleteModal from './PrinterDeleteModal.jsx';
import {
  normalizePrintOptions,
  resetPrintOptionsForType,
  primaryTypeLabel,
  ROLE_LABELS,
  FONT_FAMILY_OPTIONS,
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

function NumField({ label, value, onChange, min = 0, max = 72 }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** 80mm termal hissi; layout/output state ile canlı */
function LivePrinterPreview({ type, printOptions }) {
  const layout = printOptions?.layout || {};
  const output = printOptions?.output || {};
  const groups = printOptions?.kitchenGroups || {};
  const activeGroups = Object.entries(groups)
    .filter(([, v]) => v)
    .map(([k]) => (k === 'ICECEKLER' ? 'İÇECEKLER' : k))
    .join(', ');
  const now = new Date().toLocaleString('tr-TR');
  const pl = Number(layout.marginLeft) || 0;
  const pr = Number(layout.marginRight) || 0;
  const ff = layout.fontFamily || 'Courier New, monospace';

  const boxStyle = {
    fontFamily: ff,
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 12 + pl,
    paddingRight: 12 + pr,
    minHeight: 280,
    maxWidth: '100%',
    width: 'min(100%, 340px)',
    lineHeight: 1.4,
    boxSizing: 'border-box',
  };

  if (type === 'kitchen') {
    const ft = Number(layout.fontSizeTitle) || 14;
    const fi = Number(layout.fontSizeItems) || 13;
    return (
      <div style={boxStyle}>
        <div style={{ color: 'var(--accent, #f97316)', fontWeight: 700, fontSize: ft, marginBottom: 6 }}>MUTFAK</div>
        <div style={{ fontSize: ft - 2, fontWeight: 600 }}>{now}</div>
        <div style={{ fontSize: fi }}>No: 136 · Bahçe | Masa 1</div>
        {activeGroups ? (
          <div style={{ fontSize: fi - 1, marginTop: 4, color: 'var(--text-muted)' }}>[{activeGroups}]</div>
        ) : null}
        <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
        <div style={{ fontSize: fi, fontWeight: 600 }}>Hellim Peynirli Salata</div>
        <div style={{ fontSize: fi, textAlign: 'right' }}>1 Ad</div>
        <div style={{ fontSize: fi - 1, color: 'var(--text-muted)', paddingLeft: 8 }}>Not: az tuzlu</div>
        <div style={{ fontSize: fi, fontWeight: 600, marginTop: 6 }}>Mevsim Salata</div>
        <div style={{ fontSize: fi, textAlign: 'right' }}>2 Ad</div>
        {output.showPrices ? <div style={{ fontSize: fi - 1, marginTop: 6 }}>Fiyat önizleme (açık)</div> : null}
        {output.showOrderTotal ? <div style={{ fontSize: fi - 1 }}>Ara toplam: —</div> : null}
        {output.showOrderNumber !== false ? <div style={{ marginTop: 10, textAlign: 'center', fontSize: fi - 1 }}>- 136 -</div> : null}
        {(layout.footerLine1 || layout.footerLine2) && (
          <div style={{ marginTop: 8, fontSize: (Number(layout.fontSizeFooter) || 12) - 1 }}>
            {layout.footerLine1}
            {layout.footerLine2 ? <div>{layout.footerLine2}</div> : null}
          </div>
        )}
      </div>
    );
  }

  if (type === 'bar') {
    const fi = Number(layout.fontSizeItems) || 13;
    return (
      <div style={boxStyle}>
        <div style={{ color: 'var(--accent)', fontWeight: 700 }}>Bar (legacy)</div>
        <div style={{ fontSize: fi }}>{now}</div>
        <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
        <div style={{ fontSize: fi }}>Ürün × 1</div>
      </div>
    );
  }

  const fh = Number(layout.fontSizeHeader) || 18;
  const fs = Number(layout.fontSizeSubheader) || 13;
  const fi = Number(layout.fontSizeItems) || 13;
  const ftot = Number(layout.fontSizeTotal) || 16;
  const fftr = Number(layout.fontSizeFooter) || 12;

  return (
    <div style={boxStyle}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: fh }}>Demo Restoran</div>
      <div style={{ textAlign: 'center', fontSize: fs, color: 'var(--text-muted)' }}>{now}</div>
      {output.showOrderNumber !== false ? (
        <div style={{ fontSize: fs, marginTop: 4 }}>Adisyon No: 222705187</div>
      ) : null}
      <div style={{ fontSize: fs, fontWeight: 600 }}>Bahçe | Masa 1</div>
      <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
      <div style={{ fontSize: fi, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>Hellim Peynirli Salata</span>
        {output.showPrices ? <span>120,00</span> : <span>1 Tam</span>}
      </div>
      <div style={{ fontSize: fi, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>Mevsim Salata</span>
        {output.showPrices ? <span>85,00</span> : <span>1 Tam</span>}
      </div>
      <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '10px 0' }} />
      {output.showOrderTotal ? <div style={{ fontSize: fi }}>Ara toplam: 325,00</div> : null}
      {output.showVat ? <div style={{ fontSize: fi }}>KDV: 32,50</div> : null}
      <div style={{ marginTop: 6, fontWeight: 700, fontSize: ftot, display: 'flex', justifyContent: 'space-between' }}>
        <span>TOPLAM</span>
        <span>325,00</span>
      </div>
      {layout.footerLine1 ? (
        <div style={{ marginTop: 10, textAlign: 'center', fontWeight: 600, fontSize: fftr }}>{layout.footerLine1}</div>
      ) : null}
      {layout.footerLine2 ? (
        <div style={{ textAlign: 'center', fontSize: fftr, color: 'var(--text-muted)' }}>{layout.footerLine2}</div>
      ) : null}
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
  const [printOptions, setPrintOptions] = useState(() => normalizePrintOptions({}, 'receipt'));

  const showLegacyBar = type === 'bar';

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

  const snapshotState = useCallback((printer, cfg) => {
    const t = printer?.type || 'receipt';
    const po = normalizePrintOptions(printer?.print_options || {}, t);
    const sig = JSON.stringify({
      name: printer?.name ?? '',
      type: t,
      connectionType: printer?.connection_type ?? 'network',
      ip: printer?.ip_address ?? '',
      port: String(printer?.port ?? 9100),
      isActive: printer?.is_active !== false,
      isDefault: cfg?.defaultPrinterId === printer?.id,
      printOptions: po,
    });
    setName(printer?.name ?? '');
    setType(t);
    setConnectionType(printer?.connection_type ?? 'network');
    setIp(printer?.ip_address ?? '');
    setPort(String(printer?.port ?? 9100));
    setIsActive(printer?.is_active !== false);
    setIsDefault(!!cfg?.defaultPrinterId && cfg?.defaultPrinterId === printer?.id);
    setPrintOptions(po);
    setLoadedSig(sig);
  }, []);

  const load = useCallback(async () => {
    if (isNew) {
      const data = await api.getPrinterSettings();
      setConfig(data.config || {});
      const po = normalizePrintOptions({}, 'receipt');
      setName('');
      setType('receipt');
      setConnectionType('network');
      setIp('');
      setPort('9100');
      setIsActive(true);
      setIsDefault(false);
      setPrintOptions(po);
      setLoadedSig(
        JSON.stringify({
          name: '',
          type: 'receipt',
          connectionType: 'network',
          ip: '',
          port: '9100',
          isActive: true,
          isDefault: false,
          printOptions: po,
        }),
      );
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

  const setLayout = (key, val) => {
    setPrintOptions((prev) => ({
      ...prev,
      layout: { ...(prev.layout || {}), [key]: val },
    }));
  };

  const setDevicePhysical = (val) => {
    setPrintOptions((prev) => ({
      ...prev,
      device: { ...(prev.device || {}), physicalName: val || null, source: 'manual' },
    }));
  };

  const setCopy = (key, val) => {
    setPrintOptions((prev) => ({
      ...prev,
      copies: { ...(prev.copies || {}), [key]: Math.max(1, Math.min(9, Number(val) || 1)) },
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
      error('En az bir rol gerekli');
      return;
    }
    let portNum = parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      error('Geçerli bir port girin');
      return;
    }

    const poToSave = {
      ...printOptions,
      output: {
        ...printOptions.output,
        footerNote: printOptions.layout?.footerLine1 ?? printOptions.output?.footerNote ?? '',
      },
    };

    const body = {
      name: n,
      type,
      connection_type: connectionType,
      ip_address: ip.trim() || null,
      port: portNum,
      is_active: isActive,
      print_options: poToSave,
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

  const resetToRecommendedDefaults = () => {
    if (
      !window.confirm(
        'Çıktı ayarları (yazı tipi, boşluklar, toggles, mutfak grupları vb.) bu yazıcı tipi için önerilen varsayılanlara sıfırlanacak. Devam edilsin mi?',
      )
    ) {
      return;
    }
    setPrintOptions(resetPrintOptionsForType(type));
    success('Önerilen varsayılanlar uygulandı');
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

  const physicalName = printOptions.device?.physicalName ?? '';

  return (
    <div className="page-container">
      <SettingsDetailHeader title={isNew ? 'Yeni Yazıcı' : 'Yazıcı Detayı'} onBack={handleBack} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={loading || saving || !dirty}>
          Kaydet
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={testPrint} disabled={loading || testing || isNew} title="Bu kayıtlı yazıcı için test">
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
        <>
          <div
            className="card card-padded"
            style={{
              marginBottom: 16,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'center',
              justifyContent: 'space-between',
              borderColor: 'var(--border)',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 640, lineHeight: 1.5 }}>
              {isNew ? (
                <>
                  <strong style={{ color: 'var(--text-primary)' }}>Önerilen varsayılanlar yüklendi.</strong> Çıktı sütunundaki
                  değerler bu yazıcı tipi için başlangıç önerileridir; kaydetmeden önce özelleştirebilirsiniz.
                </>
              ) : (
                <>
                  Çıktı ayarları bu yazıcı için kayıtlıdır. İsterseniz aynı tip için{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>önerilen varsayılanlara</strong> dönebilirsiniz (aşağıdaki
                  düğme).
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={resetToRecommendedDefaults}
              disabled={loading}
            >
              Varsayılanlara dön
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr) minmax(300px, 380px)',
              gap: 16,
              alignItems: 'start',
            }}
            className="printer-detail-grid"
          >
          <div className="card card-padded" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 14 }}>Yazıcı bilgileri</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Yazıcı adı</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Yazıcı tipi</span>
              <select className="input" value={type} onChange={(e) => setType(e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="receipt">Adisyon</option>
                <option value="kitchen">Mutfak</option>
                {!isNew && showLegacyBar ? <option value="bar">Bar (legacy)</option> : null}
              </select>
              {!isNew && showLegacyBar ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Legacy kayıt. Yeni yazıcı oluştururken yalnızca Adisyon ve Mutfak seçilir.
                </span>
              ) : null}
            </label>
            {isNew ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 14 }}>
                Yeni yazıcıda yalnızca <strong>Adisyon</strong> ve <strong>Mutfak</strong> tipi kullanılır.
              </p>
            ) : null}
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

            <div
              style={{
                marginTop: 18,
                paddingTop: 16,
                borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>Fiziksel yazıcı eşleştirmesi</div>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-primary)' }}>Bu yazıcı hangi cihaza yazdıracak?</strong> POS bu profille
                yazdırdığında, Windows tarafında hedef olarak hangi yazıcının kullanılacağını buradan belirlersiniz.
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Eşleştirme yöntemi</span>
                <select className="input" value="manual" disabled style={{ cursor: 'not-allowed', opacity: 0.85 }}>
                  <option value="manual">Manuel giriş (Windows yazıcı adı)</option>
                </select>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  İleride listeden seçim eklendiğinde bu alan genişletilecektir.
                </span>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Windows&apos;ta görünen yazıcı adı
                </span>
                <input
                  className="input"
                  value={physicalName}
                  onChange={(e) => setDevicePhysical(e.target.value)}
                  placeholder="Örn: EPSON TM-T20 veya Ayarlar &gt; Yazıcılar listesindeki ad"
                  autoComplete="off"
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  Denetim Masası veya Ayarlar → <strong>Yazıcılar ve tarayıcılar</strong> ekranındaki adla birebir aynı olmalıdır.
                  Bu isim, yazdırma sırasında işletim sisteminin hangi fiziksel cihaza göndereceğini ayırt etmek için kullanılır.
                </span>
              </label>
            </div>

            {type === 'kitchen' ? (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>Mutfak grubu</div>
                {Object.keys(printOptions.kitchenGroups || {}).map((key) => (
                  <ToggleRow
                    key={key}
                    label={key === 'ICECEKLER' ? 'İÇECEKLER' : key}
                    checked={!!printOptions.kitchenGroups[key]}
                    onChange={(v) => setKitchenGroup(key, v)}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div
            className="card card-padded printer-detail-output-col"
            style={{ minWidth: 0, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Çıktı / kağıt ayarları</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {type === 'receipt' ? 'Adisyon çıktısı' : type === 'kitchen' ? 'Mutfak çıktısı' : 'Bar (legacy)'}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Yazı tipi (önizleme)</span>
              <select
                className="input"
                value={printOptions.layout?.fontFamily || 'Courier New'}
                onChange={(e) => setLayout('fontFamily', e.target.value)}
              >
                {FONT_FAMILY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {type === 'receipt' && (
              <>
                <NumField label="Başlık yazı boyutu (px)" value={printOptions.layout?.fontSizeHeader ?? 18} onChange={(v) => setLayout('fontSizeHeader', v)} />
                <NumField label="Alt başlık / meta (px)" value={printOptions.layout?.fontSizeSubheader ?? 13} onChange={(v) => setLayout('fontSizeSubheader', v)} />
                <NumField label="Ürün listesi (px)" value={printOptions.layout?.fontSizeItems ?? 13} onChange={(v) => setLayout('fontSizeItems', v)} />
                <NumField label="Toplam satırı (px)" value={printOptions.layout?.fontSizeTotal ?? 16} onChange={(v) => setLayout('fontSizeTotal', v)} />
                <NumField label="Alt yazı (px)" value={printOptions.layout?.fontSizeFooter ?? 12} onChange={(v) => setLayout('fontSizeFooter', v)} />
                <NumField label="Sol boşluk (px)" value={printOptions.layout?.marginLeft ?? 8} onChange={(v) => setLayout('marginLeft', v)} max={48} />
                <NumField label="Sağ boşluk (px)" value={printOptions.layout?.marginRight ?? 8} onChange={(v) => setLayout('marginRight', v)} max={48} />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Alt yazı 1</span>
                  <input
                    className="input"
                    value={printOptions.layout?.footerLine1 ?? ''}
                    onChange={(e) => setLayout('footerLine1', e.target.value)}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Alt yazı 2. satır</span>
                  <input
                    className="input"
                    value={printOptions.layout?.footerLine2 ?? ''}
                    onChange={(e) => setLayout('footerLine2', e.target.value)}
                  />
                </label>
                <ToggleRow label="KDV göster" checked={!!printOptions.output.showVat} onChange={(v) => setOutput('showVat', v)} />
                <ToggleRow label="Sipariş numarası göster" checked={printOptions.output.showOrderNumber !== false} onChange={(v) => setOutput('showOrderNumber', v)} />
                <ToggleRow label="Ürün fiyatları göster" checked={!!printOptions.output.showPrices} onChange={(v) => setOutput('showPrices', v)} />
                <ToggleRow label="Sipariş toplamları göster" checked={!!printOptions.output.showOrderTotal} onChange={(v) => setOutput('showOrderTotal', v)} />
                <ToggleRow label="Sipariş kaydedilince yazdır (planlı)" checked={!!printOptions.printOnSave} onChange={(v) => setPrintOptions((p) => ({ ...p, printOnSave: v }))} />
                <ToggleRow
                  label="Entegrasyon onayında yazdır (planlı)"
                  checked={!!printOptions.printOnIntegrationApprove}
                  onChange={(v) => setPrintOptions((p) => ({ ...p, printOnIntegrationApprove: v }))}
                />
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '12px 0 6px' }}>Nüsha (özet)</div>
                <NumField label="Masa siparişi" value={printOptions.copies?.dine_in ?? 1} onChange={(v) => setCopy('dine_in', v)} max={9} />
                <NumField label="Paket / gel-al" value={printOptions.copies?.takeaway ?? 1} onChange={(v) => setCopy('takeaway', v)} max={9} />
                <NumField label="Teslimat (rezerv)" value={printOptions.copies?.delivery ?? 1} onChange={(v) => setCopy('delivery', v)} max={9} />
                <NumField label="Ödeme sonrası" value={printOptions.copies?.after_payment ?? 1} onChange={(v) => setCopy('after_payment', v)} max={9} />
              </>
            )}

            {type === 'kitchen' && (
              <>
                <NumField label="Başlık yazı boyutu (px)" value={printOptions.layout?.fontSizeTitle ?? 15} onChange={(v) => setLayout('fontSizeTitle', v)} />
                <NumField label="Ürün listesi (px)" value={printOptions.layout?.fontSizeItems ?? 14} onChange={(v) => setLayout('fontSizeItems', v)} />
                <NumField label="Sol boşluk (px)" value={printOptions.layout?.marginLeft ?? 6} onChange={(v) => setLayout('marginLeft', v)} max={48} />
                <NumField label="Sağ boşluk (px)" value={printOptions.layout?.marginRight ?? 6} onChange={(v) => setLayout('marginRight', v)} max={48} />
                <ToggleRow label="Ürün fiyatları" checked={!!printOptions.output.showPrices} onChange={(v) => setOutput('showPrices', v)} />
                <ToggleRow label="Sipariş toplamları" checked={!!printOptions.output.showOrderTotal} onChange={(v) => setOutput('showOrderTotal', v)} />
                <ToggleRow label="Sipariş numarası" checked={printOptions.output.showOrderNumber !== false} onChange={(v) => setOutput('showOrderNumber', v)} />
              </>
            )}

            {type === 'bar' && (
              <>
                <ToggleRow label="Ürün fiyatları" checked={!!printOptions.output.showPrices} onChange={(v) => setOutput('showPrices', v)} />
                <ToggleRow label="Sipariş toplamları" checked={!!printOptions.output.showOrderTotal} onChange={(v) => setOutput('showOrderTotal', v)} />
                <ToggleRow label="Sipariş numarası" checked={printOptions.output.showOrderNumber !== false} onChange={(v) => setOutput('showOrderNumber', v)} />
                <ToggleRow label="KDV göster" checked={!!printOptions.output.showVat} onChange={(v) => setOutput('showVat', v)} />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Alt yazı / not</span>
                  <textarea
                    className="input"
                    rows={2}
                    value={printOptions.output.footerNote || ''}
                    onChange={(e) => setOutput('footerNote', e.target.value)}
                  />
                </label>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '14px 0 10px' }}>Roller (legacy)</div>
                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                  <ToggleRow
                    key={key}
                    label={label}
                    checked={!!printOptions.roles[key]}
                    onChange={(v) => setRole(key, v)}
                    disabled={key === 'bar'}
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
              </>
            )}
          </div>

          <div
            className="printer-detail-preview-sticky"
            style={{
              position: 'sticky',
              top: 72,
              alignSelf: 'start',
              minWidth: 300,
              width: '100%',
              maxHeight: 'calc(100vh - 88px)',
              overflowY: 'auto',
            }}
          >
            <div className="card card-padded">
              <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Çıktı önizlemesi</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Tür: <strong>{primaryTypeLabel(type)}</strong>
                <span style={{ display: 'block', marginTop: 4 }}>
                  Gerçek yazdırma ile birebir olmayabilir; boyut ve boşluklar yaklaşık gösterilir.
                </span>
              </div>
              <LivePrinterPreview type={type} printOptions={printOptions} />
            </div>
          </div>
        </div>
        </>
      )}

      <PrinterDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        printerId={id}
        printerName={name}
        onAfterDeactivate={() => navigate('/settings/printers')}
        onAfterDelete={() => navigate('/settings/printers')}
      />
      <style>{`
        @media (max-width: 768px) {
          .printer-detail-grid {
            grid-template-columns: 1fr !important;
          }
          .printer-detail-preview-sticky {
            position: static !important;
            max-height: none !important;
            min-width: 0 !important;
            overflow: visible !important;
          }
          .printer-detail-output-col {
            max-height: none !important;
          }
        }
      `}</style>
    </div>
  );
}
