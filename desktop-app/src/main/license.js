/**
 * Hergent Desktop — License & Activation
 * Device ID, trial period, activation code HMAC verification.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { ACTIVATION_KEY, TRIAL_DAYS, LICENSE_DAYS } = require("./constants");

let _app = null;

function init(app) { _app = app; }

function getLicensePath() {
  return path.join(_app.getPath("userData"), "license.json");
}

function loadLicense() {
  try {
    const p = getLicensePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (_) {}
  return null;
}

function saveLicense(data) {
  fs.writeFileSync(getLicensePath(), JSON.stringify(data, null, 2));
}

function ensureLicenseInit() {
  const lic = loadLicense();
  if (!lic) {
    const now = new Date().toISOString();
    saveLicense({ firstRunDate: now, activated: false, credits: 0, activationCode: null, activateDate: null, expireDate: null });
    return { firstRunDate: now, activated: false, credits: 0 };
  }
  if (!lic.firstRunDate) {
    lic.firstRunDate = new Date().toISOString();
    saveLicense(lic);
  }
  return lic;
}

function generateActivationCode(deviceId) {
  const payload = deviceId + "|" + ACTIVATION_KEY;
  const hmac = crypto.createHmac("sha256", ACTIVATION_KEY).update(payload).digest("hex");
  return "HERMES-" + hmac.toUpperCase();
}

function verifyActivationCode(code, deviceId) {
  if (!code || !code.startsWith("HERMES-")) return false;
  const expected = generateActivationCode(deviceId);
  if (code.toUpperCase() === expected) return true;
  // Backward compat: 16-char short HMAC ("HERMES-" + 16 hex = 23 chars)
  if (code.toUpperCase() === expected.slice(0, 23)) return true;
  return false;
}

function getDeviceId() {
  const lic = loadLicense();
  if (lic && lic.deviceId) return lic.deviceId;
  const id = crypto.randomUUID();
  if (lic) {
    lic.deviceId = id; saveLicense(lic);
    console.log("warn: license.json exists but missing deviceId, patched");
  } else {
    const engineDir = path.join(_app.getPath("userData"), "hermes-engine");
    if (fs.existsSync(path.join(engineDir, ".extracted-version"))) {
      console.log("warn: license.json missing, generating new deviceId — server credits/activation may be lost");
    }
    saveLicense({ firstRunDate: new Date().toISOString(), activated: false, credits: 0, deviceId: id });
  }
  return id;
}

function getDeepSeekApiKey() {
  try {
    const homeDir = _app.getPath("home");
    const authPath = path.join(homeDir, ".hermes", "auth.json");
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
      const pool = auth.credential_pool?.deepseek;
      if (pool && pool.length > 0) return pool[0].access_token;
    }
  } catch (_) {}
  return process.env.DEEPSEEK_API_KEY || "hermes-local-proxy";
}

function getLicenseStatus() {
  const lic = ensureLicenseInit();
  const now = new Date();

  if (lic.activated && lic.expireDate) {
    const expire = new Date(lic.expireDate);
    const remaining = Math.ceil((expire - now) / (1000 * 60 * 60 * 24));
    if (remaining <= 0) {
      lic.activated = false;
      saveLicense(lic);
      return { status: "expired", trialDays: 0, remainingDays: 0, credits: 0, message: "激活已过期，请续费" };
    }
    return { status: "activated", trialDays: TRIAL_DAYS, remainingDays: remaining, credits: lic.credits || 0, message: "已激活，剩余 " + remaining + " 天" };
  }

  const firstRun = new Date(lic.firstRunDate);
  const usedDays = Math.ceil((now - firstRun) / (1000 * 60 * 60 * 24));
  const remaining = Math.max(0, TRIAL_DAYS - usedDays);

  if (remaining <= 0) {
    return { status: "trial_expired", trialDays: TRIAL_DAYS, remainingDays: 0, credits: lic.credits || 0, usedDays, message: "7天试用已到期，请激活继续使用" };
  }

  return { status: "trial", trialDays: TRIAL_DAYS, remainingDays: remaining, usedDays, credits: lic.credits || 0, message: "试用第 " + usedDays + " 天，剩余 " + remaining + " 天" };
}

module.exports = { init, getLicensePath, loadLicense, saveLicense, ensureLicenseInit, generateActivationCode, verifyActivationCode, getDeviceId, getDeepSeekApiKey, getLicenseStatus };
