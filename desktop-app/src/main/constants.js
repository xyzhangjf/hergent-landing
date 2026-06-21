/**
 * Hergent Desktop — Constants
 * All magic numbers, strings, and configuration constants.
 */
const path = require("path");
const os = require("os");

// ===== Paths & config =====
const PROFILE = "hermes-desktop";
const homeDir = os.homedir();
const CURRENT_VERSION = (() => {
  try {
    return JSON.parse(require("fs").readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")).version;
  } catch (_) {
    return "1.0.0";
  }
})();

// ===== Gateway =====
const GATEWAY_PORT = 18765;
const GATEWAY_URL = "http://127.0.0.1:" + GATEWAY_PORT;

// ===== Environment =====
const isWindows = process.platform === "win32";
const HERMES_CMD = isWindows ? "hermes.exe" : "hermes";
const _isDev = process.env.HERGENT_DEV === "1" || process.env.NODE_ENV === "development";
const _tlsReject = !_isDev;

// ===== Activation & Licensing =====
const ACTIVATION_KEY = "hermes-fmcg-activation-2026";
const TRIAL_DAYS = 7;
const LICENSE_DAYS = 365;

// ===== Server URL =====
const SERVER_URL = process.platform === "win32" ? "https://api.hergent.cn" : "http://localhost:8765";

// ===== Platform definitions =====
const PLATFORM_DEFS = {
  feishu:    { label: "飞书",  credField: "app_id",    envVars: { app_id: "FEISHU_APP_ID",         app_secret: "FEISHU_APP_SECRET" } },
  wecom:     { label: "企微",  credField: "bot_id",    envVars: { bot_id: "WECOM_BOT_ID",           secret: "WECOM_SECRET" } },
  dingtalk:  { label: "钉钉",  credField: "client_id", envVars: { client_id: "DINGTALK_CLIENT_ID",   client_secret: "DINGTALK_CLIENT_SECRET" } },
  qq:        { label: "QQ",    credField: "app_id",    envVars: { app_id: "QQ_APP_ID",              app_secret: "QQ_APP_SECRET" } },
};

// Large data objects extracted to separate files (retaining original quoting)
const DEFAULT_ROLES = require("./roles-data");
const ROLE_SKILLS = require("./role-skills");

module.exports = {
  PROFILE, homeDir, CURRENT_VERSION,
  GATEWAY_PORT, GATEWAY_URL,
  isWindows, HERMES_CMD, _isDev, _tlsReject,
  ACTIVATION_KEY, TRIAL_DAYS, LICENSE_DAYS, SERVER_URL,
  PLATFORM_DEFS, DEFAULT_ROLES, ROLE_SKILLS,
};
