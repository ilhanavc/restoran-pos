import { toneColor } from './printerDiscoveryStatus.js';

export default function PrinterDeviceSection({
  physicalName,
  discoveredPrinters,
  discoveryLoading,
  discoveryUpdatedAt,
  discoveryMeta,
  loadDiscoveredPrinters,
  setDevicePhysical,
  setConnectionType,
  setIp,
}) {
  return (
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
          {discoveryLoading ? 'Taranıyor...' : 'Yazıcıları Yenile'}
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
              {p.connectionType === 'network' && p.ipAddress ? ` - ${p.ipAddress}` : ''}
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
          <span style={{ fontSize: 11, color: toneColor(discoveryMeta.tone) }}>
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
  );
}
