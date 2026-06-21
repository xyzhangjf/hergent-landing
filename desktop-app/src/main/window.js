// Hergent Desktop — BrowserWindow creation + security hardening
const { BrowserWindow } = require("electron");
const path = require("path");

let mainWindow = null;

function createWindow(isWindows, preloadPath) {
  const preload = preloadPath || path.join(__dirname, "..", "..", "preload.js");

  const winOpts = {
    width: 900,
    height: 700,
    resizable: true,
    webPreferences: {
      preload: preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // sandbox:true requires removing Node API usage in preload
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
  if (!isWindows) {
    winOpts.frame = false;
    winOpts.titleBarStyle = "hidden";
    winOpts.transparent = true;
  }

  mainWindow = new BrowserWindow(winOpts);

  // Prevent accidental navigation to external URLs (open in default browser instead)
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://") && !url.startsWith("avatar://")) {
      event.preventDefault();
      const { shell } = require("electron");
      shell.openExternal(url).catch(() => {});
    }
  });

  // Deny window.open() popups
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.loadFile("index.html");
  mainWindow.center();
  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createWindow, getMainWindow };
