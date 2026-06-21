/**
 * Tests for src/main/feishu.js — Feishu Bot API
 */
const https = require("https");
const { EventEmitter } = require("events");

jest.mock("https");

describe("Feishu Bot API", () => {
  let feishu;

  beforeAll(() => {
    feishu = require("../src/main/feishu");
  });

  beforeEach(() => {
    https.request.mockClear();
  });

  test("module exports expected functions", () => {
    expect(typeof feishu.getFeishuToken).toBe("function");
    expect(typeof feishu.sendFeishuBotMessage).toBe("function");
  });

  describe("getFeishuToken", () => {
    test("returns token on successful API response", async () => {
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();

      const mockRes = new EventEmitter();
      mockRes.statusCode = 200;

      https.request.mockImplementation((opts, callback) => {
        // Verify request options
        expect(opts.hostname).toBe("open.feishu.cn");
        expect(opts.path).toBe("/open-apis/auth/v3/tenant_access_token/internal");
        expect(opts.method).toBe("POST");
        callback(mockRes);
        // Emit data and end asynchronously
        process.nextTick(() => {
          mockRes.emit("data", JSON.stringify({ code: 0, tenant_access_token: "test-token-123" }));
          mockRes.emit("end");
        });
        return mockReq;
      });

      const token = await feishu.getFeishuToken("my-app-id", "my-secret");
      expect(token).toBe("test-token-123");
      expect(mockReq.write).toHaveBeenCalledWith(
        JSON.stringify({ app_id: "my-app-id", app_secret: "my-secret" })
      );
      expect(mockReq.end).toHaveBeenCalled();
    });

    test("rejects when Feishu API returns error code", async () => {
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();

      const mockRes = new EventEmitter();
      https.request.mockImplementation((opts, callback) => {
        callback(mockRes);
        process.nextTick(() => {
          mockRes.emit("data", JSON.stringify({ code: 999, msg: "Invalid credentials" }));
          mockRes.emit("end");
        });
        return mockReq;
      });

      await expect(feishu.getFeishuToken("bad", "wrong")).rejects.toThrow("飞书API错误");
    });

    test("rejects on network error", async () => {
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();

      https.request.mockImplementation((opts, callback) => {
        process.nextTick(() => {
          mockReq.emit("error", new Error("ECONNREFUSED"));
        });
        return mockReq;
      });

      await expect(feishu.getFeishuToken("app", "sec")).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("sendFeishuBotMessage", () => {
    test("sends message to Feishu and returns JSON", async () => {
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();

      const mockRes = new EventEmitter();
      https.request.mockImplementation((opts, callback) => {
        expect(opts.hostname).toBe("open.feishu.cn");
        expect(opts.path).toContain("/open-apis/im/v1/messages");
        callback(mockRes);
        process.nextTick(() => {
          mockRes.emit("data", JSON.stringify({ code: 0, data: { message_id: "msg-456" } }));
          mockRes.emit("end");
        });
        return mockReq;
      });

      const result = await feishu.sendFeishuBotMessage("my-token", "Hello from Hergent!");
      expect(result.code).toBe(0);
      expect(result.data.message_id).toBe("msg-456");
    });

    test("rejects when send fails", async () => {
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();

      const mockRes = new EventEmitter();
      https.request.mockImplementation((opts, callback) => {
        callback(mockRes);
        process.nextTick(() => {
          mockRes.emit("data", JSON.stringify({ code: 500, msg: "Rate limited" }));
          mockRes.emit("end");
        });
        return mockReq;
      });

      await expect(
        feishu.sendFeishuBotMessage("token", "msg")
      ).rejects.toThrow("发送消息失败");
    });

    test("sets Authorization header with Bearer token", async () => {
      const mockReq = new EventEmitter();
      mockReq.write = jest.fn();
      mockReq.end = jest.fn();
      const mockRes = new EventEmitter();

      https.request.mockImplementation((opts, callback) => {
        expect(opts.headers.Authorization).toBe("Bearer my-token");
        callback(mockRes);
        process.nextTick(() => {
          mockRes.emit("data", '{"code":0}');
          mockRes.emit("end");
        });
        return mockReq;
      });

      await feishu.sendFeishuBotMessage("my-token", "test");
    });
  });
});
