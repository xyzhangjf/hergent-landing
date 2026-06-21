/**
 * Tests for src/main/constants.js — Magic values, defaults, platform defs
 */
const constants = require("../src/main/constants");

describe("Constants", () => {
  test("GATEWAY_PORT is 18765", () => {
    expect(constants.GATEWAY_PORT).toBe(18765);
  });

  test("GATEWAY_URL uses localhost", () => {
    expect(constants.GATEWAY_URL).toBe("http://127.0.0.1:18765");
  });

  test("isWindows is boolean", () => {
    expect(typeof constants.isWindows).toBe("boolean");
  });

  test("SERVER_URL is valid", () => {
    expect(constants.SERVER_URL).toBeTruthy();
  });

  test("TRIAL_DAYS = 7", () => {
    expect(constants.TRIAL_DAYS).toBe(7);
  });

  test("LICENSE_DAYS = 365", () => {
    expect(constants.LICENSE_DAYS).toBe(365);
  });

  test("CURRENT_VERSION is semver-like", () => {
    expect(constants.CURRENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("HERMES_CMD matches platform", () => {
    if (process.platform === "win32") {
      expect(constants.HERMES_CMD).toBe("hermes.exe");
    } else {
      expect(constants.HERMES_CMD).toBe("hermes");
    }
  });

  test("_tlsReject depends on _isDev", () => {
    // In test environment (not dev), should be true
    expect(typeof constants._tlsReject).toBe("boolean");
    expect(typeof constants._isDev).toBe("boolean");
  });
});

describe("PLATFORM_DEFS", () => {
  test("has 4 platforms", () => {
    expect(Object.keys(constants.PLATFORM_DEFS)).toHaveLength(4);
  });

  test("each platform has label, credField, envVars", () => {
    for (const [key, def] of Object.entries(constants.PLATFORM_DEFS)) {
      expect(def.label).toBeTruthy();
      expect(def.credField).toBeTruthy();
      expect(typeof def.envVars).toBe("object");
      expect(Object.keys(def.envVars).length).toBeGreaterThanOrEqual(2);
    }
  });

  test("feishu uses app_id/app_secret", () => {
    const fs = constants.PLATFORM_DEFS.feishu;
    expect(fs.credField).toBe("app_id");
    expect(fs.envVars.app_id).toBe("FEISHU_APP_ID");
    expect(fs.envVars.app_secret).toBe("FEISHU_APP_SECRET");
  });
});

describe("DEFAULT_ROLES", () => {
  test("has 8 built-in roles", () => {
    expect(Object.keys(constants.DEFAULT_ROLES)).toHaveLength(8);
  });

  test("each role has name, systemPrompt, opening, builtIn", () => {
    for (const [id, role] of Object.entries(constants.DEFAULT_ROLES)) {
      expect(role.name).toBeTruthy();
      expect(typeof role.systemPrompt).toBe("string");
      expect(role.systemPrompt.length).toBeGreaterThan(10);
      expect(typeof role.opening).toBe("string");
      expect(role.opening.length).toBeGreaterThan(10);
      expect(role.builtIn).toBe(true);
    }
  });

  test("dami is the default assistant", () => {
    expect(constants.DEFAULT_ROLES.dami.name).toBe("大秘");
  });

  test("accountant role exists", () => {
    expect(constants.DEFAULT_ROLES.accountant.name).toBe("会计");
  });
});

describe("ROLE_SKILLS", () => {
  test("maps role IDs to skill arrays", () => {
    expect(Array.isArray(constants.ROLE_SKILLS.dami)).toBe(true);
    expect(constants.ROLE_SKILLS.dami.length).toBeGreaterThan(0);
  });

  test("dami has contract-writing skill", () => {
    expect(constants.ROLE_SKILLS.dami).toContain("contract-writing");
  });

  test("accountant has bank-reconciliation skill", () => {
    expect(constants.ROLE_SKILLS.accountant).toContain("bank-reconciliation");
  });

  test("programmer has python-coding skill", () => {
    expect(constants.ROLE_SKILLS.programmer).toContain("python-coding");
  });

  test("writer has empty skills", () => {
    expect(constants.ROLE_SKILLS.writer).toEqual([]);
  });
});
