// Mock Electron API for Jest tests
const path = require("path");
const os = require("os");

const tmpDir = os.tmpdir();

// Simulated app.getPath responses
const userDataPath = path.join(tmpDir, "hergent-test-userdata");
const homePath = os.homedir();

const app = {
  isReady: () => true,
  getPath: (name) => {
    switch (name) {
      case "userData": return userDataPath;
      case "home": return homePath;
      case "documents": return path.join(homePath, "Documents");
      default: return tmpDir;
    }
  },
  whenReady: () => Promise.resolve(),
  on: () => {},
  quit: () => {},
};

const BrowserWindow = function () {};
BrowserWindow.getAllWindows = () => [];

const ipcMain = {
  handle: () => {},
  on: () => {},
};

const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showErrorBox: () => {},
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: null }),
};

const net = {
  request: () => ({
    setHeader: () => {},
    on: (event, cb) => {
      if (event === "response") {
        const response = {
          statusCode: 200,
          on: (evt, cb2) => {
            if (evt === "data") cb2("");
            if (evt === "end") cb2();
          },
        };
        cb(response);
      }
      if (event === "error") { /* no-op */ }
    },
    write: () => {},
    end: () => {},
  }),
  fetch: () => Promise.resolve({}),
};

const Menu = { buildFromTemplate: () => ({ popup: () => {} }) };
const shell = { openPath: () => {}, openExternal: () => {} };
const protocol = { handle: () => {} };
const nativeTheme = {};

// safeStorage mock
const safeStorage = {
  _store: {},
  isEncryptionAvailable: () => true,
  encryptString: (plaintext) => Buffer.from("enc:" + plaintext).toString("base64"),
  decryptString: (buf) => {
    const s = Buffer.from(buf, "base64").toString("utf8");
    return s.startsWith("enc:") ? s.slice(4) : s;
  },
};

module.exports = {
  app, BrowserWindow, ipcMain, dialog, net, Menu, shell, protocol, nativeTheme, safeStorage,
};
