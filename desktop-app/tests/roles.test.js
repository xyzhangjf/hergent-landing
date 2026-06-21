/**
 * Tests for src/main/roles.js — Role CRUD operations
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createTempDir, removeDir } = require("./helpers");

// Use moduleNameMapper for electron
let testDir;
let roles;

beforeEach(() => {
  testDir = createTempDir();

  // Override electron mock's getPath
  const electron = require("electron");
  electron.app.getPath = (name) => {
    if (name === "userData") return testDir;
    return os.tmpdir();
  };

  delete require.cache[require.resolve("../src/main/roles")];
  delete require.cache[require.resolve("../src/main/constants")];

  roles = require("../src/main/roles");
  roles.init(electron.app);
});

afterEach(() => {
  removeDir(testDir);
});

describe("Roles CRUD", () => {
  test("loadRoles returns DEFAULT_ROLES when no file exists", () => {
    const result = roles.loadRoles();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result.dami).toBeDefined();
    expect(result.dami.name).toBe("大秘");
  });

  test("loadRoles returns parsed data even for empty file (falls back to defaults)", () => {
    fs.writeFileSync(path.join(testDir, "roles.json"), "{}");
    delete require.cache[require.resolve("../src/main/roles")];
    roles = require("../src/main/roles");
    roles.init(require("electron").app);
    const result = roles.loadRoles();
    // {} is a valid object, so it's returned as-is (no dami key)
    expect(typeof result).toBe("object");
    expect(result.dami).toBeUndefined(); // empty object has no keys
  });

  test("loadRoles returns persisted roles when file exists", () => {
    const custom = { dami: { name: "自定义大秘", systemPrompt: "hello" } };
    fs.writeFileSync(path.join(testDir, "roles.json"), JSON.stringify(custom));
    delete require.cache[require.resolve("../src/main/roles")];
    roles = require("../src/main/roles");
    roles.init(require("electron").app);
    const result = roles.loadRoles();
    expect(result.dami.name).toBe("自定义大秘");
  });

  test("loadRoles ignores non-object JSON", () => {
    fs.writeFileSync(path.join(testDir, "roles.json"), "[1,2,3]");
    delete require.cache[require.resolve("../src/main/roles")];
    roles = require("../src/main/roles");
    roles.init(require("electron").app);
    const result = roles.loadRoles();
    expect(result.dami.name).toBe("大秘");
  });

  test("saveRoles writes JSON to disk", () => {
    const data = { dami: { name: "Test", systemPrompt: "test" } };
    roles.saveRoles(data);
    const p = path.join(testDir, "roles.json");
    expect(fs.existsSync(p)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(parsed.dami.name).toBe("Test");
  });

  test("save and load round-trip", () => {
    const data = { dami: { name: "大秘2", systemPrompt: "prompt2", builtIn: false } };
    roles.saveRoles(data);
    delete require.cache[require.resolve("../src/main/roles")];
    roles = require("../src/main/roles");
    roles.init(require("electron").app);
    const loaded = roles.loadRoles();
    expect(loaded.dami.name).toBe("大秘2");
    expect(loaded.dami.builtIn).toBe(false);
  });

  test("loadRoles returns 8 default roles", () => {
    const result = roles.loadRoles();
    const ids = Object.keys(result);
    expect(ids).toHaveLength(8);
    expect(ids).toContain("dami");
    expect(ids).toContain("accountant");
    expect(ids).toContain("programmer");
    expect(ids).toContain("writer");
    expect(ids).toContain("screenwriter");
    expect(ids).toContain("tutor");
    expect(ids).toContain("ops-manager");
    expect(ids).toContain("cs-helper");
  });
});
