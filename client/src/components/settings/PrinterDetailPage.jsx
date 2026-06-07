import { useState } from 'react';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import PrinterDeleteModal from './PrinterDeleteModal.jsx';
import PrinterDeviceSection from './PrinterDeviceSection.jsx';
import PrinterPreviewPanel from './PrinterPreviewPanel.jsx';
import { usePrinterForm } from './hooks/usePrinterForm.js';
import { FONT_FAMILY_OPTIONS, primaryTypeLabel } from './printerDefaults.js';

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

export default function PrinterDetailPage() {
  const [activeSection, setActiveSection] = useState('general');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const {
    id, isNew, loading, saving, testing, dirty,
    name, setName, type, setType, connectionType, setConnectionType,
    ip, setIp, port, setPort, isActive, setIsActive, isDefault, setIsDefault,
    lineWidth, setLineWidth, escT, setEscT, skipInit, setSkipInit,
    skipPhoenixCmd, setSkipPhoenixCmd, encodingMode, setEncodingMode,
    printOptions, discoveryLoading, discoveredPrinters, discoveryUpdatedAt,
    discoveryMeta, physicalName, typeBehaviorText, roleLabel, showLegacyBar,
    setKitchenGroup, setAutoPrint, setLayout, setDevicePhysical,
    navigateToList, handleBack, save, testPrint, resetToRecommendedDefaults, loadDiscoveredPrinters,
  } = usePrinterForm({ requestConfirm });

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

              <PrinterDeviceSection
                physicalName={physicalName}
                discoveredPrinters={discoveredPrinters}
                discoveryLoading={discoveryLoading}
                discoveryUpdatedAt={discoveryUpdatedAt}
                discoveryMeta={discoveryMeta}
                loadDiscoveredPrinters={loadDiscoveredPrinters}
                setDevicePhysical={setDevicePhysical}
                setConnectionType={setConnectionType}
                setIp={setIp}
              />
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
        onAfterDelete={navigateToList}
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
