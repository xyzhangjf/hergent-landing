/// <reference path="../types.d.ts" />
// @ts-check
// Hergent Desktop — localStorage security wrapper

(function() {
  if (window.__hergent_secure_storage_loaded) return;
  window.__hergent_secure_storage_loaded = true;

  /** @type {string[]} Keys that should be obfuscated at rest */
  var SECURE_KEYS = [
    "hermes_auth",
    "hermes_activated",
    "hermes_activation_tier",
  ];

  /** @type {{getItem:function, setItem:function, removeItem:function}} */
  var _orig = {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
  };

  /**
   * Check if a localStorage key contains sensitive data.
   * @param {string} key
   * @returns {boolean}
   */
  function _isSensitive(key) {
    for (var i = 0; i < SECURE_KEYS.length; i++) {
      if (key === SECURE_KEYS[i]) return true;
    }
    return false;
  }

  /**
   * XOR-mix + base64 obfuscation with UTF-8 encoding.
   * @param {string} plain
   * @returns {string}
   */
  function _obfuscate(plain) {
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
  }

  /**
   * Decode obfuscated base64 string.
   * @param {string} encoded
   * @returns {string}
   */
  function _deobfuscate(encoded) {
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
    } catch (_) {
      return "";
    }
  }

  // Wrap localStorage
  localStorage.getItem = function(key) {
    var val = _orig.getItem(key);
    if (!val || !_isSensitive(key)) return val;
    if (val.indexOf("$obf:") === 0) {
      return _deobfuscate(val.slice(5));
    }
    _orig.setItem(key, "$obf:" + _obfuscate(val));
    return val;
  };

  localStorage.setItem = function(key, val) {
    if (_isSensitive(key) && typeof val === "string") {
      _orig.setItem(key, "$obf:" + _obfuscate(val));
    } else {
      _orig.setItem(key, val);
    }
  };

  // Export for testing
  window.__hergent_secure_storage = {
    _obfuscate: _obfuscate,
    _deobfuscate: _deobfuscate,
    _isSensitive: _isSensitive,
  };
})();
