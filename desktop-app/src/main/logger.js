/**
 * Hergent Desktop — Centralized Logging
 *
 * Usage:
 *   const logger = require("./src/main/logger");
 *   logger.init(electronApp, sentryInstance);
 *   logger.startup("main.js loaded");
 *   logger.error("gateway", "failed to start", { code: 1 });
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

let _app = null;
let _sentry = null;
let _isDev = false;
const ERROR_HISTORY = [];

function init(app, sentry, isDev) {
  _app = app || _app;
  _sentry = sentry || _sentry;
  _isDev = (isDev !== undefined) ? isDev : _isDev;
}

function _logDir() {
  try {
    if (_app && _app.isReady()) return _app.getPath("userData");
  } catch (_) {}
  try { return os.tmpdir(); } catch (_) {}
  return ".";
}

function hergentLog(level, category, message) {
  if (level === "ERROR") {
    const ts = new Date().toISOString();
    ERROR_HISTORY.unshift({ ts, category, message });
    if (ERROR_HISTORY.length > 20) ERROR_HISTORY.pop();
    try {
      if (_sentry) _sentry.addBreadcrumb({ category, message, level: "error", timestamp: Date.now() / 1000 });
    } catch (_) {}
  }
}

function reportCriticalError(component, err, extraContext) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack || "") : "";
  hergentLog("ERROR", component, msg);
  try {
    const logDir = _logDir();
    fs.appendFileSync(
      path.join(logDir, "hergent-crash.log"),
      "[" + new Date().toISOString() + "] [" + component + "] " + msg + "\n" + stack + "\n" +
      (extraContext ? JSON.stringify(extraContext) : "") + "\n"
    );
  } catch (_) {}
  try {
    if (_sentry) _sentry.captureException(err instanceof Error ? err : new Error(msg));
  } catch (_) {}
}

function reportNonCritical(component, message) {
  hergentLog("WARN", component, message);
  if (_isDev) console.warn("[" + component + "]", message);
}

function startup(msg) {
  try {
    const logDir = (() => {
      try {
        if (_app && _app.isReady()) return _app.getPath("userData");
        return path.join(os.homedir(), "AppData", "Roaming", "Hergent");
      } catch (_) { return os.tmpdir(); }
    })();
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "startup.log"), "[" + new Date().toISOString() + "] " + msg + "\n");
  } catch (_) {}
}

function getErrorHistory() {
  return ERROR_HISTORY.slice();
}

module.exports = {
  init,
  hergentLog, reportCriticalError, reportNonCritical, startup,
  getErrorHistory,
};
