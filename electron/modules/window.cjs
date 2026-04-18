const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

const { HEALTH_HOST } = require('./serverProcess.cjs');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function getMainWindow() { return mainWindow; }

function createWindow(port) {
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

  const url = `http://${HEALTH_HOST}:${port}/`;
  mainWindow.loadURL(url).catch((err) => {
    dialog.showErrorBox('Yükleme hatası', `Sayfa açılamadı: ${err.message}`);
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

module.exports = { createWindow, getMainWindow };
