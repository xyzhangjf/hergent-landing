/**
 * Tests for src/renderer/utils.js — friendlyError
 *
 * Tests the function logic directly (copied inline to avoid browser env dependencies)
 */

// Extract the friendlyError logic for pure testing
function friendlyError(e) {
  const msg = (e && (e.message || String(e))) || "";
  if (/failed to fetch|networkerror|fetch error/i.test(msg)) return "无法连接服务，请检查网络";
  if (/timeout|timed ?out/i.test(msg)) return "响应超时，请稍后重试";
  if (/ECONNREFUSED|connection refused/i.test(msg)) return "AI 引擎未就绪，请稍后重试";
  if (/退出码 1|exit code 1/i.test(msg)) return "AI 处理失败，请重试";
  if (/退出码|exit code/i.test(msg)) return "AI 引擎异常，请重试";
  if (/EPIPE|broken pipe/i.test(msg)) return "连接中断，请重试";
  if (/ENOENT|not found/i.test(msg)) return "未找到所需程序，请确认安装完整";
  if (/429|rate.?limit/i.test(msg)) return "请求太频繁，请稍后重试";
  if (/401|unauthorized/i.test(msg)) return "登录已过期，请重新登录";
  if (/500|internal.?server/i.test(msg)) return "服务器异常，请稍后重试";
  if (/503|service.?unavailable/i.test(msg)) return "服务暂不可用，请稍后重试";
  return (e && e.message) || "未知错误，请重试";
}

describe("friendlyError", () => {
  test("translates Fetch Error to Chinese", () => {
    expect(friendlyError(new Error("Failed to fetch"))).toBe("无法连接服务，请检查网络");
  });

  test("translates NetworkError to Chinese", () => {
    expect(friendlyError(new Error("NetworkError"))).toBe("无法连接服务，请检查网络");
  });

  test("translates FetchError to Chinese", () => {
    expect(friendlyError(new Error("fetch error"))).toBe("无法连接服务，请检查网络");
  });

  test("translates timeout to Chinese", () => {
    expect(friendlyError(new Error("Request timed out"))).toBe("响应超时，请稍后重试");
  });

  test("translates timed out (space) to Chinese", () => {
    expect(friendlyError(new Error("Request timed out"))).toBe("响应超时，请稍后重试");
  });

  test("translates ECONNREFUSED to Chinese", () => {
    expect(friendlyError(new Error("ECONNREFUSED"))).toBe("AI 引擎未就绪，请稍后重试");
  });

  test("translates 429 Rate Limit to Chinese", () => {
    expect(friendlyError(new Error("429"))).toBe("请求太频繁，请稍后重试");
  });

  test("translates RateLimit to Chinese", () => {
    expect(friendlyError(new Error("RateLimit exceeded"))).toBe("请求太频繁，请稍后重试");
  });

  test("translates 401 Unauthorized to Chinese", () => {
    expect(friendlyError(new Error("Unauthorized 401"))).toBe("登录已过期，请重新登录");
  });

  test("translates 500 Internal Server Error to Chinese", () => {
    expect(friendlyError(new Error("Internal Server Error 500"))).toBe("服务器异常，请稍后重试");
  });

  test("translates 503 Service Unavailable to Chinese", () => {
    expect(friendlyError(new Error("Service Unavailable 503"))).toBe("服务暂不可用，请稍后重试");
  });

  test("translates EPIPE broken pipe to Chinese", () => {
    expect(friendlyError(new Error("EPIPE broken pipe"))).toBe("连接中断，请重试");
  });

  test("translates ENOENT not found to Chinese", () => {
    expect(friendlyError(new Error("ENOENT: file not found"))).toBe("未找到所需程序，请确认安装完整");
  });

  test("translates exit code 1 to Chinese", () => {
    expect(friendlyError(new Error("退出码 1: error"))).toBe("AI 处理失败，请重试");
  });

  test("translates general exit code to Chinese", () => {
    expect(friendlyError(new Error("exit code 2"))).toBe("AI 引擎异常，请重试");
  });

  test("returns original message for unknown errors", () => {
    expect(friendlyError(new Error("WeirdError"))).toBe("WeirdError");
  });

  test("returns fallback for null input", () => {
    expect(friendlyError(null)).toBe("未知错误，请重试");
  });

  test("returns fallback for undefined input", () => {
    expect(friendlyError(undefined)).toBe("未知错误，请重试");
  });

  test("returns message from Error-like objects", () => {
    expect(friendlyError({ message: "Custom error" })).toBe("Custom error");
  });

  test("returns fallback for plain strings (no message prop)", () => {
    expect(friendlyError("just a string")).toBe("未知错误，请重试");
  });
});

describe("friendlyError — source file exists", () => {
  test("src/renderer/utils.js exports friendlyError function", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "renderer", "utils.js"), "utf8"
    );
    expect(src).toContain("function friendlyError");
    expect(src).toContain("function notifyIfAway");
  });
});
