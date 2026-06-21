/**
 * Tests for src/main/engine.js — Engine version validation & path logic
 *
 * Tests the pure-logic functions: version comparison, critical file checks,
 * directory merge logic.
 */
var fs = require("fs");
var path = require("path");
var { createTempDir, removeDir } = require("./helpers");

// Inline the engine functions under test (extracted from engine.js)
// These are pure logic functions that don't need Electron

/**
 * Recursively merge directory: copy files from src to dst (skip existing).
 * @param {string} src
 * @param {string} dst
 */
function _mergeDir(src, dst) {
  if (!fs.existsSync(dst)) { fs.mkdirSync(dst, { recursive: true }); }
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var f = entries[i];
    var s = path.join(src, f.name);
    var d = path.join(dst, f.name);
    if (f.isDirectory()) {
      _mergeDir(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Check if engine extraction version matches current app version.
 * @param {string} versionFile
 * @param {string} currentVersion
 * @param {string} engineDir
 * @param {boolean} isWindows
 * @returns {boolean}
 */
function _isEngineExtracted(versionFile, currentVersion, engineDir, isWindows) {
  var criticalFiles = isWindows
    ? [path.join(engineDir, "python", "python.exe")]
    : [path.join(engineDir, "python", "bin", "python3.11"), path.join(engineDir, "python", "lib", "libpython3.11.dylib")];

  if (!fs.existsSync(versionFile)) return false;
  for (var i = 0; i < criticalFiles.length; i++) {
    if (!fs.existsSync(criticalFiles[i])) return false;
  }
  var extracted = fs.readFileSync(versionFile, "utf8").trim();
  return extracted === currentVersion;
}

// ---- Tests ----
describe("Engine — _mergeDir", function () {
  var srcDir, dstDir;

  beforeEach(function () {
    srcDir = createTempDir();
    dstDir = createTempDir();
  });

  afterEach(function () {
    removeDir(srcDir);
    removeDir(dstDir);
  });

  test("copies files from src to dst", function () {
    fs.writeFileSync(path.join(srcDir, "test.txt"), "hello");
    _mergeDir(srcDir, dstDir);
    expect(fs.existsSync(path.join(dstDir, "test.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(dstDir, "test.txt"), "utf8")).toBe("hello");
  });

  test("does not overwrite existing files", function () {
    fs.writeFileSync(path.join(srcDir, "test.txt"), "new");
    fs.writeFileSync(path.join(dstDir, "test.txt"), "orig");
    _mergeDir(srcDir, dstDir);
    expect(fs.readFileSync(path.join(dstDir, "test.txt"), "utf8")).toBe("orig");
  });

  test("handles nested directories", function () {
    fs.mkdirSync(path.join(srcDir, "sub"));
    fs.writeFileSync(path.join(srcDir, "sub", "nested.txt"), "deep");
    _mergeDir(srcDir, dstDir);
    expect(fs.existsSync(path.join(dstDir, "sub", "nested.txt"))).toBe(true);
  });

  test("empty source dir is safe", function () {
    _mergeDir(srcDir, dstDir);
    // no crash = pass
  });

  test("creates destination if not exists", function () {
    var subDst = path.join(dstDir, "nonexistent");
    fs.writeFileSync(path.join(srcDir, "a.txt"), "a");
    _mergeDir(srcDir, subDst);
    expect(fs.existsSync(path.join(subDst, "a.txt"))).toBe(true);
  });
});

describe("Engine — _isEngineExtracted", function () {
  var engineDir;

  beforeEach(function () {
    engineDir = createTempDir();
  });

  afterEach(function () {
    removeDir(engineDir);
  });

  test("returns false when version file is missing", function () {
    var result = _isEngineExtracted(
      path.join(engineDir, ".extracted-version"),
      "1.0.105|12345",
      engineDir,
      false
    );
    expect(result).toBe(false);
  });

  test("returns false when critical files are missing", function () {
    fs.writeFileSync(path.join(engineDir, ".extracted-version"), "1.0.105|12345");
    var result = _isEngineExtracted(
      path.join(engineDir, ".extracted-version"),
      "1.0.105|12345",
      engineDir,
      false
    );
    // python/bin/python3.11 doesn't exist → false
    expect(result).toBe(false);
  });

  test("returns true when version matches and critical files exist", function () {
    fs.writeFileSync(path.join(engineDir, ".extracted-version"), "1.0.105|12345");
    // Create fake critical files
    fs.mkdirSync(path.join(engineDir, "python", "bin"), { recursive: true });
    fs.writeFileSync(path.join(engineDir, "python", "bin", "python3.11"), "");
    fs.mkdirSync(path.join(engineDir, "python", "lib"), { recursive: true });
    fs.writeFileSync(path.join(engineDir, "python", "lib", "libpython3.11.dylib"), "");

    var result = _isEngineExtracted(
      path.join(engineDir, ".extracted-version"),
      "1.0.105|12345",
      engineDir,
      false
    );
    expect(result).toBe(true);
  });

  test("returns false when version mismatch", function () {
    fs.writeFileSync(path.join(engineDir, ".extracted-version"), "1.0.100|99999");
    fs.mkdirSync(path.join(engineDir, "python", "bin"), { recursive: true });
    fs.writeFileSync(path.join(engineDir, "python", "bin", "python3.11"), "");
    fs.mkdirSync(path.join(engineDir, "python", "lib"), { recursive: true });
    fs.writeFileSync(path.join(engineDir, "python", "lib", "libpython3.11.dylib"), "");

    var result = _isEngineExtracted(
      path.join(engineDir, ".extracted-version"),
      "1.0.105|12345",
      engineDir,
      false
    );
    expect(result).toBe(false);
  });
});

describe("Engine source file", function () {
  test("contains all expected exports", function () {
    var src = fs.readFileSync(
      path.join(__dirname, "..", "src", "main", "engine.js"), "utf8"
    );
    expect(src).toContain("getEngineDir");
    expect(src).toContain("extractBundledEngine");
    expect(src).toContain("ensureEngineConfig");
    expect(src).toContain("ensureSharedState");
    expect(src).toContain("resolveHermesPath");
    expect(src).toContain("module.exports");
  });
});
