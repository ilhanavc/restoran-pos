import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../../services/api.js';
import { useToast } from '../../../context/ToastContext.jsx';
import {
  normalizePrintOptions,
  resetPrintOptionsForType,
} from '../printerDefaults.js';
import { getDiscoveryUiMeta } from '../printerDiscoveryStatus.js';

export function usePrinterForm({ requestConfirm }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error } = useToast();
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
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
  const [printOptions, setPrintOptions] = useState(() => normalizePrintOptions({}, 'receipt'));

  const showLegacyBar = type === 'bar';

  const dirty = useMemo(() => {
    const sig = JSON.stringify({
      name, type, connectionType, ip, port, isActive, isDefault,
      lineWidth, escT, skipInit, skipPhoenixCmd, encodingMode, printOptions,
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
    [fetchDiscoveredPrinters],
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

  useEffect(() => {
    setPrintOptions((prev) => normalizePrintOptions(prev, type));
  }, [type]);

  const setKitchenGroup = (key, val) => {
    setPrintOptions((prev) => ({
      ...prev,
      kitchenGroups: { ...prev.kitchenGroups, [key]: val },
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

  const navigateToList = () => navigate('/settings/printers', { replace: true });

  const handleBack = () => {
    if (dirty) {
      requestConfirm({
        title: 'Kaydedilmemiş değişiklikler var',
        body: 'Yazıcı ayarlarındaki değişiklikler kaybolacak. Çıkmak istiyor musunuz?',
        confirmLabel: 'Çık',
        tone: 'danger',
        onConfirm: navigateToList,
      });
      return;
    }
    navigateToList();
  };

  const save = async () => {
    const n = name.trim();
    if (!n) { error('Yazıcı adı zorunludur'); return; }
    const r = printOptions.roles;
    if (!r.receipt && !r.kitchen && !r.bar) { error('En az bir rol gerekli'); return; }
    const selectedPhysical = (printOptions.device?.physicalName || '').trim();
    if (!selectedPhysical) { error('Taranan yazıcılar listesinden bir yazıcı seçin'); return; }

    let portNum = parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) portNum = 9100;

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
      if (Object.keys(settingsBody).length > 0) await api.patchPrinterSettings(settingsBody);
      await load();
      if (isNew && printerId) navigate(`/settings/printers/${printerId}`, { replace: true });
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  const testPrint = async () => {
    if (isNew) { error('Önce yazıcıyı kaydedin.'); return; }
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

  return {
    id,
    isNew,
    loading,
    saving,
    testing,
    dirty,
    name, setName,
    type, setType,
    connectionType, setConnectionType,
    ip, setIp,
    port, setPort,
    isActive, setIsActive,
    isDefault, setIsDefault,
    lineWidth, setLineWidth,
    escT, setEscT,
    skipInit, setSkipInit,
    skipPhoenixCmd, setSkipPhoenixCmd,
    encodingMode, setEncodingMode,
    printOptions,
    discoveryLoading,
    discoveredPrinters,
    discoveryUpdatedAt,
    discoveryMeta,
    physicalName,
    typeBehaviorText,
    roleLabel,
    showLegacyBar,
    setKitchenGroup,
    setAutoPrint,
    setLayout,
    setDevicePhysical,
    navigateToList,
    handleBack,
    save,
    testPrint,
    resetToRecommendedDefaults,
    loadDiscoveredPrinters,
  };
}
