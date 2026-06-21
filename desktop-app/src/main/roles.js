/**
 * Hergent Desktop — Role Management
 * CRUD for AI role definitions, persisted to roles.json.
 */
const path = require("path");
const fs = require("fs");
const { DEFAULT_ROLES } = require("./constants");

// Lazy init — app must be ready before calling any function
let _app = null;

function init(app) { _app = app; }

function getRolesPath() {
  return path.join(_app.getPath("userData"), "roles.json");
}

function loadRoles() {
  try {
    const rp = getRolesPath();
    if (fs.existsSync(rp)) {
      const data = JSON.parse(fs.readFileSync(rp, "utf8"));
      if (typeof data === "object" && !Array.isArray(data)) return data;
    }
  } catch (_) {}
  return { ...DEFAULT_ROLES };
}

function saveRoles(roles) {
  fs.writeFileSync(getRolesPath(), JSON.stringify(roles, null, 2));
}

module.exports = { init, getRolesPath, loadRoles, saveRoles };
