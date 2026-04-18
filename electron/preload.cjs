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

  /** Disk alanı yetersiz uyarısı geldiğinde callback'i çağırır. */
  onBackupDiskWarning: (callback) => {
    const handler = (_, info) => callback(info);
    ipcRenderer.on('backup-disk-warning', handler);
    return () => ipcRenderer.removeListener('backup-disk-warning', handler);
  },

  /** Kullanıcı dışarıdan .db dosyası seçer; yedekler klasörüne eklenir. Seçilen dosyanın adını döner. */
  pickExternalDb: () => ipcRenderer.invoke('backup:pick-external-db'),

  /** Belirtilen yedek dosyasını kullanıcının seçtiği konuma kopyalar. */
  exportBackup: (backupFileName) => ipcRenderer.invoke('backup:export', backupFileName),

  /** Harici yedek kopyalama için hedef klasör seçim dialogu açar. */
  pickExternalFolder: () => ipcRenderer.invoke('backup:pick-external-folder'),

  /** Kaydedilmiş Görev Zamanlayıcı yapılandırmasını döner (destFolder, taskName, createdAt). */
  schedulerConfig: () => ipcRenderer.invoke('backup:scheduler-config'),

  /** Görev Zamanlayıcı görevinin mevcut durumunu sorgular. */
  schedulerStatus: () => ipcRenderer.invoke('backup:scheduler-status'),

  /** Verilen hedef klasör için Görev Zamanlayıcı görevi oluşturur/günceller (her gece 03:00). */
  schedulerSave: (destFolder) => ipcRenderer.invoke('backup:scheduler-save', destFolder),

  /** Görev Zamanlayıcı görevini kaldırır. */
  schedulerRemove: () => ipcRenderer.invoke('backup:scheduler-remove'),

  /** Görevi hemen bir kez çalıştırır (robocopy test). */
  schedulerRunNow: () => ipcRenderer.invoke('backup:scheduler-run-now'),

  /** İlk kurulum wizard tamamlandı mı? */
  setupIsCompleted: () => ipcRenderer.invoke('setup:is-completed'),

  /** İlk kurulum tamamlandı olarak işaretle; businessName opsiyonel. */
  setupComplete: (data) => ipcRenderer.invoke('setup:complete', data),

  /** Electron ortamında çalışıp çalışmadığını döner (browser'dan ayırt etmek için). */
  isElectron: true,
});
