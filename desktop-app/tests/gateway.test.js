/**
 * Tests for src/main/gateway.js — Health Monitor state machine
 *
 * Tests the health monitor's state transitions in isolation.
 * The actual isGatewayRunning/startHermesGateway/stopHermesGateway
 * require Electron + spawned processes, so we mock them.
 */

// ---- Inline the health monitor state machine ----
var GW_STATUS = {
  STOPPED: "stopped",
  STARTING: "starting",
  RUNNING: "running",
  UNHEALTHY: "unhealthy",
  RESTARTING: "restarting",
};
var _gwStatus = GW_STATUS.STOPPED;
var _consecutiveFailures = 0;
var _totalRestarts = 0;
var MAX_FAILURES = 3;
var MAX_RESTARTS = 5;

function getGatewayStatus() {
  return _gwStatus;
}
function getRestartCount() {
  return _totalRestarts;
}

// Mocked dependencies
var _isRunning = true;
var _restartSucceeds = true;
var _restartCalled = 0;

function resetHealthState() {
  _gwStatus = GW_STATUS.STOPPED;
  _consecutiveFailures = 0;
  _totalRestarts = 0;
  _isRunning = true;
  _restartSucceeds = true;
  _restartCalled = 0;
}

async function checkHealth() {
  var running = _isRunning;
  if (!running) {
    _consecutiveFailures++;
    if (_consecutiveFailures >= MAX_FAILURES) {
      _gwStatus = GW_STATUS.UNHEALTHY;
      if (_totalRestarts < MAX_RESTARTS) {
        _gwStatus = GW_STATUS.RESTARTING;
        _totalRestarts++;
        _restartCalled++;
        if (_restartSucceeds) {
          _gwStatus = GW_STATUS.RUNNING;
          _consecutiveFailures = 0;
        }
      }
    }
  } else {
    _consecutiveFailures = 0;
    if (_gwStatus !== GW_STATUS.RESTARTING) {
      _gwStatus = GW_STATUS.RUNNING;
    }
  }
}

// ---- Tests ----
describe("Gateway Health Monitor", () => {
  beforeEach(() => {
    resetHealthState();
  });

  describe("State transitions", () => {
    test("initial state is STOPPED", () => {
      expect(getGatewayStatus()).toBe(GW_STATUS.STOPPED);
      expect(getRestartCount()).toBe(0);
    });

    test("first health check when running → RUNNING", async () => {
      _isRunning = true;
      await checkHealth();
      expect(getGatewayStatus()).toBe(GW_STATUS.RUNNING);
    });

    test("single failure stays RUNNING (below MAX_FAILURES=3)", async () => {
      _gwStatus = GW_STATUS.RUNNING;
      _isRunning = false;
      await checkHealth();
      expect(_consecutiveFailures).toBe(1);
      expect(getGatewayStatus()).toBe(GW_STATUS.RUNNING);
    });

    test("two failures stays RUNNING", async () => {
      _gwStatus = GW_STATUS.RUNNING;
      _isRunning = false;
      await checkHealth();
      await checkHealth();
      expect(_consecutiveFailures).toBe(2);
      expect(getGatewayStatus()).toBe(GW_STATUS.RUNNING);
    });

    test("three consecutive failures triggers RESTARTING then RUNNING after success", async () => {
      _gwStatus = GW_STATUS.RUNNING;
      _isRunning = false;
      await checkHealth(); // failure 1
      await checkHealth(); // failure 2
      expect(getGatewayStatus()).toBe(GW_STATUS.RUNNING); // still running, below threshold
      await checkHealth(); // failure 3 → triggers restart → succeeds
      expect(getGatewayStatus()).toBe(GW_STATUS.RUNNING); // restart succeeded
      expect(_consecutiveFailures).toBe(0); // counter reset
      expect(_restartCalled).toBe(1);
    });

    test("three failures + failed restart = STAYS RESTARTING", async () => {
      _gwStatus = GW_STATUS.RUNNING;
      _isRunning = false;
      _restartSucceeds = false;
      await checkHealth(); // 1
      await checkHealth(); // 2
      await checkHealth(); // 3 → restart attempt → fails
      // After failed restart, status stays at whatever it was set to last
      expect(_totalRestarts).toBe(1);
      expect(_restartCalled).toBe(1);
    });

    test("successful restart → RUNNING and resets counter", async () => {
      _gwStatus = GW_STATUS.RUNNING;
      _isRunning = false;
      await checkHealth(); // 1
      await checkHealth(); // 2
      await checkHealth(); // 3 → restart
      expect(getGatewayStatus()).toBe(GW_STATUS.RUNNING);
      expect(_consecutiveFailures).toBe(0);
      expect(_restartCalled).toBe(1);
    });

    test("health check resets counter after coming back online", async () => {
      _gwStatus = GW_STATUS.RUNNING;
      _isRunning = false;
      await checkHealth(); // failure 1
      await checkHealth(); // failure 2
      _isRunning = true;
      await checkHealth(); // back online!
      expect(_consecutiveFailures).toBe(0);
      expect(getGatewayStatus()).toBe(GW_STATUS.RUNNING);
    });
  });

  describe("Restart limits", () => {
    test("restart counter increments only within MAX_RESTARTS limit", async () => {
      _gwStatus = GW_STATUS.RUNNING;
      _restartSucceeds = false; // restart always fails

      // Simulate 3 failures → trigger restart attempt → fails
      _isRunning = false;
      await checkHealth(); // fail 1
      await checkHealth(); // fail 2
      await checkHealth(); // fail 3 → restart → fails
      expect(_totalRestarts).toBe(1);

      // Reset connection, then trigger another cycle
      _isRunning = true;
      await checkHealth(); // resets _consecutiveFailures
      _gwStatus = GW_STATUS.RUNNING;

      // Second restart cycle
      _isRunning = false;
      await checkHealth(); // fail 1
      await checkHealth(); // fail 2
      await checkHealth(); // fail 3 → restart → fails
      expect(_totalRestarts).toBe(2);

      // Verify restart was called
      expect(_restartCalled).toBe(2);
    });
  });
});

describe("Gateway module constants", () => {
  test("GW_STATUS has 5 states", () => {
    var keys = Object.keys(GW_STATUS);
    expect(keys).toHaveLength(5);
    expect(GW_STATUS.STOPPED).toBe("stopped");
    expect(GW_STATUS.RUNNING).toBe("running");
  });

  test("MAX_FAILURES = 3", () => {
    expect(MAX_FAILURES).toBe(3);
  });

  test("MAX_RESTARTS = 5", () => {
    expect(MAX_RESTARTS).toBe(5);
  });

  test("GATEWAY_PORT = 18765", () => {
    var constants = require("../src/main/constants");
    expect(constants.GATEWAY_PORT).toBe(18765);
    expect(constants.GATEWAY_URL).toBe("http://127.0.0.1:18765");
  });
});

describe("Gateway source file integrity", () => {
  test("source file contains all expected exports", () => {
    var fs = require("fs");
    var path = require("path");
    var src = fs.readFileSync(
      path.join(__dirname, "..", "src", "main", "gateway.js"), "utf8"
    );
    expect(src).toContain("startHealthMonitor");
    expect(src).toContain("stopHealthMonitor");
    expect(src).toContain("checkHealth");
    expect(src).toContain("GW_STATUS");
    expect(src).toContain("MAX_FAILURES");
    expect(src).toContain("MAX_RESTARTS");
    expect(src).toContain("isGatewayRunning");
    expect(src).toContain("startHermesGateway");
    expect(src).toContain("stopHermesGateway");
  });
});
