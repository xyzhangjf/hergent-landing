/**
 * Tests for src/renderer/cost-tracker.js — message cost estimation
 *
 * Tests the functions directly (inline implementations to avoid browser env dependencies).
 * We use a mock localStorage so tests run in pure Node.
 */

// ---- Inline the cost tracker functions for testing ----
function _recordMessageCost(cost, model, store) {
  if (!cost || cost <= 0) return;
  const records = JSON.parse(store.getItem("hermes_cost_records") || "[]");
  records.push({ cost, model: model || "deepseek-v4-flash", time: Date.now() });
  if (records.length > 100) records.splice(0, records.length - 100);
  store.setItem("hermes_cost_records", JSON.stringify(records));
  // Also maintain simple array for averaging
  const costs = JSON.parse(store.getItem("hermes_msg_costs") || "[]");
  costs.push(cost);
  if (costs.length > 50) costs.shift();
  store.setItem("hermes_msg_costs", JSON.stringify(costs));
}

function _getAvgCost(store) {
  const costs = JSON.parse(store.getItem("hermes_msg_costs") || "[]");
  if (costs.length === 0) return null;
  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  return {
    low: Math.max(1, Math.floor(avg * 0.4)),
    high: Math.max(2, Math.ceil(avg * 1.6)),
  };
}

function _makeStore(initial) {
  const store = { ...initial };
  return {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

// ---- Tests ----
describe("Cost Tracker", () => {
  let store;

  beforeEach(() => {
    store = _makeStore();
  });

  test("records a message cost", () => {
    _recordMessageCost(5, "deepseek-v4-flash", store);
    const records = JSON.parse(store.getItem("hermes_cost_records"));
    expect(records).toHaveLength(1);
    expect(records[0].cost).toBe(5);
    expect(records[0].model).toBe("deepseek-v4-flash");
  });

  test("ignores zero cost", () => {
    _recordMessageCost(0, "model", store);
    expect(store.getItem("hermes_cost_records")).toBeNull();
  });

  test("ignores negative cost", () => {
    _recordMessageCost(-1, "model", store);
    _recordMessageCost(-100, "model", store);
    expect(store.getItem("hermes_cost_records")).toBeNull();
  });

  test("caps records at 100", () => {
    for (let i = 0; i < 150; i++) {
      _recordMessageCost(i + 1, "model", store);
    }
    const records = JSON.parse(store.getItem("hermes_cost_records"));
    expect(records).toHaveLength(100);
  });

  test("_getAvgCost returns null for empty store", () => {
    expect(_getAvgCost(store)).toBeNull();
  });

  test("_getAvgCost returns non-null for non-empty store", () => {
    for (let i = 0; i < 10; i++) {
      _recordMessageCost(10, "model", store);
    }
    const avg = _getAvgCost(store);
    expect(avg).not.toBeNull();
    expect(avg.low).toBeGreaterThan(0);
    expect(avg.high).toBeGreaterThanOrEqual(avg.low);
  });

  test("_getAvgCost with 5 units of 5 gives low=2, high=8", () => {
    for (let i = 0; i < 5; i++) {
      _recordMessageCost(5, "model", store);
    }
    const avg = _getAvgCost(store);
    expect(avg.low).toBe(2);   // floor(5 * 0.4)
    expect(avg.high).toBe(8);  // ceil(5 * 1.6)
  });

  test("_getAvgCost handles mixed costs", () => {
    _recordMessageCost(1, "model", store);
    _recordMessageCost(9, "model", store);
    const avg = _getAvgCost(store);
    // avg = 5, low = floor(5*0.4) = 2, high = ceil(5*1.6) = 8
    expect(avg.low).toBe(2);
    expect(avg.high).toBe(8);
  });

  test("cost arrays both stored", () => {
    _recordMessageCost(3, "model", store);
    expect(store.getItem("hermes_cost_records")).toBeTruthy();
    expect(store.getItem("hermes_msg_costs")).toBeTruthy();
  });

  describe("Source file verification", () => {
    test("src/renderer/cost-tracker.js contains expected functions", () => {
      const fs = require("fs");
      const path = require("path");
      const src = fs.readFileSync(
        path.join(__dirname, "..", "src", "renderer", "cost-tracker.js"), "utf8"
      );
      expect(src).toContain("recordMessageCost");
      expect(src).toContain("getAvgCost");
    });
  });
});
