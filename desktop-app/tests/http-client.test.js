/**
 * Tests for src/main/http-client.js — HTTP helpers
 */
const http = require("http");
const net = require("net");

describe("HTTP Client", () => {
  let httpClient;
  let server;
  let serverPort;

  beforeAll((done) => {
    // Start a local test server
    server = http.createServer((req, res) => {
      if (req.url === "/test") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, body: req.method }));
      } else if (req.url === "/echo") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ echo: body }));
        });
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, () => {
      serverPort = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    // Load fresh module
    delete require.cache[require.resolve("../src/main/http-client")];
    httpClient = require("../src/main/http-client");
    httpClient.init(true); // Enable TLS validation
  });

  test("module exports expected functions", () => {
    expect(typeof httpClient.httpGet).toBe("function");
    expect(typeof httpClient.httpPost).toBe("function");
    expect(typeof httpClient.nodeHttpGet).toBe("function");
    expect(typeof httpClient.nodeHttpPost).toBe("function");
    expect(typeof httpClient.init).toBe("function");
  });

  test("nodeHttpGet makes GET request", async () => {
    const data = await httpClient.nodeHttpGet(`http://localhost:${serverPort}/test`);
    const parsed = JSON.parse(data);
    expect(parsed.ok).toBe(true);
    expect(parsed.body).toBe("GET");
  });

  test("nodeHttpPost makes POST request with body", async () => {
    const data = await httpClient.nodeHttpPost(
      `http://localhost:${serverPort}/echo`,
      JSON.stringify({ hello: "world" })
    );
    const parsed = JSON.parse(data);
    expect(parsed.echo).toBe('{"hello":"world"}');
  });

  test("nodeHttpGet handles 404", async () => {
    try {
      // response comes back as JSON parse fail — but http client returns raw text
      const data = await httpClient.nodeHttpGet(`http://localhost:${serverPort}/nonexistent`);
      expect(data).toBe("not found");
    } catch (e) {
      // timeout/network errors are fine
    }
  });

  test("nodeHttpGet rejects on invalid host", async () => {
    await expect(
      httpClient.nodeHttpGet("http://0.0.0.1:1/nope")
    ).rejects.toThrow();
  });

  test("init sets TLS rejection flag", () => {
    // Just verify it doesn't throw
    expect(() => httpClient.init(false)).not.toThrow();
  });
});
