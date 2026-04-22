const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

const { getCodeRoot } = require('./config.cjs');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function getMainWindow() { return mainWindow; }

function createWindow(port, cloudServerUrl = null) {
  const preloadPath = app.isPackaged
    ? path.join(app.getAppPath(), 'electron', 'preload.cjs')
    : path.join(__dirname, '..', 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  if (cloudServerUrl) {
    mainWindow.loadURL(cloudServerUrl).catch((err) => {
      dialog.showErrorBox('Yükleme hatası', `Sayfa açılamadı: ${err.message}`);
    });
  } else {
    const clientIndex = path.join(getCodeRoot(), 'client', 'dist', 'index.html');
    mainWindow.loadFile(clientIndex).catch((err) => {
      dialog.showErrorBox('Yükleme hatası', `Sayfa açılamadı: ${err.message}`);
    });
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

module.exports = { createWindow, getMainWindow };
