/**
 * Electron preload — contextBridge ile güvenli IPC köprüsü.
 * contextIsolation: true olduğu için renderer JS'e doğrudan node/electron erişimi kapalıdır.
 * window.electronAPI üzerinden yalnızca tanımlanan metodlar erişilebilir.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** Güncelleme mevcut olduğunda callback'i çağırır. Dönen fonksiyon ile dinleyici kaldırılır. */
  onUpdateAvailable: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },

  /** Güncelleme indirildiğinde callback'i çağırır. */
  onUpdateDownloaded: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },

  /** İndirme ilerlemesini bildirir: { percent, transferred, total, bytesPerSecond } */
  onDownloadProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

  /** Güncelleme hatası. */
  onUpdateError: (callback) => {
    const handler = (_, err) => callback(err);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },

  /** Güncellemeyi yükle ve uygulamayı yeniden başlat. */
  installUpdate: () => ipcRenderer.send('install-update'),

  /** Manuel güncelleme kontrolü tetikle. */
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),

  /** Bakım/restore sonrası uygulamayı kontrollü yeniden başlat. */
  restartApp: () => ipcRenderer.send('restart-app'),

  /** Otomatik yedekleme başarısız olduğunda callback'i çağırır. */
  onBackupFailed: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('backup-failed', handler);
    return () => ipcRenderer.removeListener('backup-failed', handler);
  },

  /** Electron ortamında çalışıp çalışmadığını döner (browser'dan ayırt etmek için). */
  isElectron: true,
});
