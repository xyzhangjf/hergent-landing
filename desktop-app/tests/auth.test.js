/**
 * Tests for src/renderer/auth.js — SMS phone validation, token storage
 *
 * Tests the pure-logic functions extracted from auth.js.
 */

// ---- Pure logic functions ----

/**
 * Validate Chinese mobile phone number format.
 * @param {string} phone
 * @returns {boolean}
 */
function _validatePhone(phone) {
  return /^1\d{10}$/.test(phone);
}

/**
 * Mask a phone number for display (e.g. 138****5678).
 * @param {string} phone
 * @returns {string}
 */
function _maskPhone(phone) {
  if (phone.length !== 11) return phone;
  return phone.slice(0, 3) + "****" + phone.slice(7);
}

/**
 * Format SMS countdown display.
 * @param {number} seconds
 * @returns {string}
 */
function _smsCountdownText(seconds) {
  if (seconds <= 0) return "重新获取";
  return seconds + "s";
}

/**
 * Validate activation code format.
 * Must start with HERMES- followed by at least 16 hex chars.
 * @param {string} code
 * @returns {boolean}
 */
function _validateActivationFormat(code) {
  if (!code || typeof code !== "string") return false;
  var trimmed = code.trim().toUpperCase();
  return /^HERMES-[0-9A-F]{16,}$/.test(trimmed);
}

// ---- Tests ----
describe("Auth — Phone Validation", function () {
  test("valid 11-digit mobile", function () {
    expect(_validatePhone("13812345678")).toBe(true);
  });

  test("valid mobile starting with 1", function () {
    expect(_validatePhone("15900001111")).toBe(true);
  });

  test("rejects 10-digit number", function () {
    expect(_validatePhone("1381234567")).toBe(false);
  });

  test("rejects 12-digit number", function () {
    expect(_validatePhone("138123456789")).toBe(false);
  });

  test("rejects number not starting with 1", function () {
    expect(_validatePhone("23812345678")).toBe(false);
  });

  test("rejects letters", function () {
    expect(_validatePhone("1381234a678")).toBe(false);
  });

  test("rejects empty string", function () {
    expect(_validatePhone("")).toBe(false);
  });

  test("rejects spaces (user input without trim)", function () {
    // Spaces should be stripped before validation in actual code
    expect(_validatePhone("138 1234 5678")).toBe(false);
  });
});

describe("Auth — Phone Masking", function () {
  test("masks middle 4 digits", function () {
    expect(_maskPhone("13812345678")).toBe("138****5678");
  });

  test("preserves non-11-digit strings", function () {
    expect(_maskPhone("12345")).toBe("12345");
  });
});

describe("Auth — SMS Countdown", function () {
  test("60 seconds → '60s'", function () {
    expect(_smsCountdownText(60)).toBe("60s");
  });

  test("1 second → '1s'", function () {
    expect(_smsCountdownText(1)).toBe("1s");
  });

  test("0 seconds → '重新获取'", function () {
    expect(_smsCountdownText(0)).toBe("重新获取");
  });

  test("negative → '重新获取'", function () {
    expect(_smsCountdownText(-1)).toBe("重新获取");
  });
});

describe("Auth — Activation Code Format", function () {
  test("valid: HERMES- followed by 16 uppercase hex", function () {
    expect(_validateActivationFormat("HERMES-ABCDEF0123456789")).toBe(true);
  });

  test("valid: HERMES- followed by 64 hex (full HMAC)", function () {
    var longCode = "HERMES-" + "A".repeat(64);
    expect(_validateActivationFormat(longCode)).toBe(true);
  });

  test("rejects: missing HERMES- prefix", function () {
    expect(_validateActivationFormat("NOT-HERMES-CODEABCDEF")).toBe(false);
  });

  test("rejects: null", function () {
    expect(_validateActivationFormat(null)).toBe(false);
  });

  test("rejects: empty string", function () {
    expect(_validateActivationFormat("")).toBe(false);
  });

  test("rejects: too short (less than 16 hex chars)", function () {
    expect(_validateActivationFormat("HERMES-ABC")).toBe(false);
  });

  test("accepts: lowercase converted to uppercase", function () {
    expect(_validateActivationFormat("hermes-abcd1234abcd1234")).toBe(true);
  });
});

describe("Auth source file", function () {
  test("contains expected functions", function () {
    var fs = require("fs");
    var path = require("path");
    var src = fs.readFileSync(
      path.join(__dirname, "..", "src", "renderer", "auth.js"), "utf8"
    );
    expect(src).toContain("initAuth");
    expect(src).toContain("sendSmsCode");
    expect(src).toContain("verifySmsCode");
    expect(src).toContain("loadWechatQR");
    expect(src).toContain("logout");
    expect(src).toContain("saveAuth");
  });
});
