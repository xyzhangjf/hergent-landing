// Hergent Desktop — BrowserWindow creation
const { BrowserWindow } = require("electron");
const path = require("path");

let mainWindow = null;

function createWindow(isWindows, preloadPath) {
  const winOpts = {
    width: 900,
    height: 700,
    resizable: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  if (!isWindows) {
    winOpts.frame = false;
    winOpts.titleBarStyle = "hidden";
    winOpts.transparent = true;
  }
  mainWindow = new BrowserWindow(winOpts);
  mainWindow.loadFile("index.html");
  mainWindow.center();
  return mainWindow;
}

module.exports = { createWindow, getMainWindow: () => mainWindow };
