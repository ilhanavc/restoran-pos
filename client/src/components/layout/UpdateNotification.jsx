/**
 * Electron otomatik güncelleme bildirimi + Release Notes UI.
 *
 * Akış:
 *   1. update-available  → Toast bildirim (sağ alt) + "Sürüm Notları" butonu → modal açılır
 *   2. download-progress → Toast'ta progress bar
 *   3. update-downloaded → "Kur ve Yeniden Başlat" CTA + "Sonra" seçeneği
 *   4. update-error      → Toast'ta hata satırı + retry butonu
 *
 * window.electronAPI olmadığında (browser dev modu) hiçbir şey render etmez.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download, X, ChevronDown,
  Rocket, AlertTriangle, RotateCcw, Sparkles,
} from 'lucide-react';

/* ─── Release Notes Modal ────────────────────────────────────────────────── */

function ReleaseNotesModal({ version, notes, onClose }) {
  // Backdrop click kapatır
  const backdropRef = useRef(null);
  const handleBackdrop = useCallback((e) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  // Escape kapatır
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  /* electron-builder releaseNotes HTML string veya nesne döner;
     düz metin ise <pre> ile gösterilir */
  const isHtml = typeof notes === 'string' && /<[a-z][\s\S]*>/i.test(notes);
  const textContent = typeof notes === 'string'
    ? notes
    : JSON.stringify(notes, null, 2);

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(2, 6, 23, 0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(4px)',
        animation: 'rnModalBackdropIn 180ms ease',
      }}
    >
      <div style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        width: '100%', maxWidth: 560,
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        animation: 'rnModalIn 200ms cubic-bezier(0.34, 1.4, 0.64, 1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-gradient-end))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Sparkles size={18} color="white" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>
              Sürüm {version} — Yenilikler
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              Bu sürümde yapılan değişiklikler
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ padding: 6, minHeight: 'unset' }}
            aria-label="Kapat"
          >
            <X size={14} />
          </button>
        </div>

        {/* Notes body */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px 20px',
        }}>
          {notes ? (
            isHtml ? (
              /* HTML içeriği — dangerouslySetInnerHTML, yalnızca Electron'da güvenli */
              <div
                className="release-notes-html"
                dangerouslySetInnerHTML={{ __html: textContent }}
                style={{
                  fontSize: 13, lineHeight: 1.65,
                  color: 'var(--text-secondary)',
                }}
              />
            ) : (
              <pre style={{
                fontSize: 12, lineHeight: 1.6,
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'inherit',
              }}>
                {textContent}
              </pre>
            )
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Bu sürüm için ayrıntılı sürüm notu bulunmuyor.
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Toast Bildirimi ────────────────────────────────────────────────────── */

export default function UpdateNotification() {
  const [update, setUpdate] = useState(null);       // { version, releaseNotes }
  const [progress, setProgress] = useState(null);   // { percent, bytesPerSecond, transferred, total }
  const [downloaded, setDownloaded] = useState(null); // { version }
  const [error, setError] = useState(null);         // string
  const [dismissed, setDismissed] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [checkingManual, setCheckingManual] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const cleanups = [
      api.onUpdateAvailable((info) => {
        setUpdate(info);
        setError(null);
        setDismissed(false);
        setProgress(null);
        setDownloaded(null);
      }),
      api.onDownloadProgress((p) => {
        setProgress(p);
        setError(null);
      }),
      api.onUpdateDownloaded((info) => {
        setDownloaded(info);
        setProgress(null);
        setError(null);
      }),
      api.onUpdateError((err) => {
        setProgress(null);
        setError(err?.message || 'Güncelleme sırasında bir hata oluştu.');
      }),
    ];

    return () => cleanups.forEach((fn) => fn?.());
  }, []);

  const handleInstall = useCallback(() => {
    window.electronAPI?.installUpdate();
  }, []);

  const handleCheckManual = useCallback(() => {
    if (!window.electronAPI?.checkForUpdates) return;
    setCheckingManual(true);
    setError(null);
    window.electronAPI.checkForUpdates();
    // 8 saniye sonra flag sıfırla (event yoksa)
    setTimeout(() => setCheckingManual(false), 8000);
  }, []);

  // update-available geldiğinde checkingManual sıfırlanır
  useEffect(() => {
    if (update) setCheckingManual(false);
  }, [update]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setNotesModalOpen(false);
  }, []);

  const hasReleaseNotes = Boolean(update?.releaseNotes);
  const isVisible = !dismissed && (update || downloaded || error);

  /* Formatla: bytes/s → KB/s veya MB/s */
  function formatSpeed(bps) {
    if (!bps) return '';
    if (bps > 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
    return `${Math.round(bps / 1024)} KB/s`;
  }

  if (!isVisible && !checkingManual) return null;

  return (
    <>
      {/* ── Toast ── */}
      <div
        id="update-notification-toast"
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          background: 'var(--surface-1)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 16px 40px rgba(2,6,23,0.32), 0 0 0 1px rgba(255,255,255,0.04)',
          padding: '14px 16px',
          width: 336,
          display: 'flex', flexDirection: 'column', gap: 10,
          animation: 'rnToastIn 220ms cubic-bezier(0.34, 1.3, 0.64, 1)',
        }}
      >
        {/* ── Başlık satırı ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* İkon */}
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: downloaded
              ? 'var(--success-soft)'
              : error
                ? 'var(--danger-soft)'
                : 'var(--accent-soft)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {downloaded
              ? <Rocket size={15} color="var(--success)" />
              : error
                ? <AlertTriangle size={15} color="var(--danger)" />
                : <Download size={15} color="var(--accent)" />}
          </div>

          {/* Metin */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3 }}>
              {downloaded
                ? `v${downloaded.version} kurulmaya hazır`
                : error
                  ? 'Güncelleme hatası'
                  : checkingManual && !update
                    ? 'Güncelleme kontrolü...'
                    : `v${update?.version} mevcut`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.3 }}>
              {downloaded
                ? 'Hemen kurun veya bir sonraki açılışta otomatik kurulsun.'
                : error
                  ? 'Bağlantı sorunu veya sunucu hatası.'
                  : progress
                    ? null
                    : checkingManual && !update
                      ? 'Lütfen bekleyin...'
                      : 'Arka planda indiriliyor.'}
            </div>
          </div>

          {/* Kapat */}
          {!downloaded && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleDismiss}
              style={{ padding: 4, minHeight: 'unset', border: 'none', marginLeft: 4 }}
              aria-label="Bildirimi kapat"
            >
              <X size={13} color="var(--text-muted)" />
            </button>
          )}
        </div>

        {/* ── Progress bar ── */}
        {progress && !downloaded && (
          <div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: 'var(--text-muted)', marginBottom: 5,
            }}>
              <span>İndiriliyor… {Math.round(progress.percent)}%</span>
              {progress.bytesPerSecond > 0 && (
                <span>{formatSpeed(progress.bytesPerSecond)}</span>
              )}
            </div>
            <div style={{
              height: 5, background: 'var(--surface-3)',
              borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, var(--accent), var(--accent-gradient-end))',
                width: `${Math.round(progress.percent)}%`,
                transition: 'width 0.4s ease',
                borderRadius: 3,
              }} />
            </div>
          </div>
        )}

        {/* ── Hata ── */}
        {error && (
          <div style={{
            background: 'var(--danger-soft)',
            border: '1px solid rgba(239,68,68,0.18)',
            borderRadius: 8, padding: '8px 10px',
            fontSize: 11, color: 'var(--danger)', lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        {/* ── Sürüm notları butonu (yalnızca indirme tamam değilken, not varsa) ── */}
        {hasReleaseNotes && !downloaded && !error && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            id="update-release-notes-btn"
            onClick={() => setNotesModalOpen(true)}
            style={{
              justifyContent: 'flex-start', gap: 6,
              fontSize: 11, padding: '5px 0',
              border: 'none', color: 'var(--accent)',
            }}
          >
            <ChevronDown size={12} />
            Sürüm notlarını görüntüle
          </button>
        )}

        {/* ── İndirme tamamlandı: CTA ── */}
        {downloaded && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              id="update-install-btn"
              className="btn btn-primary btn-sm"
              style={{ flex: 1 }}
              onClick={handleInstall}
            >
              <Rocket size={13} />
              Kur ve Yeniden Başlat
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleDismiss}
              title="Bir sonraki açılışta otomatik kurulur"
            >
              Sonra
            </button>
          </div>
        )}

        {/* ── Hata sonrası tekrar dene ── */}
        {error && (
          <button
            type="button"
            id="update-retry-btn"
            className="btn btn-ghost btn-sm"
            style={{ gap: 6, fontSize: 11 }}
            onClick={handleCheckManual}
            disabled={checkingManual}
          >
            <RotateCcw size={12} />
            {checkingManual ? 'Kontrol ediliyor…' : 'Tekrar dene'}
          </button>
        )}
      </div>

      {/* ── Release Notes Modal ── */}
      {notesModalOpen && update && (
        <ReleaseNotesModal
          version={update.version}
          notes={update.releaseNotes}
          onClose={() => setNotesModalOpen(false)}
        />
      )}
    </>
  );
}
