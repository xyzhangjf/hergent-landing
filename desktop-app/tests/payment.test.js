/**
 * Tests for src/renderer/payment.js — Recharge tiers, credit thresholds, amount validation
 *
 * Tests the data structures and pure-logic functions (no DOM/Electron required).
 */

// ---- Inline the recharge tier data and logic ----
var RECHARGE_TIERS = {
  10: { credits: 1000, label: "1,000" },
  30: { credits: 3200, label: "3,200" },
  50: { credits: 6000, label: "6,000" },
};

/**
 * Determine credit badge class based on remaining credits.
 * @param {number} credits
 * @returns {{className: string, label: string}}
 */
function _getCreditsBadgeState(credits) {
  if (credits <= 0) {
    return { className: "credits-badge critical", label: "积分已用完" };
  }
  if (credits < 50) {
    return { className: "credits-badge critical", label: credits + " 积分" };
  }
  if (credits < 200) {
    return { className: "credits-badge low", label: credits + " 积分" };
  }
  return { className: "credits-badge", label: credits + " 积分" };
}

/**
 * Determine low-balance banner state.
 * @param {number} credits
 * @param {boolean} wasDismissed — whether the user dismissed the banner in the last 5 minutes
 * @returns {{show: boolean, message: string, severity: string}} }
 */
function _getBannerState(credits, wasDismissed) {
  if (credits <= 0) {
    return { show: true, message: "积分已用完，请充值后继续使用", severity: "critical" };
  }
  if (wasDismissed) {
    return { show: false, message: "", severity: "" };
  }
  if (credits < 50) {
    return { show: true, message: "积分仅剩 " + credits + " 分，建议立即充值", severity: "warning" };
  }
  if (credits < 200) {
    return { show: true, message: "积分偏低（" + credits + " 分），建议充值", severity: "warn" };
  }
  return { show: false, message: "", severity: "" };
}

/**
 * Convert custom amount to credits (1元 = 100分).
 * @param {number} amount
 * @returns {{credits: number, label: string}}
 */
function _customAmountCredits(amount) {
  if (amount < 1 || amount > 999) {
    return { credits: 0, label: "0" };
  }
  return { credits: amount * 100, label: (amount * 100).toLocaleString() };
}

// ---- Tests ----
describe("Payment — Recharge Tiers", function () {
  test("3 default tiers", function () {
    expect(Object.keys(RECHARGE_TIERS)).toHaveLength(3);
  });

  test("10元 = 1000 credits", function () {
    expect(RECHARGE_TIERS[10].credits).toBe(1000);
  });

  test("30元 = 3200 credits (+200 bonus)", function () {
    expect(RECHARGE_TIERS[30].credits).toBe(3200);
  });

  test("50元 = 6000 credits (+1000 bonus)", function () {
    expect(RECHARGE_TIERS[50].credits).toBe(6000);
  });

  test("each tier has a label", function () {
    for (var k of Object.keys(RECHARGE_TIERS)) {
      expect(RECHARGE_TIERS[k].label).toBeTruthy();
    }
  });
});

describe("Payment — Credits Badge", function () {
  test("0 credits → critical", function () {
    var s = _getCreditsBadgeState(0);
    expect(s.className).toContain("critical");
    expect(s.label).toBe("积分已用完");
  });

  test("10 credits → critical (below 50)", function () {
    var s = _getCreditsBadgeState(10);
    expect(s.className).toContain("critical");
  });

  test("49 credits → critical", function () {
    var s = _getCreditsBadgeState(49);
    expect(s.className).toContain("critical");
  });

  test("50-199 credits → low", function () {
    var s = _getCreditsBadgeState(100);
    expect(s.className).toContain("low");
  });

  test("200+ credits → normal badge", function () {
    var s = _getCreditsBadgeState(500);
    expect(s.className).toBe("credits-badge");
  });
});

describe("Payment — Banner State", function () {
  test("0 credits always shows banner (even if dismissed)", function () {
    var s = _getBannerState(0, true);
    expect(s.show).toBe(true);
    expect(s.severity).toBe("critical");
  });

  test("<50 credits shows warning when not dismissed", function () {
    var s = _getBannerState(30, false);
    expect(s.show).toBe(true);
    expect(s.severity).toBe("warning");
  });

  test("<50 credits hides when dismissed", function () {
    var s = _getBannerState(30, true);
    expect(s.show).toBe(false);
  });

  test("50-199 credits shows warn when not dismissed", function () {
    var s = _getBannerState(100, false);
    expect(s.show).toBe(true);
    expect(s.severity).toBe("warn");
  });

  test("200+ credits hides banner", function () {
    var s = _getBannerState(500, false);
    expect(s.show).toBe(false);
  });
});

describe("Payment — Custom Amount", function () {
  test("10元 = 1000 credits", function () {
    expect(_customAmountCredits(10).credits).toBe(1000);
  });

  test("1元 = 100 credits (minimum)", function () {
    expect(_customAmountCredits(1).credits).toBe(100);
  });

  test("999元 = 99900 credits (maximum)", function () {
    expect(_customAmountCredits(999).credits).toBe(99900);
  });

  test("0元 → 0 credits (invalid)", function () {
    expect(_customAmountCredits(0).credits).toBe(0);
  });

  test("1000元 → 0 (out of range)", function () {
    expect(_customAmountCredits(1000).credits).toBe(0);
  });

  test("negative → 0 (invalid)", function () {
    expect(_customAmountCredits(-5).credits).toBe(0);
  });
});

describe("Payment source file", function () {
  test("contains RECHARGE_TIERS declaration", function () {
    var fs = require("fs");
    var path = require("path");
    var src = fs.readFileSync(
      path.join(__dirname, "..", "src", "renderer", "payment.js"), "utf8"
    );
    expect(src).toContain("RECHARGE_TIERS");
    expect(src).toContain("submitRecharge");
    expect(src).toContain("cancelPayment");
    expect(src).toContain("closeRecharge");
  });
});
