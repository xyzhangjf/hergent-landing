/**
 * Tests for src/main/license.js — Activation, HMAC, Trial, Device ID
 *
 * Uses moduleNameMapper (jest.config.js) to mock "electron" require.
 * No jest.mock() needed — electron is mapped to tests/__mocks__/electron.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createTempDir, removeDir } = require("./helpers");

let testDir;
let license;

beforeEach(() => {
  testDir = createTempDir();

  // Override userData path in the electron mock
  const electron = require("electron");
  electron.app.getPath = (name) => {
    if (name === "userData") return testDir;
    if (name === "home") return os.homedir();
    if (name === "documents") return path.join(os.homedir(), "Documents");
    return os.tmpdir();
  };

  // Fresh module instances per test
  delete require.cache[require.resolve("../src/main/license")];
  delete require.cache[require.resolve("../src/main/constants")];

  license = require("../src/main/license");
  license.init(electron.app);
});

afterEach(() => {
  removeDir(testDir);
});

afterAll(() => {
  jest.resetModules();
});

// ===== License CRUD =====
describe("License CRUD", () => {
  test("saveLicense writes valid JSON to disk", () => {
    license.saveLicense({ foo: "bar" });
    const p = path.join(testDir, "license.json");
    expect(fs.existsSync(p)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(parsed.foo).toBe("bar");
  });

  test("loadLicense returns null when file does not exist", () => {
    expect(license.loadLicense()).toBeNull();
  });

  test("save and load round-trip", () => {
    license.saveLicense({ firstRunDate: "2026-01-01", activated: false, credits: 100 });
    const loaded = license.loadLicense();
    expect(loaded.credits).toBe(100);
    expect(loaded.activated).toBe(false);
  });
});

// ===== Device ID =====
describe("Device ID", () => {
  test("generates UUID v4 device ID with dashes", () => {
    const id = license.getDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  test("same device ID is returned on repeated calls", () => {
    const id1 = license.getDeviceId();
    const id2 = license.getDeviceId();
    expect(id1).toBe(id2);
  });
});

// ===== HMAC Activation Code =====
describe("Activation Code", () => {
  test("generates code with HERMES- prefix and 64 uppercase hex chars", () => {
    const code = license.generateActivationCode("device-123");
    expect(code).toMatch(/^HERMES-[0-9A-F]{64}$/);
  });

  test("verifies correct code", () => {
    const code = license.generateActivationCode("device-456");
    expect(license.verifyActivationCode(code, "device-456")).toBe(true);
  });

  test("rejects incorrect code", () => {
    expect(license.verifyActivationCode("HERMES-BADCODE", "device-123")).toBe(false);
  });

  test("rejects null and empty input", () => {
    expect(license.verifyActivationCode(null, "device-123")).toBe(false);
    expect(license.verifyActivationCode("", "device-123")).toBe(false);
  });

  test("rejects code without HERMES- prefix", () => {
    expect(license.verifyActivationCode("NOT-HERMES-CODE", "device-123")).toBe(false);
  });

  test("backward compat: 16-char short code still verifies", () => {
    const fullCode = license.generateActivationCode("device-789");
    expect(fullCode.length).toBe(71); // "HERMES-" (7) + 64 hex = 71
    const shortCode = fullCode.slice(0, 23); // "HERMES-" + 16 hex = 23
    expect(license.verifyActivationCode(shortCode, "device-789")).toBe(true);
  });
});

// ===== License Status =====
describe("License Status", () => {
  test("new user gets 7-day trial status", () => {
    const status = license.getLicenseStatus();
    expect(status.status).toBe("trial");
    expect(status.trialDays).toBe(7);
    expect(status.credits).toBe(0);
  });

  test("past 7 days gives trial_expired", () => {
    const pastDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    license.saveLicense({ firstRunDate: pastDate, activated: false, credits: 0 });
    const status = license.getLicenseStatus();
    expect(status.status).toBe("trial_expired");
    expect(status.remainingDays).toBe(0);
  });

  test("activated license shows remaining days", () => {
    const futureExpire = new Date(Date.now() + 100 * 86400000).toISOString();
    license.saveLicense({
      firstRunDate: new Date().toISOString(),
      activated: true,
      expireDate: futureExpire,
      credits: 200,
    });
    const status = license.getLicenseStatus();
    expect(status.status).toBe("activated");
    expect(status.remainingDays).toBeGreaterThan(0);
    expect(status.credits).toBe(200);
  });

  test("past expire date gives expired status", () => {
    const pastExpire = new Date(Date.now() - 1 * 86400000).toISOString();
    license.saveLicense({
      firstRunDate: new Date().toISOString(),
      activated: true,
      expireDate: pastExpire,
      credits: 0,
    });
    const status = license.getLicenseStatus();
    expect(status.status).toBe("expired");
  });
});

// ===== ensureLicenseInit =====
describe("ensureLicenseInit", () => {
  test("creates new license on first run", () => {
    const lic = license.ensureLicenseInit();
    expect(lic.activated).toBe(false);
    expect(lic.credits).toBe(0);
    expect(lic.firstRunDate).toBeTruthy();
  });

  test("returns existing license if present", () => {
    license.saveLicense({ firstRunDate: "2025-01-01", activated: true, credits: 500 });
    const lic = license.ensureLicenseInit();
    expect(lic.activated).toBe(true);
    expect(lic.credits).toBe(500);
  });

  test("adds firstRunDate if missing from existing license", () => {
    license.saveLicense({ activated: true });
    const lic = license.ensureLicenseInit();
    expect(lic.firstRunDate).toBeTruthy();
    expect(lic.activated).toBe(true);
  });
});
