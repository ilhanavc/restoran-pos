/**
 * Electron otomatik güncelleme bildirimi.
 * window.electronAPI mevcut olduğunda (sadece Electron ortamında) aktif olur.
 * Güncelleme mevcut → indirme çubuğu → kurulum butonu.
 */
import { useState, useEffect } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

export default function UpdateNotification() {
  const [update, setUpdate] = useState(null);       // { version, releaseNotes }
  const [progress, setProgress] = useState(null);   // { percent }
  const [downloaded, setDownloaded] = useState(null); // { version }
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return; // Tarayıcıda çalışıyor — hiçbir şey yapma

    const cleanups = [
      api.onUpdateAvailable((info) => {
        setUpdate(info);
        setDismissed(false);
      }),
      api.onDownloadProgress((p) => setProgress(p)),
      api.onUpdateDownloaded((info) => {
        setDownloaded(info);
        setProgress(null);
      }),
      api.onUpdateError(() => {
        // Hata sessizce loglandı — kullanıcıya sadece indirme durumunu sıfırla
        setProgress(null);
      }),
    ];

    return () => cleanups.forEach(fn => fn?.());
  }, []);

  if (dismissed || (!update && !downloaded)) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      padding: '14px 16px', width: 320,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {downloaded
            ? <RefreshCw size={16} color="var(--success)" />
            : <Download size={16} color="var(--primary)" />}
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {downloaded
              ? `v${downloaded.version} hazır`
              : `v${update?.version} mevcut`}
          </span>
        </div>
        {!downloaded && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDismissed(true)}
            style={{ padding: 2 }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {progress && !downloaded && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
            İndiriliyor… {progress.percent}%
          </div>
          <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'var(--primary)',
              width: `${progress.percent}%`, transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {!progress && !downloaded && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          Güncelleme arka planda indiriliyor.
        </p>
      )}

      {downloaded && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ flex: 1 }}
            onClick={() => window.electronAPI?.installUpdate()}
          >
            Kur ve Yeniden Başlat
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setDismissed(true)}
          >
            Sonra
          </button>
        </div>
      )}
    </div>
  );
}
