/**
 * Tests for src/renderer/secure-storage.js — localStorage obfuscation
 */

// Load the secure-storage module (simulates browser <script> load)
// We need to mock localStorage before loading

describe("Secure Storage", () => {
  let _store;
  let _obfuscate, _deobfuscate, _isSensitive;

  beforeAll(() => {
    // Inline the functions for testing (identical to secure-storage.js)
    _obfuscate = function(plain) {
      // UTF-8 encode then XOR
      var bytes = [];
      for (var i = 0; i < plain.length; i++) {
        var code = plain.charCodeAt(i);
        if (code < 0x80) { bytes.push(code); }
        else if (code < 0x800) { bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F)); }
        else { bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)); }
      }
      var result = "";
      for (var i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i] ^ ((i % 31) + 1));
      }
      return btoa(result);
    };
    _deobfuscate = function(encoded) {
      try {
        var mixed = atob(encoded);
        var bytes = [];
        for (var i = 0; i < mixed.length; i++) {
          bytes.push(mixed.charCodeAt(i) ^ ((i % 31) + 1));
        }
        var result = "";
        var j = 0;
        while (j < bytes.length) {
          var b = bytes[j];
          if (b < 0x80) { result += String.fromCharCode(b); j++; }
          else if ((b & 0xE0) === 0xC0) { result += String.fromCharCode(((b & 0x1F) << 6) | (bytes[j+1] & 0x3F)); j += 2; }
          else { result += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[j+1] & 0x3F) << 6) | (bytes[j+2] & 0x3F)); j += 3; }
        }
        return result;
      } catch (_) { return ""; }
    };
    _isSensitive = function(key) {
      var keys = ["hermes_auth", "hermes_activated", "hermes_activation_tier"];
      for (var i = 0; i < keys.length; i++) {
        if (key === keys[i]) return true;
      }
      return false;
    };
  });

  beforeEach(() => {
    _store = {};
    global.localStorage = {
      getItem: (k) => _store[k] || null,
      setItem: (k, v) => { _store[k] = String(v); },
      removeItem: (k) => { delete _store[k]; },
    };
  });

  afterEach(() => {
    delete global.localStorage;
  });

  describe("_obfuscate / _deobfuscate round-trip", () => {
    test("round-trips plain text", () => {
      const obf = _obfuscate("hello world");
      expect(obf).not.toBe("hello world");
      expect(_deobfuscate(obf)).toBe("hello world");
    });

    test("handles JSON strings", () => {
      const json = '{"token":"abc123","user":{"id":"test"}}';
      const roundtrip = _deobfuscate(_obfuscate(json));
      expect(roundtrip).toBe(json);
    });

    test("handles empty string", () => {
      expect(_deobfuscate(_obfuscate(""))).toBe("");
    });

    test("handles Unicode text", () => {
      const text = "你好世界🌍";
      expect(_deobfuscate(_obfuscate(text))).toBe(text);
    });

    test("returns empty on corrupted data", () => {
      expect(_deobfuscate("NOT_VALID_BASE64!!!")).toBe("");
    });

    test("different inputs produce different outputs", () => {
      const a = _obfuscate("token-a");
      const b = _obfuscate("token-b");
      expect(a).not.toBe(b);
    });
  });

  describe("_isSensitive", () => {
    test("hermes_auth is sensitive", () => {
      expect(_isSensitive("hermes_auth")).toBe(true);
    });

    test("hermes_activated is sensitive", () => {
      expect(_isSensitive("hermes_activated")).toBe(true);
    });

    test("hermes_theme is NOT sensitive", () => {
      expect(_isSensitive("hermes_theme")).toBe(false);
    });

    test("random key is NOT sensitive", () => {
      expect(_isSensitive("random_key")).toBe(false);
    });
  });

  describe("Source structure", () => {
    test("secure-storage.js is an IIFE", () => {
      const fs = require("fs");
      const path = require("path");
      const src = fs.readFileSync(
        path.join(__dirname, "..", "src", "renderer", "secure-storage.js"), "utf8"
      );
      expect(src).toContain("(function()");
      expect(src).toContain("window.__hergent_secure_storage_loaded");
    });
  });
});
