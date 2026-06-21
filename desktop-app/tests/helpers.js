// Test helpers for Hergent Desktop unit tests
const fs = require("fs");
const path = require("path");
const os = require("os");

// Create a clean temp directory for each test
function createTempDir() {
  const dir = path.join(os.tmpdir(), "hergent-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Recursively remove a directory
function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Create a mock fs filesystem in a temp dir
function mockFilesystem(files) {
  const root = createTempDir();
  for (const [filepath, content] of Object.entries(files)) {
    const fullPath = path.join(root, filepath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return root;
}

// Mock localStorage for renderer module tests
function mockLocalStorage(initialData = {}) {
  const store = { ...initialData };
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    _getStore: () => ({ ...store }),
  };
}

// Mock DOM helpers
function mockDocument() {
  const elements = {};
  const classLists = {};
  return {
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: "",
        style: {},
        innerHTML: "",
        textContent: "",
        classList: {
          add: (c) => { el.className += " " + c; },
          remove: (c) => { el.className = el.className.replace(c, ""); },
          toggle: (c) => { /* no-op */ },
          contains: (c) => el.className.includes(c),
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: (child) => {},
        setAttribute: () => {},
        getAttribute: () => null,
      };
      return el;
    },
    body: {
      appendChild: () => {},
    },
    addEventListener: () => {},
    hidden: false,
  };
}

module.exports = {
  createTempDir, removeDir, mockFilesystem,
  mockLocalStorage, mockDocument,
};
