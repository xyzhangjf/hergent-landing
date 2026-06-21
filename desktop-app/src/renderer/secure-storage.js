// Hergent Desktop — localStorage security wrapper
// Applies obfuscation to sensitive keys at rest.
// Defense-in-depth: the primary security boundary is Electron's contextIsolation.

(function() {
  if (window.__hergent_secure_storage_loaded) return;
  window.__hergent_secure_storage_loaded = true;

  // Keys that should be obfuscated at rest
  var SECURE_KEYS = [
    "hermes_auth",
    "hermes_activated",
    "hermes_activation_tier",
  ];

  var _orig = {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage),
  };

  function _isSensitive(key) {
    for (var i = 0; i < SECURE_KEYS.length; i++) {
      if (key === SECURE_KEYS[i]) return true;
    }
    return false;
  }

  function _obfuscate(plain) {
    // XOR-mix + base64. Pre-encode to UTF-8 bytes for Unicode safety.
    var bytes = [];
    for (var i = 0; i < plain.length; i++) {
      var code = plain.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    var result = "";
    for (var i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i] ^ ((i % 31) + 1));
    }
    return btoa(result);
  }

  function _deobfuscate(encoded) {
    try {
      var mixed = atob(encoded);
      var bytes = [];
      for (var i = 0; i < mixed.length; i++) {
        bytes.push(mixed.charCodeAt(i) ^ ((i % 31) + 1));
      }
      // Decode UTF-8 bytes back to string
      var result = "";
      var j = 0;
      while (j < bytes.length) {
        var b = bytes[j];
        if (b < 0x80) {
          result += String.fromCharCode(b); j++;
        } else if ((b & 0xE0) === 0xC0) {
          result += String.fromCharCode(((b & 0x1F) << 6) | (bytes[j+1] & 0x3F)); j += 2;
        } else {
          result += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[j+1] & 0x3F) << 6) | (bytes[j+2] & 0x3F)); j += 3;
        }
      }
      return result;
    } catch (_) {
      return ""; // Corrupted data — return empty
    }
  }

  localStorage.getItem = function(key) {
    var val = _orig.getItem(key);
    if (!val || !_isSensitive(key)) return val;
    if (val.indexOf("$obf:") === 0) {
      return _deobfuscate(val.slice(5));
    }
    // Migrate: re-save old plaintext as obfuscated
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
