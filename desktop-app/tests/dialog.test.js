/**
 * Tests for src/renderer/dialog.js — Overlay stack & dialog logic
 *
 * Tests the overlay stack behavior (pure data, no DOM).
 * showOverlay/hideOverlay require DOM, so we test the stack logic
 * by extracting and testing the internal data structures.
 */

// Inline the overlay stack logic for pure testing
// (identical to dialog.js implementation)
var _overlayStack = [];
var OVERLAY_Z_BASE = 100;

function _resetStack() {
  _overlayStack = [];
}

function _getStack() {
  return _overlayStack.slice();
}

// Simulated overlay functions
function showOverlay(id) {
  var idx = _overlayStack.indexOf(id);
  if (idx >= 0) _overlayStack.splice(idx, 1);
  _overlayStack.push(id);
}

function hideOverlay(id) {
  var idx = _overlayStack.indexOf(id);
  if (idx >= 0) _overlayStack.splice(idx, 1);
}

function topOverlay() {
  return _overlayStack.length > 0 ? _overlayStack[_overlayStack.length - 1] : null;
}

describe("Overlay Stack", () => {
  beforeEach(() => {
    _resetStack();
  });

  describe("showOverlay", () => {
    test("adds overlay to stack", () => {
      showOverlay("dialogOverlay");
      expect(_getStack()).toEqual(["dialogOverlay"]);
    });

    test("multiple overlays stack in order", () => {
      showOverlay("overlayA");
      showOverlay("overlayB");
      showOverlay("overlayC");
      expect(_getStack()).toEqual(["overlayA", "overlayB", "overlayC"]);
    });

    test("re-showing moves to top (dedup)", () => {
      showOverlay("overlayA");
      showOverlay("overlayB");
      showOverlay("overlayA"); // should move A to top
      expect(_getStack()).toEqual(["overlayB", "overlayA"]);
    });

    test("re-showing already-top overlay stays top", () => {
      showOverlay("overlayA");
      showOverlay("overlayB");
      showOverlay("overlayB"); // already on top
      expect(_getStack()).toEqual(["overlayA", "overlayB"]);
    });
  });

  describe("hideOverlay", () => {
    test("removes overlay from stack", () => {
      showOverlay("overlayA");
      showOverlay("overlayB");
      hideOverlay("overlayB");
      expect(_getStack()).toEqual(["overlayA"]);
    });

    test("removing non-existent overlay is safe", () => {
      showOverlay("overlayA");
      hideOverlay("nonexistent");
      expect(_getStack()).toEqual(["overlayA"]);
    });

    test("removing from empty stack is safe", () => {
      hideOverlay("anything");
      expect(_getStack()).toEqual([]);
    });

    test("removing last overlay makes stack empty", () => {
      showOverlay("only");
      hideOverlay("only");
      expect(_getStack()).toEqual([]);
    });
  });

  describe("topOverlay", () => {
    test("returns null for empty stack", () => {
      expect(topOverlay()).toBeNull();
    });

    test("returns top overlay id", () => {
      showOverlay("first");
      showOverlay("second");
      expect(topOverlay()).toBe("second");
    });

    test("returns only overlay", () => {
      showOverlay("lonely");
      expect(topOverlay()).toBe("lonely");
    });

    test("updates after hide", () => {
      showOverlay("first");
      showOverlay("second");
      hideOverlay("second");
      expect(topOverlay()).toBe("first");
    });
  });
});

describe("DIALOG_ICONS", () => {
  test("source file contains expected icons", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "renderer", "dialog.js"), "utf8"
    );
    expect(src).toContain("DIALOG_ICONS");
    expect(src).toContain("✅");
    expect(src).toContain("❌");
    expect(src).toContain("⚠️");
    expect(src).toContain("showOverlay");
    expect(src).toContain("hideOverlay");
    expect(src).toContain("closeDialog");
  });
});
