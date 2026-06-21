/**
 * Hergent Desktop — HTTP Client
 * Unified HTTP helpers (replaces 4 duplicate implementations in main.js)
 */
const https = require("https");
const http = require("http");

// TLS certificate validation (set by main.js after import)
let _tlsReject = true;

function init(tlsReject) {
  _tlsReject = tlsReject;
}

// Electron net.request based
function httpGet(url, headers) {
  const { net } = require("electron");
  return new Promise((resolve, reject) => {
    const request = net.request({ method: "GET", url: url });
    request.setHeader("User-Agent", "HermesAI-Desktop/1.0");
    request.setHeader("Accept-Language", "zh-CN,zh;q=0.9");
    if (headers) Object.entries(headers).forEach(([k, v]) => request.setHeader(k, v));
    request.on("response", (response) => {
      let data = "";
      response.on("data", (chunk) => data += chunk);
      response.on("end", () => resolve(data));
    });
    request.on("error", reject);
    request.end();
  });
}

function httpPost(url, bodyStr, opts) {
  const { net } = require("electron");
  return new Promise((resolve, reject) => {
    const request = net.request({ method: "POST", url: url });
    request.setHeader("Content-Type", "application/json");
    request.setHeader("User-Agent", "HermesAI-Desktop/1.0");
    request.setHeader("Accept-Language", "zh-CN,zh;q=0.9");
    if (opts && opts.headers) {
      Object.entries(opts.headers).forEach(([k, v]) => request.setHeader(k, v));
    }
    request.on("response", (response) => {
      let data = "";
      response.on("data", (chunk) => data += chunk);
      response.on("end", () => resolve(data));
    });
    request.on("error", reject);
    request.write(bodyStr);
    request.end();
  });
}

// Node http fallback — for use when Electron net.request has issues
function nodeHttpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      timeout: 10000,
      rejectUnauthorized: _tlsReject,
    };
    const req = mod.request(opts, (res) => {
      let d = ""; res.on("data", (c) => d += c);
      res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("request timeout")); });
    req.end();
  });
}

function nodeHttpPost(urlStr, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === "https:";
    const mod = isHttps ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: "POST",
      timeout: 10000,
      rejectUnauthorized: _tlsReject,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) },
    };
    const req = mod.request(opts, (res) => {
      let d = ""; res.on("data", (c) => d += c);
      res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("request timeout")); });
    req.write(bodyStr); req.end();
  });
}

module.exports = { init, httpGet, httpPost, nodeHttpGet, nodeHttpPost };
