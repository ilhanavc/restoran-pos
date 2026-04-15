import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import PrinterDeleteModal from './PrinterDeleteModal.jsx';
import {
  normalizePrintOptions,
  resetPrintOptionsForType,
  primaryTypeLabel,
  FONT_FAMILY_OPTIONS,
} from './printerDefaults.js';
import { getDiscoveryUiMeta, toneColor } from './printerDiscoveryStatus.js';

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

function TypePill({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
      style={{ minWidth: 108 }}
    >
      {label}
    </button>
  );
}

function SectionTab({ active, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className={active ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}>
      {label}
    </button>
  );
}

/** Sunucuda store-bridge ile aynı güvenli satır üreticisini kullanır. */
function PrinterPreviewPanel({ type, lineWidth, printOptions }) {
  const layout = printOptions?.layout || {};
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState(null);
  const timerRef = useRef(null);

  const previewKind = type === 'receipt' ? 'receipt' : type === 'bar' ? 'bar' : 'kitchen';
  const printOptionsSig = useMemo(() => JSON.stringify(printOptions ?? {}), [printOptions]);

  const lw = useMemo(() => {
    const n = parseInt(String(lineWidth ?? '').trim(), 10);
    if (Number.isFinite(n) && n >= 32 && n <= 42) return n;
    return 42;
  }, [lineWidth]);

  const fi = Number(layout.fontSizeItems) || 13;
  const ff = layout.fontFamily || 'Courier New, monospace';

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(true);
    setFetchErr(null);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await api.postAdminPrinterPreview({
          type: previewKind,
          line_width: lineWidth === '' || lineWidth == null ? null : lineWidth,
          print_options: printOptions,
        });
        setLines(Array.isArray(data.lines) ? data.lines : []);
      } catch (e) {
        setFetchErr(e.message || 'Önizleme yüklenemedi');
        setLines([]);
      } finally {
        setLoading(false);
      }
    }, 320);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [previewKind, lineWidth, printOptionsSig]);

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <div
        className="printer-preview-paper"
        style={{
          background: '#f4f4f4',
          color: '#141414',
          border: '1px solid #bdbdbd',
          borderRadius: 6,
          padding: '14px 12px',
          maxWidth: '100%',
          width: `${lw}ch`,
          minWidth: 0,
          boxSizing: 'content-box',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Önizleme güncelleniyor…</div>
        ) : null}
        {!loading && fetchErr ? (
          <div style={{ fontSize: 13, color: 'var(--danger, #ef4444)' }}>{fetchErr}</div>
        ) : null}
        {!loading && !fetchErr ? (
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: ff,
              fontSize: fi,
              lineHeight: 1.35,
            }}
          >
            {lines.join('\n')}
          </pre>
        ) : null}
      </div>
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
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();
  const [loadedSig, setLoadedSig] = useState('');
  const [config, setConfig] = useState({ defaultPrinterId: null });

  const [name, setName] = useState('');
  const [type, setType] = useState('receipt');
  const [connectionType, setConnectionType] = useState('network');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('9100');
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryState, setDiscoveryState] = useState('never_scanned');
  const [discoveryLastErrorCode, setDiscoveryLastErrorCode] = useState(null);
  const [discoveryUpdatedAt, setDiscoveryUpdatedAt] = useState('');
  const [discoveredPrinters, setDiscoveredPrinters] = useState([]);
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [lineWidth, setLineWidth] = useState('');
  const [escT, setEscT] = useState('');
  const [skipInit, setSkipInit] = useState(false);
  const [skipPhoenixCmd, setSkipPhoenixCmd] = useState(true);
  const [encodingMode, setEncodingMode] = useState('win1254');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('general');
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
      lineWidth,
      escT,
      skipInit,
      skipPhoenixCmd,
      encodingMode,
      printOptions,
    });
    return sig !== loadedSig;
  }, [name, type, connectionType, ip, port, isActive, isDefault, lineWidth, escT, skipInit, skipPhoenixCmd, encodingMode, printOptions, loadedSig]);

  const snapshotState = useCallback((printer, cfg) => {
    const t = printer?.type || 'receipt';
    const po = normalizePrintOptions(printer?.print_options || {}, t);
    const lw = printer?.line_width ? String(printer.line_width) : '';
    const rawPo = printer?.print_options || {};
    const et = rawPo.escT != null ? String(rawPo.escT) : '';
    const si = !!rawPo.skipInit;
    const spc = rawPo.skipPhoenixCmd !== false;
    const em = rawPo.encodingMode === 'pc857' ? 'pc857' : 'win1254';
    const sig = JSON.stringify({
      name: printer?.name ?? '',
      type: t,
      connectionType: printer?.connection_type ?? 'network',
      ip: printer?.ip_address ?? '',
      port: String(printer?.port ?? 9100),
      isActive: printer?.is_active !== false,
      isDefault: cfg?.defaultPrinterId === printer?.id,
      lineWidth: lw,
      escT: et,
      skipInit: si,
      skipPhoenixCmd: spc,
      encodingMode: em,
      printOptions: po,
    });
    setName(printer?.name ?? '');
    setType(t);
    setConnectionType(printer?.connection_type ?? 'network');
    setIp(printer?.ip_address ?? '');
    setPort(String(printer?.port ?? 9100));
    setIsActive(printer?.is_active !== false);
    setIsDefault(!!cfg?.defaultPrinterId && cfg?.defaultPrinterId === printer?.id);
    setLineWidth(lw);
    setEscT(et);
    setSkipInit(si);
    setSkipPhoenixCmd(spc);
    setEncodingMode(em);
    setPrintOptions(po);
    setLoadedSig(sig);
  }, []);

  const fetchDiscoveredPrinters = useCallback(async () => {
    const data = await api.getDiscoveredPrinters();
    const list = Array.isArray(data.printers) ? data.printers : [];
    setDiscoveredPrinters(list);
    setDiscoveryUpdatedAt(data.updatedAt || '');
    setDiscoveryState(data.scanState || 'never_scanned');
    setDiscoveryLastErrorCode(data.lastErrorCode || null);
    return data;
  }, []);

  const loadDiscoveredPrinters = useCallback(
    async (opts = { triggerRefresh: false }) => {
      const triggerRefresh = !!opts?.triggerRefresh;
      setDiscoveryLoading(true);
      try {
        if (triggerRefresh) {
          const refreshRes = await api.refreshDiscoveredPrinters();
          setDiscoveryState(refreshRes.scanState || 'scanning');
          setDiscoveryLastErrorCode(null);
        }
        let data = await fetchDiscoveredPrinters();
        if (triggerRefresh) {
          const terminalStates = new Set(['success', 'empty', 'bridge_unreachable', 'auth_error', 'bridge_unconfigured']);
          let attempts = 0;
          while (!terminalStates.has(data.scanState)) {
            if (attempts >= 12) break;
            attempts += 1;
            await new Promise((resolve) => setTimeout(resolve, 1500));
            data = await fetchDiscoveredPrinters();
          }
        }
      } catch (e) {
        const isUnconfigured = String(e?.message || '').toLowerCase().includes('yapılandırması eksik');
        const fallbackState = isUnconfigured ? 'bridge_unconfigured' : 'bridge_unreachable';
        const fallbackCode = isUnconfigured ? 'bridge_not_configured' : 'bridge_unreachable';
        setDiscoveryState(fallbackState);
        setDiscoveryLastErrorCode(fallbackCode);
      } finally {
        setDiscoveryLoading(false);
      }
    },
    [discoveredPrinters, fetchDiscoveredPrinters, printOptions?.device?.physicalName],
  );

  const load = useCallback(async () => {
    if (isNew) {
      const [data] = await Promise.all([api.getPrinterSettings(), loadDiscoveredPrinters({ triggerRefresh: false })]);
      setConfig(data.config || {});
      const po = normalizePrintOptions({}, 'receipt');
      setName('');
      setType('receipt');
      setConnectionType('network');
      setIp('');
      setPort('9100');
      setIsActive(true);
      setIsDefault(false);
      setSkipPhoenixCmd(true);
      setEncodingMode('win1254');
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
      const [prRes, settings] = await Promise.all([
        api.getAdminPrinter(id),
        api.getPrinterSettings(),
        loadDiscoveredPrinters({ triggerRefresh: false }),
      ]);
      setConfig(settings.config || {});
      snapshotState(prRes.printer, settings.config);
    } catch (e) {
      error(e.message || 'Yazıcı yüklenemedi');
      navigate('/settings/printers', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [error, id, isNew, navigate, snapshotState, loadDiscoveredPrinters]);

  useEffect(() => {
    load();
  }, [load]);

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

  const setAutoPrint = (key, val) => {
    setPrintOptions((prev) => ({
      ...prev,
      autoPrint: { ...(prev.autoPrint || {}), [key]: val },
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

  const handleBack = () => {
    if (dirty) {
      requestConfirm({
        title: 'Kaydedilmemiş değişiklikler var',
        body: 'Yazıcı ayarlarındaki değişiklikler kaybolacak. Çıkmak istiyor musunuz?',
        confirmLabel: 'Çık',
        tone: 'danger',
        onConfirm: () => navigate('/settings/printers', { replace: true }),
      });
      return;
    }
    navigate('/settings/printers', { replace: true });
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
    const selectedPhysical = (printOptions.device?.physicalName || '').trim();
    if (!selectedPhysical) {
      error('Taranan yazıcılar listesinden bir yazıcı seçin');
      return;
    }
    let portNum = parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      portNum = 9100;
    }

    const escTRaw = String(escT || '').trim();
    const escTNum = parseInt(escTRaw, 10);
    const poToSave = {
      ...printOptions,
      output: {
        ...printOptions.output,
        footerNote: printOptions.layout?.footerLine1 ?? printOptions.output?.footerNote ?? '',
      },
      escT: escTRaw === '' ? null : Number.isFinite(escTNum) && escTNum >= 0 && escTNum <= 255 ? escTNum : undefined,
      skipInit,
      skipPhoenixCmd,
      encodingMode: encodingMode === 'pc857' ? 'pc857' : 'win1254',
    };

    const lwNum = parseInt(lineWidth, 10);
    const body = {
      name: n,
      type,
      connection_type: connectionType,
      ip_address: ip.trim() || null,
      port: portNum,
      is_active: isActive,
      line_width: Number.isFinite(lwNum) && lwNum >= 32 && lwNum <= 42 ? lwNum : null,
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
      success(res.message || 'Test çıktısı kuyruğa alındı');
    } catch (e) {
      error(e.message || 'Test başarısız');
    } finally {
      setTesting(false);
    }
  };

  const resetToRecommendedDefaults = () => {
    requestConfirm({
      title: 'Çıktı ayarları sıfırlansın mı?',
      body: 'Yazı tipi, boşluklar, roller ve mutfak grupları bu yazıcı tipi için önerilen varsayılanlara dönecek.',
      confirmLabel: 'Sıfırla',
      tone: 'danger',
      onConfirm: () => {
        setPrintOptions(resetPrintOptionsForType(type));
        setEscT('');
        setSkipPhoenixCmd(true);
        setEncodingMode('win1254');
        success('Önerilen varsayılanlar uygulandı');
      },
    });
  };

  const deactivate = async () => {
    if (isNew) return;
    requestConfirm({
      title: 'Yazıcı pasifleştirilsin mi?',
      body: 'Bu yazıcı aktif yazıcı listesinden çıkarılacak. Daha sonra tekrar aktifleştirilebilir.',
      confirmLabel: 'Pasifleştir',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.patchAdminPrinter(id, { is_active: false });
          success('Yazıcı pasifleştirildi');
          navigate('/settings/printers');
        } catch (e) {
          error(e.message || 'İşlem başarısız');
        }
      },
    });
  };

  useEffect(() => {
    setPrintOptions((prev) => normalizePrintOptions(prev, type));
  }, [type]);

  const physicalName = printOptions.device?.physicalName ?? '';
  const typeBehaviorText =
    type === 'kitchen'
      ? 'Mutfak modu aktif: operasyonel ve sade çıktı ayarları öne çıkar.'
      : type === 'bar'
        ? 'Legacy Bar modu: mevcut kayıtlar için uyumluluk modunda düzenleme.'
        : 'Adisyon modu aktif: fiş görünümü ve ödeme çıktısı ayarları öne çıkar.';
  const roleLabel = type === 'kitchen' ? 'Mutfak yazıcısı' : type === 'receipt' ? 'Müşteri fişi yazıcısı' : 'Legacy yazıcı';
  const discoveryMeta = useMemo(
    () =>
      getDiscoveryUiMeta({
        scanState: discoveryState,
        lastErrorCode: discoveryLastErrorCode,
        printers: discoveredPrinters,
        hasSelectedPhysical: !!String(physicalName || '').trim(),
      }),
    [discoveredPrinters, discoveryLastErrorCode, discoveryState, physicalName],
  );

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
          <div className="card card-padded" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{roleLabel}</strong> ayarlarını adım adım düzenleyin.
                Teknik seçenekler yalnızca <strong>Gelişmiş</strong> bölümünde tutulur.
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetToRecommendedDefaults} disabled={loading}>
                Önerilen ayarları uygula
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <SectionTab active={activeSection === 'general'} label="Genel" onClick={() => setActiveSection('general')} />
            <SectionTab active={activeSection === 'preferences'} label="Tercihler" onClick={() => setActiveSection('preferences')} />
            <SectionTab active={activeSection === 'preview'} label="Önizleme ve Test" onClick={() => setActiveSection('preview')} />
            <SectionTab active={activeSection === 'advanced'} label="Gelişmiş" onClick={() => setActiveSection('advanced')} />
          </div>

          {activeSection === 'general' && (
            <div className="card card-padded" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>Genel</div>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Yazıcı adı, rolü, bağlı cihazı ve aktiflik durumu burada yönetilir.
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Yazıcı adı</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Rol</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <TypePill active={type === 'receipt'} onClick={() => setType('receipt')} label="Müşteri fişi yazıcısı" />
                  <TypePill active={type === 'kitchen'} onClick={() => setType('kitchen')} label="Mutfak yazıcısı" />
                  {!isNew && showLegacyBar ? (
                    <TypePill active={type === 'bar'} onClick={() => setType('bar')} label="Legacy bar" />
                  ) : null}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{typeBehaviorText}</span>
              </label>

              <ToggleRow label="Bu yazıcı aktif olarak kullanılsın" checked={isActive} onChange={setIsActive} />
              <ToggleRow label="Müşteri fişi varsayılan yazıcısı olsun" checked={isDefault} onChange={setIsDefault} disabled={type !== 'receipt'} />

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>Bağlı cihaz seçimi</div>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
                  Bu profilin çıktıyı göndereceği fiziksel yazıcıyı seçin.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => loadDiscoveredPrinters({ triggerRefresh: true })}
                    disabled={discoveryLoading}
                  >
                    {discoveryLoading ? 'Taranıyor…' : 'Yazıcıları Yenile'}
                  </button>
                  {discoveryUpdatedAt ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Son tarama: {new Date(discoveryUpdatedAt).toLocaleString('tr-TR')}
                    </span>
                  ) : null}
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Seçili fiziksel cihaz</span>
                  <select
                    className="input"
                    value={physicalName}
                    onChange={(e) => {
                      const selectedName = e.target.value;
                      setDevicePhysical(selectedName);
                      const found = discoveredPrinters.find((p) => p.name === selectedName);
                      if (found) {
                        if (found.connectionType) setConnectionType(found.connectionType);
                        if (found.ipAddress) setIp(found.ipAddress);
                      }
                    }}
                    disabled={discoveryLoading}
                    style={{ cursor: 'pointer' }}
                  >
                    <option value="">Cihaz seçin</option>
                    {physicalName && !discoveredPrinters.some((p) => p.name === physicalName) ? (
                      <option value={physicalName}>{physicalName} (kayıtlı)</option>
                    ) : null}
                    {discoveredPrinters.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                        {p.connectionType === 'network' && p.ipAddress ? ` — ${p.ipAddress}` : ''}
                        {p.connectionType === 'usb' ? ' [USB]' : ''}
                        {p.isDefault ? ' (Varsayılan)' : ''}
                        {p.isOnline === false ? ' (Pasif)' : ''}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: physicalName.trim() ? 'var(--success, #16a34a)' : 'var(--text-muted)' }}>
                    {physicalName.trim() ? 'Durum: Cihaz seçimi tamamlandı' : 'Durum: Cihaz seçilmedi'}
                  </span>
                  {discoveryMeta?.text ? (
                    <span
                      style={{
                        fontSize: 11,
                        color: toneColor(discoveryMeta.tone),
                      }}
                    >
                      {discoveryMeta.text}
                    </span>
                  ) : null}
                  {discoveryMeta?.detail ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {discoveryMeta.detail}
                    </span>
                  ) : null}
                </label>
              </div>
            </div>
          )}

          {activeSection === 'preferences' && (
            <div className="card card-padded" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 15 }}>Tercihler</div>
              <p style={{ marginTop: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                İşletme dilinde otomatik yazdırma tercihlerinizi belirleyin.
              </p>
              {type === 'kitchen' ? (
                <>
                  <ToggleRow
                    label="Masa siparişi girildiğinde otomatik yazdır"
                    checked={!!printOptions.autoPrint?.onTableOrderCreate}
                    onChange={(v) => setAutoPrint('onTableOrderCreate', v)}
                  />
                  <ToggleRow
                    label="Paket siparişi girildiğinde otomatik yazdır"
                    checked={!!printOptions.autoPrint?.onTakeawayOrderCreate}
                    onChange={(v) => setAutoPrint('onTakeawayOrderCreate', v)}
                  />
                  <ToggleRow
                    label="Sipariş değişikliği/ayarlama olduğunda yazdır"
                    checked={!!printOptions.autoPrint?.onOrderAdjustment}
                    onChange={(v) => setAutoPrint('onOrderAdjustment', v)}
                  />
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Kategori atamaları</div>
                    <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
                      Bu mutfak yazıcısının hangi kategori gruplarını yazdıracağını seçin.
                    </p>
                    {Object.keys(printOptions.kitchenGroups || {}).map((key) => (
                      <ToggleRow
                        key={key}
                        label={key === 'ICECEKLER' ? 'İçecekler' : key === 'IZGARA' ? 'Izgara' : key === 'FIRIN' ? 'Fırın' : key}
                        checked={!!printOptions.kitchenGroups[key]}
                        onChange={(v) => setKitchenGroup(key, v)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <ToggleRow
                    label="Ödeme tamamlandığında otomatik yazdır"
                    checked={!!printOptions.autoPrint?.onPaymentComplete}
                    onChange={(v) => setAutoPrint('onPaymentComplete', v)}
                  />
                  <ToggleRow
                    label="Masa kapandığında otomatik yazdır"
                    checked={!!printOptions.autoPrint?.onTableClose}
                    onChange={(v) => setAutoPrint('onTableClose', v)}
                  />
                  <ToggleRow
                    label="Paket siparişi tamamlandığında otomatik yazdır"
                    checked={!!printOptions.autoPrint?.onTakeawayComplete}
                    onChange={(v) => setAutoPrint('onTakeawayComplete', v)}
                  />
                </>
              )}
            </div>
          )}

          {activeSection === 'preview' && (
            <div className="card card-padded" style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Önizleme ve Test</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Önizleme, güvenli sunucu satır üreticisi ile hazırlanır.
                  </div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={testPrint} disabled={loading || testing || isNew}>
                  {testing ? 'Test…' : 'Test yazdır'}
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Tür: <strong>{primaryTypeLabel(type)}</strong>
              </div>
              <PrinterPreviewPanel type={type} lineWidth={lineWidth} printOptions={printOptions} />
            </div>
          )}

          {activeSection === 'advanced' && (
            <div className="card card-padded" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>Gelişmiş</div>
              <p style={{ marginTop: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                Bu alan teknik ekip içindir. Karakter ve yazdırma sorunu yoksa değiştirmeyin.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAdvancedOpen((v) => !v)}
                style={{ marginBottom: 10 }}
              >
                {advancedOpen ? 'Teknik ayarları gizle' : 'Teknik ayarları göster'}
              </button>
              {advancedOpen ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Bağlantı tipi</span>
                    <select className="input" value={connectionType} onChange={(e) => setConnectionType(e.target.value)}>
                      <option value="network">Ağ (Ethernet / Wi‑Fi)</option>
                      <option value="usb">USB</option>
                    </select>
                  </label>
                  {connectionType === 'network' && (
                    <>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>IP adresi</span>
                        <input className="input" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.100" />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Port</span>
                        <input className="input" type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="9100" />
                      </label>
                    </>
                  )}
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Satır genişliği (32-42)</span>
                    <input className="input" type="number" min="32" max="42" value={lineWidth} onChange={(e) => setLineWidth(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>ESC t kod sayfası</span>
                    <input className="input" type="number" min="0" max="255" value={escT} onChange={(e) => setEscT(e.target.value)} placeholder="32" />
                  </label>
                  <ToggleRow label="ESC @ başlatmayı atla" checked={skipInit} onChange={setSkipInit} />
                  <ToggleRow label="Phoenix FS komutunu atla" checked={skipPhoenixCmd} onChange={setSkipPhoenixCmd} />
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Türkçe kodlama modu</span>
                    <select
                      className="input"
                      value={encodingMode}
                      onChange={(e) => {
                        const nextMode = e.target.value;
                        setEncodingMode(nextMode);
                        if (nextMode === 'win1254') setSkipPhoenixCmd(true);
                      }}
                    >
                      <option value="win1254">Windows-1254 (önerilen)</option>
                      <option value="pc857">PC857</option>
                    </select>
                  </label>

                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Önizleme yazı ayarları</div>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Yazı tipi</span>
                      <select className="input" value={printOptions.layout?.fontFamily || 'Courier New'} onChange={(e) => setLayout('fontFamily', e.target.value)}>
                        {FONT_FAMILY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <NumField label="Ürün listesi yazı boyutu (px)" value={printOptions.layout?.fontSizeItems ?? 13} onChange={(v) => setLayout('fontSizeItems', v)} />
                  </div>
                </div>
              ) : null}
            </div>
          )}
          
        </>
      )}

      <PrinterDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        printerId={id}
        printerName={name}
        printerIsActive={isActive}
        onAfterDeactivate={() => navigate('/settings/printers', { replace: true })}
        onAfterDelete={() => navigate('/settings/printers', { replace: true })}
      />
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        body={confirmDialog?.body}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        onCancel={cancelConfirm}
        onConfirm={acceptConfirm}
      />
      <style>{`
        @media (max-width: 768px) {
          .printer-detail-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
