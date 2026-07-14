/*
 * Hergent Desktop — Main Process
 * Electron 39 + Hermes Agent Gateway
 */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, nativeTheme, safeStorage } = require("electron");
const path = require('path');
const { execSync, exec, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require("crypto");
// ===== Phase 1: Extracted modules =====
const {
  PROFILE, homeDir, CURRENT_VERSION, GATEWAY_PORT, GATEWAY_URL,
  isWindows, HERMES_CMD, _isDev, _tlsReject,
  ACTIVATION_KEY, TRIAL_DAYS, LICENSE_DAYS, SERVER_URL,
  PLATFORM_DEFS, DEFAULT_ROLES, ROLE_SKILLS,
} = require("./src/main/constants");
const logger = require("./src/main/logger");
const httpClient = require("./src/main/http-client");
const rolesMgr = require("./src/main/roles");
const licenses = require("./src/main/license");
const engine = require("./src/main/engine");
const feishu = require("./src/main/feishu");
const wecom = require("./src/main/wecom");
const creditsSrv = require("./src/main/credits-server");
const win = require("./src/main/window");
const gateway = require("./src/main/gateway");
const GATEWAY_API_KEY = crypto.randomBytes(32).toString("hex");
let HERMES_BIN;
gateway.init(GATEWAY_API_KEY, engine, rolesMgr, licenses);
engine.init(GATEWAY_API_KEY, HERMES_BIN);
creditsSrv.init(engine.getEngineDir);
// ===== Sentry 错误监控（可选，通过 SENTRY_DSN 环境变量启用）=====
let Sentry = null;
try {
  if (process.env.SENTRY_DSN) {
    Sentry = require("@sentry/electron/main");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: CURRENT_VERSION,
      environment: process.env.NODE_ENV || "production",
    });
    logger.startup("Sentry initialized");
  }
} catch (e) {
  // Sentry 仅在 Electron 运行时可用，命令行 node 测试时跳过
  logger.startup("Sentry init skipped: " + (e.message || "unknown"));
}
logger.init(app, Sentry, _isDev);
httpClient.init(_tlsReject);
// ===== 安全存储：平台凭据加密（macOS Keychain / Windows DPAPI）=====
const SECURE_STORE_PATH = () => path.join(app.getPath("userData"), "secure-store.json");
function _safeEncrypt(plaintext) {
  if (!plaintext) return "";
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext).toString("base64");
  }
  // 回退：当 safeStorage 不可用时（部分 Linux），用设备 ID 做简单混淆
  // 这不是真正的加密，但比明文存储好
  const key = crypto.createHash("sha256").update(licenses.getDeviceId() + "hergent-secure-v1").digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}
function _safeDecrypt(encoded) {
  if (!encoded) return "";
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encoded, "base64"));
    }
    // 回退解密
    const data = Buffer.from(encoded, "base64");
    const iv = data.subarray(0, 16);
    const encrypted = data.subarray(16);
    const key = crypto.createHash("sha256").update(licenses.getDeviceId() + "hergent-secure-v1").digest();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (_) {
    return ""; // 解密失败返回空字符串
  }
}
// 加密写入单个凭据字段
function _encryptChannelSecrets(channelData) {
  if (!channelData) return channelData;
  const encrypted = {};
  for (const [roleId, cfg] of Object.entries(channelData)) {
    if (roleId.startsWith("_")) { encrypted[roleId] = cfg; continue; }
    const entry = { ...cfg };
    // 加密所有已知的 secret 字段
    for (const field of ["app_secret", "secret", "client_secret", "bot_secret"]) {
      if (entry[field] && !entry[field].startsWith("$enc:")) {
        entry[field] = "$enc:" + _safeEncrypt(entry[field]);
      }
    }
    encrypted[roleId] = entry;
  }
  return encrypted;
}
// 解密单个凭据字段
function _decryptChannelSecrets(channelData) {
  if (!channelData) return channelData;
  const decrypted = {};
  for (const [roleId, cfg] of Object.entries(channelData)) {
    if (roleId.startsWith("_")) { decrypted[roleId] = cfg; continue; }
    const entry = { ...cfg };
    for (const field of ["app_secret", "secret", "client_secret", "bot_secret"]) {
      if (entry[field] && entry[field].startsWith("$enc:")) {
        entry[field] = _safeDecrypt(entry[field].slice(5));
      }
    }
    decrypted[roleId] = entry;
  }
  return decrypted;
}
try {
  const startupDir = process.env.APPDATA || require('os').tmpdir();
} catch (_) {}
// getConfigPath() is lazy — app.getPath() must be called after app.whenReady()
function getConfigPath() { return path.join(app.getPath('userData'), 'channels.json'); }
logger.startup(`main.js loaded, platform=${process.platform}, electron=${process.versions.electron}, version=${CURRENT_VERSION}`);
process.on("uncaughtException", (err) => {
  try {
    const logDir = app.isReady() ? app.getPath("userData") : require("os").tmpdir();
    fs.appendFileSync(path.join(logDir, "hergent-crash.log"), `[${new Date().toISOString()}] ${err.message}\n${err.stack || ""}\n`);
  } catch (_) {}
  // Sentry 上报
  try { if (Sentry) Sentry.captureException(err); } catch (_) {}
  // Fire-and-forget 上报到远程服务器
  try {
    const body = JSON.stringify({ message: err.message.slice(0, 500), stack: (err.stack || "").slice(0, 2000), version: CURRENT_VERSION, platform: process.platform });
    const u = new URL("https://api.hergent.cn/api/telemetry/crash");
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request({ hostname: u.hostname, port: 443, path: u.pathname, method: "POST", timeout: 3000,
      rejectUnauthorized: _tlsReject, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => { res.resume(); });
    req.on("error", () => {});
    req.write(body); req.end();
  } catch (_) {}
  try { dialog.showErrorBox("Hergent 启动失败", `错误详情：\n${err.message}\n\n请将以下路径的日志发送给技术支持：\n${require("os").tmpdir()}/hergent-crash.log`); } catch (_) {}
  process.exit(1);
});
// 未捕获的 Promise 拒绝 — 记录日志 + Sentry + 上报远程（不退出进程）
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? (reason.stack || "") : "";
  try { if (Sentry) Sentry.captureException(reason instanceof Error ? reason : new Error(msg)); } catch (_) {}
  try {
    const logDir = app.isReady() ? app.getPath("userData") : require("os").tmpdir();
    fs.appendFileSync(path.join(logDir, "hergent-crash.log"), `[${new Date().toISOString()}] [UnhandledRejection] ${msg}\n${stack}\n`);
  } catch (_) {}
  try {
    const body = JSON.stringify({ message: msg.slice(0, 500), stack: stack.slice(0, 2000), version: CURRENT_VERSION, platform: process.platform, type: 'unhandledRejection' });
    const u = new URL('https://api.hergent.cn/api/telemetry/crash');
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({ hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', timeout: 3000,
      rejectUnauthorized: _tlsReject, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); });
    req.on('error', () => {});
    req.write(body); req.end();
  } catch (_) {}
});
// Gateway API Key 每次启动动态生成（仅本机 localhost 使用，无需持久化）

// Dev 模式允许跳过 TLS 证书验证（通过环境变量 HERGENT_DEV=1 启用）
// 所有平台都走角色独立 Gateway，主 Gateway 不再直接处理任何平台连接
// 获取角色最近的平台 session ID（飞书等），用于 App 聊天与平台共享上下文
// 从 channels.json 读取所有平台每角色配置
// 返回 [{ platform, roleId, name, creds: {app_id, app_secret, ...}, envVars: {FEISHU_APP_ID: ..., ...} }]
// 向后兼容别名
// 为每个有平台配置的角色启动独立 Gateway 进程（飞书/企微/钉钉/QQ）
ipcMain.handle('gateway:status', async () => {
  const running = await gateway.isGatewayRunning();
  const ready = engine.isEngineReady();
  return { running, ready, url: running ? GATEWAY_URL : null };
});
let SYSTEM_PROMPT = '';
try {
  SYSTEM_PROMPT = fs.readFileSync(path.join(homeDir, '.hermes', 'SOUL.md'), 'utf8').trim();
} catch (e) { /* 文件不存在时用内置精简版 */ }
if (!SYSTEM_PROMPT) {
  SYSTEM_PROMPT = '你是 Hermes AI，一个靠谱的AI助手。说人话、结论先行、不啰嗦。';
}
// Hermes CLI 路径检测
// ===== 引擎自解压（首次启动自动展开 hermes.tar.gz）=====
// 递归合并目录（不覆盖已存在的文件）
// 每次启动都确保引擎配置正确（通过 hermes config set）
// 从 asar 安全复制目录（asar 不支持 cpSync，需逐文件处理）
// 将引擎的 memories/ 和 skills/ 链接到用户 ~/.hermes/，共享长期记忆和全部技能
// 为每个角色创建独立的 Hermes Home（独立 workspace + skills + config + memory + persona）
// 将共享技能目录中的角色专属技能 symlink 到各角色的 skills/ 目录
// 写标记文件，表示引擎完全就绪（配置 + skills + 角色全部到位）
// 确保技能就位 — skills/ 已通过 ensureSharedState 链接到 ~/.hermes/skills/
const resolvedPath = engine.resolveHermesPath();
if (resolvedPath) { HERMES_BIN = resolvedPath; engine.init(GATEWAY_API_KEY, HERMES_BIN); }
creditsSrv.init(engine.getEngineDir);
logger.startup(`resolveHermesPath done, HERMES_BIN=${HERMES_BIN || 'NOT FOUND'}, isWindows=${isWindows}`);
// Delay init that needs userData path until app is ready
app.whenReady().then(() => {
  rolesMgr.init(app);
  licenses.init(app);
  if (HERMES_BIN) {
    logger.startup('first app.whenReady: init engine config...');
    engine.ensureEngineConfig();
    engine.ensureBuiltinSkills();
    engine.ensureRoleConfigs();
    engine.markEngineReady();
    logger.startup('engine config init done');
  } else {
    logger.startup('first app.whenReady: HERMES_BIN not found, skipping engine config init');
  }
});
// 获取设备ID（基于 UUID v4，首次生成后持久化到 license.json）
// 获取试用/激活状态
// ===== 通道配置读写 =====
function loadChannels() {
  try {
    if (fs.existsSync(getConfigPath())) {
      const raw = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
      return _decryptChannelSecrets(raw);
    }
  } catch {}
  return {};
}
function saveChannels(data) {
  const encrypted = _encryptChannelSecrets(data);
  fs.writeFileSync(getConfigPath(), JSON.stringify(encrypted, null, 2));
}
async function restartGateway() {
  gateway.stopHermesGateway();
  if (isWindows) {
    try { execSync('taskkill /F /IM python.exe /FI "WINDOWTITLE eq gateway run" 2>nul', { timeout: 5000 }); } catch (_) {}
  } else {
    try { const ed = engine.getEngineDir(); execSync(`pkill -f "${ed}/python/bin/python3.11.*gateway run"`, { timeout: 5000 }); } catch (_) {}
  }
  await new Promise(r => setTimeout(r, 3000));
  const ok = await gateway.startHermesGateway();
  if (ok) gateway.startHealthMonitor();
  return { success: ok, output: ok ? "Gateway restarted" : "Gateway restart failed" };
}
// ===== Hermes CLI 帮助函数 =====
function hermesCLI(args, timeout = 30000) {
  const engineDir = engine.getEngineDir();
  const hermesHome = path.join(engineDir, '.hermes');
  const libsDir = path.join(engineDir, 'libs');
  const pythonBin = isWindows
    ? path.join(engineDir, 'python', 'python.exe')
    : path.join(engineDir, 'python', 'bin', 'python3.11');
  // 直接调 python -m hermes_cli.main，绕过 run.sh/hermes.bat（run.sh 把 bash 脚本当 Python 传会导致 SyntaxError）
  const cmd = `"${pythonBin}" -m hermes_cli.main ${args}`;
  const result = execSync(cmd, { timeout, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, HERMES_HOME: hermesHome, PYTHONPATH: libsDir, PYTHONHOME: '' } });
  return result.trim();
}
// ===== Gateway 对话帮助函数（可复用，供 chat 和 pipeline 共享） =====
async function chatViaGateway(roleId, userMessage, eventSender) {
  const roles = rolesMgr.loadRoles();
  const currentRole = roles[roleId] || roles['dami'];
  const chatMessages = [
    { role: 'system', content: currentRole.systemPrompt || '你是 Hergent 数字员工，运行在用户的电脑上。你可以读写文件、执行代码、操控系统。说人话、不啰嗦。' },
    { role: 'user', content: userMessage }
  ];
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ model: 'deepseek-v4-flash', messages: chatMessages, stream: true, max_tokens: 4096 });
    const request = net.request({
      method: 'POST',
      url: `${GATEWAY_URL}/v1/chat/completions`
    });
    _cancelFn = () => { try { request.abort(); } catch (_) {} };
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('User-Agent', 'Hergent-Desktop/1.0');
    request.on('response', (res) => {
      if (res.statusCode !== 200) {
        let b = ''; res.on('data', c => b += c);
        res.on('end', () => { _cancelFn = null; reject(new Error(`Gateway ${res.statusCode}`)); });
        return;
      }
      let buffer = '', fullResponse = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          const sse = line.startsWith('data: ') ? line.slice(6) : null;
          if (!sse || sse === '[DONE]') continue;
          try {
            const d = JSON.parse(sse).choices?.[0]?.delta?.content;
            if (d) {
              fullResponse += d;
              try { eventSender.send('hermes:stream', { text: d, type: 'response' }); } catch (_) {}
            }
          } catch (_) {}
        }
      });
      res.on('end', () => { _cancelFn = null; resolve(fullResponse); });
    });
    request.on('error', (e) => { _cancelFn = null; reject(e); });
    request.write(postData);
    request.end();
  });
}
// ===== IPC: 执行功能（直接走 hermes CLI send） =====
ipcMain.handle('hermes:execute', async (event, params) => {
  const { action, args } = params || {};
  // --- 入口日志 ---
  const logFile = path.join(homeDir, '.hermes', 'app_debug.log');
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] IPC hermes:execute received: action=${action}\n`);
  try {
    if (action === 'chat:send') {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] chat:send received: action=${args?.action}, text=${(args?.text||'').slice(0,50)}
`);
      // 交互面板发送消息 — 结果推回 App 面板
      // 交互面板发送消息 — 结果推回 App 面板
      const { action, text, files: filePaths, role } = args || {};
      const cronDir = path.join(homeDir, '.hermes', 'cron_input');
      fs.mkdirSync(cronDir, { recursive: true });
      const savedFiles = [];
      if (filePaths && filePaths.length > 0) {
        for (const fp of filePaths) {
          const fname = path.basename(fp);
          const dest = path.join(cronDir, fname);
          fs.copyFileSync(fp, dest);
          savedFiles.push(dest);
        }
      }
      const requestId = 'req_' + Date.now();
      const promptFile = path.join(cronDir, `chat_${requestId}.txt`);
      let promptContent = `[action: ${action || 'unknown'}]\n${text || ''}`;
      if (savedFiles.length > 0) {
        promptContent += '\n附件:\n' + savedFiles.join('\n');
      }
      fs.writeFileSync(promptFile, promptContent);
      // 后台运行 Hermes，结果推回渲染进程
      // === 直接对话模式（不点按钮直接打字） ===
      if (action === 'chat' || !action) {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] chat→hermes CLI\n`);
        const requestId = 'req_' + Date.now();
        let fullText = text || '';
        if (savedFiles.length > 0) {
          fullText += '\n\n以下是我上传的文件，请读取并处理：\n' + savedFiles.join('\n');
        }
        // --- 积分检查 ---
        let creditsOK = true;
        let creditsMsg = '';
        let currentCredits = 0;
        try {
          const creditsRes = await httpClient.httpGet(`${SERVER_URL}/api/credits?device_id=${licenses.getDeviceId()}`);
          const creditsData = JSON.parse(creditsRes);
          currentCredits = creditsData.credits;
          if (currentCredits <= 0) {
            creditsOK = false;
            creditsMsg = '积分不足，请充值后继续使用';
          }
        } catch (e) {
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] credits check failed: ${e.message}\n`);
        }
        if (!creditsOK) {
          return { requestId, success: false, output: creditsMsg, sessionId: null };
        }
        // === 使用 Hermes CLI（完整工具支持：文件/浏览器/代码执行） ===
        // Gateway 暂不用于 chat: v4-pro 流式响应解析兼容性问题
        // CLI 路径已验证：工具调用正常，响应完整
        {
          // macOS/Linux: 直接用 hermes chat -q
          if (isWindows) {
            const engineDir = engine.getEngineDir();
            const winPython = path.join(engineDir, 'python', 'python.exe');
            const winHermes = path.join(engineDir, 'hermes');
            if (!fs.existsSync(winPython) || !fs.existsSync(winHermes)) {
              return { requestId, success: false, output: 'Hermes 引擎未安装，请先在设置中安装', sessionId: null };
            }
            const winRoleId = role || 'dami';
            try {
              const winArgs = [winHermes, 'chat', '-q', fullText, '--max-turns', '60', '--source', 'tool'];
              const winPlatformSid = gateway.getLatestPlatformSession(winRoleId);
              if (winPlatformSid || gateway.getRoleSessions()[winRoleId]) { winArgs.push('--resume', winPlatformSid || gateway.getRoleSessions()[winRoleId]); }
              const child = spawn(winPython, winArgs, {
                env: { ...process.env, PYTHONPATH: path.join(engineDir, 'libs'), PYTHONHOME: '', PYTHONUTF8: '1', HERMES_HOME: path.join(engineDir, '.hermes', 'agents', role || 'dami') }
              });
              _cancelFn = () => { try { child.kill(); } catch (_) {} };
              const cliResult = await new Promise((resolve, reject) => {
                let stdout = '', stderr = '';
                const timer = setTimeout(() => { child.kill(); reject(new Error('回复超时')); }, 600000);
                child.stdout.on('data', d => { stdout += d.toString(); });
                child.stderr.on('data', d => { stderr += d.toString(); });
                child.on('close', code => { clearTimeout(timer); _cancelFn = null; code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || 'AI 处理失败')); });
                child.on('error', e => { clearTimeout(timer); _cancelFn = null; reject(e); });
              });
              const allBoxes = [...cliResult.stdout.matchAll(/Hermes[^\n]*\n([\s\S]*?)\n\s*[╰─][─\s]*(?:╯)?\s*\n/g)];
              const lastBox = allBoxes.length > 0 ? allBoxes[allBoxes.length - 1] : null;
              let responseText = lastBox ? lastBox[1].split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim() : '';
              if (!responseText) responseText = cliResult.stdout.split('\n').filter(l => { const t = l.trim(); return t && !t.startsWith('Query:') && !t.startsWith('Initializing') && !t.startsWith('─') && !t.startsWith('session_id:') && !t.startsWith('┊') && !t.startsWith('↻') && !t.includes('╭') && !t.includes('╰') && !t.startsWith('Resume this session') && !t.startsWith('hermes --resume') && !t.startsWith('Session:') && !t.startsWith('Duration:') && !t.startsWith('Messages:') && !t.startsWith('⚠'); }).map(l => l.trim()).join('\n').trim();
              // Convert Hermes engine "(empty)" sentinel to user-friendly message
              if (!responseText || responseText === "(empty)") responseText = "处理完成了，但模型没有生成文字回复。请尝试重新发送或换个说法。";
              const sidMatch = cliResult.stdout.match(/Session:\s+(\S+)/);
              if (sidMatch) gateway.getRoleSessions()[winRoleId] = sidMatch[1];
              const cliCreditsUsed = Math.max(1, Math.ceil((fullText.length + responseText.length) / 500));
              try {
                await httpClient.httpPost(`${SERVER_URL}/api/credits/deduct?device_id=${licenses.getDeviceId()}`,
                  JSON.stringify({ credits: cliCreditsUsed, model: 'deepseek-v4-flash' }));
              } catch (_) { /* 积分报告失败不影响主流程 */ }
              return { requestId, success: true, output: responseText.slice(0, 8000), offline: true, sessionId: gateway.getRoleSessions()[winRoleId] || null };
            } catch (e) {
              return { requestId, success: false, output: `执行失败：${e.message}`, sessionId: gateway.getRoleSessions()[winRoleId] || null };
            }
          }
          // macOS/Linux: 使用 Agent Python + PYTHONPATH 确保依赖齐全
          if (!isWindows) {
            const engineDir = engine.getEngineDir();
            const pyDir = path.join(engineDir, 'python');
            if (fs.existsSync(pyDir)) { spawnSync('/usr/bin/xattr', ['-cr', pyDir], { timeout: 10000 }); }
            // 查找可用的 Python（引擎优先，agent venv 备选，agent 直接兜底）
            const agentPython = path.join(homeDir, '.hermes', 'hermes-agent', 'python', 'bin', 'python3.11');
            const agentVenvPython = path.join(homeDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'python3.11');
            const agentLibs = path.join(homeDir, '.hermes', 'hermes-agent', 'libs');
            const enginePython = path.join(engineDir, 'python', 'bin', 'python3.11');
            const engineLibs = path.join(engineDir, 'libs');
            let pythonBin = 'python3';
            let pythonLibs = null;
            if (fs.existsSync(enginePython)) { pythonBin = enginePython; pythonLibs = engineLibs; }
            else if (fs.existsSync(agentVenvPython)) { pythonBin = agentVenvPython; pythonLibs = agentLibs; }
            else if (fs.existsSync(agentPython)) { pythonBin = agentPython; pythonLibs = agentLibs; }
            const roleId = role || 'dami';
            const hermesScript = path.join(homeDir, '.hermes', 'hermes-agent', 'hermes');
            const baseArgs = [hermesScript, 'chat', '-q', fullText, '--max-turns', '60', '--source', 'tool'];
            if (!fs.existsSync(hermesScript)) {
              baseArgs[0] = 'hermes_cli.main';
              baseArgs.unshift('-m');
            }
            // 会话续接：优先用平台Session（飞书等），App和飞书共享同一上下文
            const platformSessionId = gateway.getLatestPlatformSession(roleId);
            const resumeId = platformSessionId || gateway.getRoleSessions()[roleId];
            if (resumeId) {
              baseArgs.push('--resume', resumeId);
            }
            const spawnArgs = baseArgs;
            const spawnEnv = { ...process.env, HERMES_HOME: path.join(engineDir, '.hermes', 'agents', role || 'dami') };
            if (pythonLibs) { spawnEnv.PYTHONPATH = pythonLibs; spawnEnv.PYTHONHOME = ''; }
            try {
              const child = spawn(pythonBin, spawnArgs, { env: spawnEnv });
              _cancelFn = () => { try { child.kill(); } catch (_) {} };
              const cliResult = await new Promise((resolve, reject) => {
                let stdout = '', stderr = '';
                const timer = setTimeout(() => { child.kill(); reject(new Error('回复超时')); }, 600000);
                child.stdout.on('data', d => { stdout += d.toString(); });
                child.stderr.on('data', d => { stderr += d.toString(); });
                child.on('close', code => { clearTimeout(timer); _cancelFn = null; code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || 'AI 处理失败')); });
                child.on('error', e => { clearTimeout(timer); _cancelFn = null; reject(e); });
              });
              const allBoxes = [...cliResult.stdout.matchAll(/Hermes[^\n]*\n([\s\S]*?)\n\s*[╰─][─\s]*(?:╯)?\s*\n/g)];
              const lastBox = allBoxes.length > 0 ? allBoxes[allBoxes.length - 1] : null;
              let responseText = lastBox ? lastBox[1].split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim() : '';
              if (!responseText) responseText = cliResult.stdout.split('\n').filter(l => { const t = l.trim(); return t && !t.startsWith('Query:') && !t.startsWith('Initializing') && !t.startsWith('─') && !t.startsWith('session_id:') && !t.startsWith('┊') && !t.startsWith('↻') && !t.includes('╭') && !t.includes('╰') && !t.startsWith('Resume this session') && !t.startsWith('hermes --resume') && !t.startsWith('Session:') && !t.startsWith('Duration:') && !t.startsWith('Messages:') && !t.startsWith('⚠'); }).map(l => l.trim()).join('\n').trim();
              // Convert Hermes engine "(empty)" sentinel to user-friendly message
              if (!responseText || responseText === "(empty)") responseText = "处理完成了，但模型没有生成文字回复。请尝试重新发送或换个说法。";
              // 提取会话 ID，下次同一角色续接上下文
              const sidMatch = cliResult.stdout.match(/Session:\s+(\S+)/);
              if (sidMatch) gateway.getRoleSessions()[roleId] = sidMatch[1];
              const cliCreditsUsed = Math.max(1, Math.ceil((fullText.length + responseText.length) / 500));
              try {
                await httpClient.httpPost(`${SERVER_URL}/api/credits/deduct?device_id=${licenses.getDeviceId()}`,
                  JSON.stringify({ credits: cliCreditsUsed, model: 'deepseek-v4-flash' }));
              } catch (_) { /* 积分报告失败不影响主流程 */ }
              return { requestId, success: true, output: responseText.slice(0, 8000), offline: true, sessionId: gateway.getRoleSessions()[roleId] || null };
            } catch (e) {
              return { requestId, success: false, output: `执行失败：${e.message}`, sessionId: gateway.getRoleSessions()[roleId] || null };
            }
        }
        }
        const roleId = role || 'dami';
        const roles = rolesMgr.loadRoles();
        const currentRole = roles[roleId] || roles['dami'];
        try {
          const sessionId = gateway.getRoleSessions()[roleId] || null;
          const result = await new Promise((resolve, reject) => {
            const chatMessages = [
              { role: 'system', content: currentRole.systemPrompt || '你是 Hergent 数字员工，运行在用户的电脑上。你可以读写文件、执行代码、操控系统。说人话、不啰嗦。' },
              { role: 'user', content: fullText }
            ];
            const postData = JSON.stringify({ model: 'deepseek-v4-flash', messages: chatMessages, stream: true, max_tokens: 4096 });
            const request = net.request({
              method: 'POST',
              url: `${GATEWAY_URL}/v1/chat/completions`
            });
            _cancelFn = () => { try { request.abort(); } catch (_) {} };
            request.setHeader('Content-Type', 'application/json');
            request.setHeader('User-Agent', 'Hergent-Desktop/1.0');
            request.setHeader('Authorization', `Bearer ${GATEWAY_API_KEY}`);
            if (sessionId) {
              request.setHeader('X-Hermes-Session-Id', sessionId);
            }
            request.on('response', (res) => {
              if (res.statusCode !== 200) {
                let b = ''; res.on('data', c => b += c);
                res.on('end', () => { _cancelFn = null; reject(new Error(`Gateway ${res.statusCode}`)); });
                return;
              }
              // 捕获会话 ID，后续请求复用
              const sid = res.headers['x-hermes-session-id'];
              if (sid) gateway.getRoleSessions()[roleId] = sid;
              let buffer = '', fullResponse = '';
              res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n'); buffer = lines.pop() || '';
                for (const line of lines) {
                  const sse = line.startsWith('data: ') ? line.slice(6) : null;
                  if (!sse || sse === '[DONE]') continue;
                  try {
                    const delta = JSON.parse(sse).choices?.[0]?.delta;
                    const d = delta?.content || delta?.reasoning_content;
                    if (d) {
                      fullResponse += d;
                      try { event.sender.send('hermes:stream', { text: d, type: 'response' }); } catch (_) {}
                    }
                    if (delta?.tool_calls) {
                      try { event.sender.send('hermes:stream', { text: '🔧 正在使用工具...', type: 'tool' }); } catch (_) {}
                    }
                  } catch (_) {}
                }
              });
              res.on('end', () => { _cancelFn = null; resolve({ finalLines: [fullResponse] }); });
            });
            request.on('error', (e) => { _cancelFn = null; reject(e); });
            request.write(postData);
            request.end();
          });
          const gwResponseText = result.finalLines.join('');
          // Gateway already converts "(empty)" to a friendly message, but defense-in-depth:
          const gwClean = (!gwResponseText || gwResponseText === "(empty)") ? "处理完成了，但模型没有生成文字回复。请尝试重新发送或换个说法。" : gwResponseText;
          // 积分扣减：Gateway 直连 DeepSeek，需主动报告用量
          const estimatedCredits = Math.max(1, Math.ceil((fullText.length + gwResponseText.length) / 500));
          try {
            await httpClient.httpPost(`${SERVER_URL}/api/credits/deduct?device_id=${licenses.getDeviceId()}`,
              JSON.stringify({ credits: estimatedCredits, model: 'deepseek-v4-flash' }));
          } catch (_) { /* 积分报告失败不影响主流程 */ }
          return { requestId, success: true, output: gwClean, offline: false, sessionId: gateway.getRoleSessions()[roleId] || null };
        } catch (e) {
          return { requestId, success: false, output: `执行失败：${e.message}`, sessionId: gateway.getRoleSessions()[roleId] || null };
        }
      }
    }
  if (action === 'pipeline:run') {
    const { steps, context } = args || {};
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return { requestId: 'req_' + Date.now(), success: false, output: 'pipeline steps 为空', sessionId: null };
    }
    let accumulatedContext = context || '';
    const results = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepRole = step.role || 'dami';
      const stepPrompt = step.text || '';
      // 通知前端步骤开始
      event.sender.send('hermes:stream', {
        type: 'pipeline-step',
        step: i + 1,
        total: steps.length,
        role: stepRole,
        status: 'running',
        preview: stepPrompt.slice(0, 100)
      });
      const fullPrompt = accumulatedContext
        ? `前面步骤的输出结果：\n${accumulatedContext.slice(-2000)}\n\n现在需要完成的任务：\n${stepPrompt}`
        : stepPrompt;
      try {
        // 确保 gateway 就绪
        let gatewayReady = await gateway.isGatewayRunning();
        if (!gatewayReady) {
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] pipeline step ${i+1}: gateway not ready, starting...\n`);
          gatewayReady = await gateway.startHermesGateway();
        }
        let stepOutput = '';
        if (gatewayReady) {
          stepOutput = await chatViaGateway(stepRole, fullPrompt, event.sender);
        } else {
          // CLI fallback
          const child = spawn(HERMES_BIN, ['chat', '-q', fullPrompt, '--max-turns', '60', '--source', 'tool'], {
            env: { ...process.env, HERMES_HOME: path.join(engineDir, '.hermes', 'agents', stepRole) }
          });
          _cancelFn = () => { try { child.kill(); } catch (_) {} };
          const cliResult = await new Promise((resolve, reject) => {
            let stdout = '', stderr = '';
            const timer = setTimeout(() => { child.kill(); reject(new Error('回复超时')); }, 600000);
            child.stdout.on('data', d => { stdout += d.toString(); });
            child.stderr.on('data', d => { stderr += d.toString(); });
            child.on('close', code => { clearTimeout(timer); _cancelFn = null; code === 0 ? resolve(stdout) : reject(new Error(stderr || 'AI 处理失败')); });
            child.on('error', e => { clearTimeout(timer); _cancelFn = null; reject(e); });
          });
          stepOutput = cliResult.split('\n').filter(l => { const t = l.trim(); return t && !t.startsWith('Query:') && !t.startsWith('Initializing') && !t.startsWith('─') && !t.startsWith('session_id:') && !t.startsWith('┊') && !t.startsWith('↻') && !t.includes('╭') && !t.includes('╰') && !t.startsWith('Resume this session') && !t.startsWith('hermes --resume') && !t.startsWith('Session:') && !t.startsWith('Duration:') && !t.startsWith('Messages:') && !t.startsWith('⚠'); }).map(l => l.trim()).join('\n').trim();
        }
        results.push({ role: stepRole, output: stepOutput });
        accumulatedContext += '\n\n' + stepOutput;
        event.sender.send('hermes:stream', {
          type: 'pipeline-step',
          step: i + 1,
          total: steps.length,
          role: stepRole,
          status: 'done',
          preview: stepOutput.slice(0, 200)
        });
      } catch (e) {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] pipeline step ${i+1} error: ${e.message}\n`);
        event.sender.send('hermes:stream', {
          type: 'pipeline-step',
          step: i + 1,
          total: steps.length,
          role: stepRole,
          status: 'error',
          error: e.message
        });
        results.push({ role: stepRole, output: `[错误] ${e.message}` });
      }
    }
    const finalOutput = results.map((r, i) => {
      const roleName = (rolesMgr.loadRoles()[r.role] || {}).name || r.role;
      return `### ${roleName}\n${r.output}`;
    }).join('\n\n---\n\n');
    return { requestId: 'req_' + Date.now(), success: true, output: finalOutput, pipeline: results, sessionId: gateway.getRoleSessions()[roleId] || null };
  }
  if (action === 'fs:list') {
    const dir = (args && args.dir) || path.join(homeDir, 'Documents');
    const withMeta = !!(args && args.meta);
    try {
      const names = fs.readdirSync(dir);
      if (!withMeta) return { files: names };
      const files = names.map(name => {
        try {
          const fullPath = path.join(dir, name);
          const st = fs.statSync(fullPath);
          const ext = path.extname(name).toLowerCase();
          let type = 'other';
          if (['.md', '.txt', '.markdown'].includes(ext)) type = 'markdown';
          else if (['.csv'].includes(ext)) type = 'csv';
          else if (['.xlsx', '.xls'].includes(ext)) type = 'excel';
          else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) type = 'image';
          else if (['.pdf'].includes(ext)) type = 'pdf';
          else if (['.py', '.js', '.ts', '.sh', '.html', '.css', '.json'].includes(ext)) type = 'code';
          return {
            name,
            size: st.size,
            mtime: st.mtime.toISOString(),
            ext,
            type,
            isDirectory: st.isDirectory()
          };
        } catch (_) {
          return { name, size: 0, mtime: null, ext: '', type: 'other', isDirectory: false };
        }
      });
      return { files };
    } catch (e) {
      return { files: [], error: e.message };
    }
  } else if (action === 'fs:move') {
    const { src, dst } = args || {};
    try {
      const dstDir = path.dirname(dst);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
      fs.renameSync(src, dst);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  } else if (action === 'fs:read') {
    const filePath = (args && args.path) || '';
    // Security: restrict reads to homeDir and app resources only
    const resolved = path.resolve(filePath);
    const allowedRoots = [homeDir, app.getAppPath(), app.getPath('userData')];
    const allowed = allowedRoots.some(function(root) { return resolved.startsWith(root + path.sep) || resolved === root; });
    if (!allowed) {
      return { content: '', error: 'Access denied: path outside allowed directories' };
    }
    try {
      const content = fs.readFileSync(resolved, 'utf8');
      return { content };
    } catch (e) {
      return { content: '', error: e.message };
    }
  } else if (action === 'shell:open') {
    const target = (args && args.path) || '';
    try {
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        shell.openPath(target);
      } else {
        shell.openPath(target);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  } else if (action === 'feedback:send') {
    // 记录用户反馈到本地日志
    const { type, requestId, text, timestamp } = args || {};
    const feedbackDir = path.join(homeDir, '.hermes', 'feedback');
    fs.mkdirSync(feedbackDir, { recursive: true });
    const entry = `${new Date(timestamp || Date.now()).toISOString()} type=${type} req=${requestId || '-'} text=${(text || '').slice(0, 200)}\n`;
    fs.appendFileSync(path.join(feedbackDir, 'feedback.log'), entry);
    return { success: true };
  }
  } catch (e) {
    return { success: false, output: e.stderr || e.message };
  }
});
// ===== IPC: 文件选择 =====
ipcMain.handle('file:select', async (event, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: (opts && opts.title) || '选择文件',
    filters: [
      { name: '支持的文件', extensions: ['xlsx', 'xls', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'pdf', 'md', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true, filePath: null };
  }
  return { canceled: false, filePath: result.filePaths[0] };
});
// ===== 头像上传 — 存到 Resources/avatars/，锁死到 App 内 =====
const AVATARS_DIR = (() => {
  const devDir = path.join(__dirname, 'avatars');
  if (fs.existsSync(devDir)) return devDir;
  return path.join(__dirname, '..', 'avatars');
})();
function ensureAvatarsDir() {
  if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
  }
}
ipcMain.handle('avatar:upload', async (event, role) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `选择「${role}」的头像`,
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { success: false, reason: 'canceled' };
  }
  const srcPath = result.filePaths[0];
  ensureAvatarsDir();
  const dstPath = path.join(AVATARS_DIR, `${role}.png`);
  try {
    // 裁剪为正方形并缩放到 256x256
    // macOS: use built-in sips; Windows/Linux: use sharp (if available) or copy directly
    if (process.platform === 'darwin') {
      execSync(`sips -Z 256 --cropToHeightWidth 256 256 "${srcPath}" --out "${dstPath}" 2>/dev/null || sips -Z 256 "${srcPath}" --out "${dstPath}"`, { timeout: 5000 });
    } else {
      try {
        const sharp = require('sharp');
        sharp(srcPath).resize(256, 256, { fit: 'cover' }).png().toFile(dstPath);
      } catch (_) {
        // sharp not available, copy file directly
        fs.copyFileSync(srcPath, dstPath);
      }
    }
    const buf = fs.readFileSync(dstPath);
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    return { success: true, dataUrl };
  } catch (e) {
    return { success: false, reason: e.message };
  }
});
ipcMain.handle('avatar:get', async (event, role) => {
  const p = path.join(AVATARS_DIR, `${role}.png`);
  if (fs.existsSync(p)) {
    const buf = fs.readFileSync(p);
    return { exists: true, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
  }
  return { exists: false };
});
// ===== IPC: 定时任务管理（直接走 hermes cron list/create/remove） =====
ipcMain.handle('cron:list', async () => {
  try {
    const allTasks = [];
    // 查询主引擎 + 所有角色 Gateway 的定时任务
    const hermesHomes = [path.join(engine.getEngineDir(), '.hermes')];
    const roleConfigs = gateway.getPlatformRoleConfigs();
    for (const cfg of roleConfigs) {
      hermesHomes.push(path.join(engine.getEngineDir(), '.hermes', 'agents', cfg.roleId));
    }
    for (const hh of hermesHomes) {
      try {
        const roleId = hh.includes('/agents/') ? hh.split('/agents/')[1] : 'main';
        const result = execSync(`${HERMES_BIN} cron list`, { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME: hh } });
        const lines = result.split('\n');
        let current = null;
        for (const line of lines) {
          const hexMatch = line.match(/^\s+([a-f0-9]{8,})\s+\[(active|disabled)\]/);
          if (hexMatch) {
            if (current) { current.roleId = roleId; allTasks.push(current); }
            current = { id: hexMatch[1], status: hexMatch[2], name: '', schedule: '', nextRun: '', lastRun: '', deliver: '', roleId: roleId };
          } else if (current) {
            const kv = line.match(/^\s+(\w[\w\s]*?):\s+(.+)/);
            if (kv) {
              const key = kv[1].trim().toLowerCase();
              const val = kv[2].trim();
              if (key === 'name') current.name = val;
              else if (key === 'schedule') current.schedule = val;
              else if (key === 'next run') current.nextRun = val;
              else if (key === 'last run') current.lastRun = val;
              else if (key === 'deliver') current.deliver = val;
            }
          }
        }
        if (current) { current.roleId = roleId; allTasks.push(current); }
      } catch (_) {}
    }
    return allTasks;
  } catch (e) {
    return [];
  }
});
ipcMain.handle('cron:create', async (event, opts) => {
  const { name, action, schedule } = opts || {};
  const prompts = {
    order: '每天自动生成系统导入模板，结果推送到飞书',
    reconcile: '对账银行流水，结果推送到飞书',
    loss: '计算货损率，结果推送到飞书',
    collection: '展示每日催收看板，结果推送到飞书',
    report: '生成每日销售简报，结果推送到飞书',
    salary: '试算业务员提成工资，结果推送到飞书',
  };
  const prompt = prompts[action] || `执行任务: ${action}`;
  try {
    const result = hermesCLI(
      `cron create "${schedule}" "${prompt.replace(/"/g, '\\"')}" --name "${(name || 'app-' + Date.now()).replace(/"/g, '')}" --deliver origin`,
      15000
    );
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, output: e.stderr || e.message };
  }
});
ipcMain.handle('cron:remove', async (event, params) => {
  const { id } = params || {};
  try {
    hermesCLI(`cron remove ${id}`, 5000);
    return { success: true };
  } catch (e) {
    return { success: false, output: e.message };
  }
});
ipcMain.handle('cron:pause', async (event, id) => {
  try {
    hermesCLI(`cron pause ${id}`, 5000);
    return { success: true };
  } catch (e) {
    return { success: false, output: e.message };
  }
});
ipcMain.handle('cron:resume', async (event, id) => {
  try {
    hermesCLI(`cron resume ${id}`, 5000);
    return { success: true };
  } catch (e) {
    return { success: false, output: e.message };
  }
});
ipcMain.handle('cron:run', async (event, id) => {
  try {
    hermesCLI(`cron run ${id}`, 15000);
    return { success: true };
  } catch (e) {
    return { success: false, output: e.message };
  }
});
// ===== IPC: 通道配置（Bot模式） =====
ipcMain.handle('channels:get', async () => {
  const channels = loadChannels();
  // 合并各角色 Gateway 的真实连接状态
  try {
    const engineDir = engine.getEngineDir();
    for (const [platformKey, platformData] of Object.entries(channels)) {
      if (typeof platformData !== 'object') continue;
      for (const roleId of Object.keys(platformData)) {
        if (roleId.startsWith('_')) continue;
        // 检查该角色的 Gateway 状态文件
        const roleStatePath = path.join(engineDir, '.hermes', 'agents', roleId, 'gateway_state.json');
        if (fs.existsSync(roleStatePath)) {
          const state = JSON.parse(fs.readFileSync(roleStatePath, 'utf-8'));
          const platform = state.platforms && state.platforms[platformKey];
          if (platform && platform.state === 'connected') {
            platformData[roleId].connected = true;
          }
        }
      }
    }
  } catch {}
  return channels;
});
ipcMain.handle('channels:save', async (event, channel, role, config) => {
  // 向后兼容：如果第三个参数是对象（旧调用方式），则 role 其实是 config
  if (typeof role === 'object' && !config) {
    config = role;
    role = 'dami';
  }
  role = role || 'dami';
  // 1. 写入 Hermes config.yaml（通过 hermes config set）
  try {
    for (const [key, value] of Object.entries(config)) {
      if (!value) continue;
      const escaped = String(value).replaceAll('"', '\\"');
      hermesCLI(`config set ${channel}.${key} "${escaped}"`, 5000);
    }
    // 确保启用该通道
    hermesCLI(`config set ${channel}.enabled true`, 5000);
  } catch (e) {
    console.error('hermes config set failed:', e.message);
  }
  // 2. 保存到 channels.json（按平台→角色嵌套存储）
  const data = loadChannels();
  if (!data[channel] || typeof data[channel].app_id === 'string') {
    // 旧数据是扁平的，迁移为嵌套结构
    const oldFlat = data[channel] || {};
    // 迁移旧字段
    if (oldFlat.app_id) {
      data[channel] = { _flat_migrated: true };
      data[channel][role] = { ...oldFlat };
    } else {
      data[channel] = { _flat_migrated: true };
    }
  }
  data[channel][role] = config;
  saveChannels(data);
  // 3. 重启网关使新配置生效
  let gatewayResult = { success: false, output: '' };
  try {
    gatewayResult = await restartGateway();
  } catch (e) {
    gatewayResult = { success: false, output: e.message };
  }
  // 4. 轮询等待网关初始化并完成平台连接（飞书连接是异步的，需要几秒）
  let connectStatus = null;
  if (gatewayResult.success) {
    const engineDir = engine.getEngineDir();
    // 优先检查角色独立 Gateway 的状态文件（飞书/企微/钉钉/QQ 由角色Gateway处理，不是主Gateway）
    const roleGatewayPath = path.join(engineDir, '.hermes', 'agents', role, 'gateway_state.json');
    const mainGatewayPath = path.join(engineDir, '.hermes', 'gateway_state.json');
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        // 先检查角色Gateway（优先），再检查主Gateway（兜底）
        for (const gp of [roleGatewayPath, mainGatewayPath]) {
          if (fs.existsSync(gp)) {
            const state = JSON.parse(fs.readFileSync(gp, 'utf-8'));
            const platform = state.platforms && state.platforms[channel];
            if (platform && platform.state === 'connected') {
              connectStatus = 'connected';
              break;
            }
          }
        }
        if (connectStatus === 'connected') break;
      } catch {}
    }
  }
  return {
    success: true,
    gatewayRestarted: gatewayResult.success,
    gatewayMessage: gatewayResult.output,
    connected: connectStatus === 'connected'
  };
});
ipcMain.handle('channels:test', async (event, params) => {
  const { channel } = params || {};
  const engineDir = engine.getEngineDir();
  // 网关状态文件可能存在于多个位置：角色独立Gateway（优先）或主Gateway（兜底）
  function _readPlatformState(gp) {
    try {
      if (!fs.existsSync(gp)) return null;
      const state = JSON.parse(fs.readFileSync(gp, 'utf-8'));
      return (state.platforms && state.platforms[channel]) || null;
    } catch (_) { return null; }
  }
  // 收集所有可能的 gateway_state.json 路径
  const statePaths = [];
  // 角色独立 Gateway（优先）
  try {
    const cfg = loadChannels();
    const platformData = cfg[channel] || {};
    for (const roleId of Object.keys(platformData)) {
      if (roleId.startsWith('_')) continue;
      statePaths.push(path.join(engineDir, '.hermes', 'agents', roleId, 'gateway_state.json'));
    }
  } catch (_) {}
  // 主 Gateway（兜底）
  statePaths.push(path.join(engineDir, '.hermes', 'gateway_state.json'));
  // 旧路径兼容
  statePaths.push(path.join(homeDir, '.hermes', 'gateway_state.json'));
  try {
    // 1. 检查是否有任何状态文件存在
    const anyExists = statePaths.some(p => fs.existsSync(p));
    if (!anyExists) {
      // 网关可能未启动，尝试重启
      const restartResult = await restartGateway();
      if (!restartResult.success) {
        return { success: false, output: '网关未启动，请尝试点击「重启网关」按钮' };
      }
      // 等3秒让网关初始化
      await new Promise(r => setTimeout(r, 3000));
    }
    // 2. 按优先级读取网关状态
    for (const gp of statePaths) {
      const platform = _readPlatformState(gp);
      if (!platform) continue;
      if (platform.state === 'connected') {
        return { success: true, output: `${channel} 已连接 ✅` };
      } else if (platform.state === 'retrying') {
        return { success: false, output: `${channel} 连接中...当前状态：重试中。请检查 App ID/Secret 是否正确` };
      } else {
        return { success: false, output: `${channel} 状态: ${platform.state}${platform.error_message ? ' — ' + platform.error_message : '。请检查配置是否正确'}` };
      }
    }
    return { success: false, output: `${channel} 尚未在网关中注册，请先保存配置并重启网关` };
  } catch (e) {
    return { success: false, output: `读取网关状态失败: ${e.message}` };
  }
});
// ===== IPC: 网关控制 =====
ipcMain.handle('channels:gateway-status', async () => {
  try {
    const running = await gateway.isGatewayRunning();
    const ready = engine.isEngineReady();
    return { running, ready, url: running ? GATEWAY_URL : null, message: ready ? '引擎就绪' : (running ? '引擎准备中' : '网关未启动') };
  } catch (e) {
    return { running: false, ready: false, message: `读取状态失败: ${e.message}` };
  }
});
ipcMain.handle('channels:gateway-restart', async () => {
  try {
    const result = await restartGateway();
    return result;
  } catch (e) {
    return { success: false, output: e.message };
  }
});
// ===== 飞书消息注入到 CLI 会话（共享上下文）=====
ipcMain.handle('chat:inject-message', async (event, roleId, message, cliSessionId) => {
  try {
    if (!cliSessionId) return { success: false, error: 'No CLI session ID' };
    const engineDir = engine.getEngineDir();
    const sessionsDir = path.join(engineDir, '.hermes', 'agents', roleId, 'sessions');
    const sessionFile = path.join(sessionsDir, `session_${cliSessionId}.json`);
    if (!fs.existsSync(sessionFile)) return { success: false, error: 'Session file not found' };
    // 直接写 JSON：追加用户消息到 messages 数组（不触发AI处理）
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    session.messages = session.messages || [];
    session.messages.push({ role: 'user', content: `📱 来自平台消息: ${message}` });
    session.last_updated = new Date().toISOString();
    session.message_count = session.messages.length;
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
// ===== 飞书消息同步 =====
let _feishuLastSeen = {}; // sessionKey -> last message index
ipcMain.handle('feishu:poll-messages', async () => {
  try {
    const engineDir = engine.getEngineDir();
    const messages = [];
    // v0.15.x: sessions 存储在 state.db (SQLite)，不再用 JSON 文件
    const dbDirs = [path.join(engineDir, '.hermes')];
    const platformConfigs = gateway.getPlatformRoleConfigs();
    const seenDirs = new Set();
    for (const cfg of platformConfigs) {
      const d = path.join(engineDir, '.hermes', 'agents', cfg.roleId);
      if (!seenDirs.has(d)) { seenDirs.add(d); dbDirs.push(d); }
    }
    for (const dbDir of dbDirs) {
      const dbPath = path.join(dbDir, 'state.db');
      if (!fs.existsSync(dbPath)) continue;
      try {
        let db;
        try {
          // Electron 39: node:sqlite may be disabled, fall back to sqlite3 CLI
          const { DatabaseSync } = require('node:sqlite');
          db = new DatabaseSync(dbPath);
        } catch (_) {
          // Fallback: use sqlite3 CLI via execSync
          db = null; // mark for CLI mode
        }
        if (db) {
          // Native mode: use node:sqlite DatabaseSync
          const sessions = db.prepare(
            "SELECT id, source, message_count FROM sessions WHERE source LIKE 'feishu%' OR source LIKE 'lark%' OR source LIKE 'wecom%' OR source LIKE '%:feishu:%' OR source LIKE '%:lark:%' OR source LIKE '%:wecom:%'"
          ).all();
          // 也读 sessions.json 兼容旧格式
          const sessionsJsonPath = path.join(dbDir, 'sessions', 'sessions.json');
          if (fs.existsSync(sessionsJsonPath)) {
            const index = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf8'));
            for (const [sessionKey, meta] of Object.entries(index)) {
              if (meta.platform !== 'feishu' && meta.platform !== 'lark' && meta.platform !== 'wecom') continue;
              const sid = meta.session_id;
              if (!sessions.find(s => s.id === sid)) {
                sessions.push({ id: sid, source: meta.platform || 'feishu', message_count: 0 });
              }
            }
          }
          for (const session of sessions) {
            const lastIdx = _feishuLastSeen[session.id] || -1;
            const rows = db.prepare(
              "SELECT role, content, timestamp FROM messages WHERE session_id=? ORDER BY id"
            ).all(session.id);
            const newMsgs = rows.slice(lastIdx + 1);
            if (newMsgs.length > 0) {
              _feishuLastSeen[session.id] = rows.length - 1;
              let roleId = 'dami';
              for (const cfg of platformConfigs) {
                if (dbDir.includes(cfg.roleId)) { roleId = cfg.roleId; break; }
              }
              const sessionSource = (session.source || '').toLowerCase();
              let platformLabel = '飞书';
              if (sessionSource.includes('wecom')) platformLabel = '企业微信';
              else if (sessionSource.includes('feishu') || sessionSource.includes('lark')) platformLabel = '飞书';
              for (const msg of newMsgs) {
                const content = (msg.content || '').trim();
                if (!content || content === 'session_meta') continue;
                if (content.length > 100 && content.includes('你是') && content.includes('擅长') && content.includes('风格')) continue;
                const userMsgMatch = content.match(/用户消息[：:]\s*(.+)$/s);
                let text = userMsgMatch ? userMsgMatch[1].trim() : content;
                messages.push({
                  role: msg.role === 'user' ? 'user' : 'hermes',
                  text: text.slice(0, 1000),
                  time: new Date(msg.timestamp * 1000).toISOString(),
                  platform: platformLabel,
                  sessionKey: session.id,
                  roleId
                });
              }
            }
          }
          db.close();
        } else {
          // CLI fallback: use sqlite3 command-line tool
          try {
            const sessionJson = execSync(`sqlite3 -json "${dbPath}" "SELECT id, source, message_count FROM sessions WHERE source LIKE '%feishu%' OR source LIKE '%lark%' OR source LIKE '%wecom%'" 2>/dev/null || echo '[]'`, { encoding: 'utf8', timeout: 5000 });
            const sessions = JSON.parse(sessionJson || '[]');
            for (const session of sessions) {
              const lastIdx = _feishuLastSeen[session.id] || -1;
              const msgJson = execSync(`sqlite3 -json "${dbPath}" "SELECT role, content, timestamp FROM messages WHERE session_id='${session.id}' ORDER BY id" 2>/dev/null || echo '[]'`, { encoding: 'utf8', timeout: 5000 });
              const rows = JSON.parse(msgJson || '[]');
              const newMsgs = rows.slice(lastIdx + 1);
              if (newMsgs.length > 0) {
                _feishuLastSeen[session.id] = rows.length - 1;
                const sessionSource = (session.source || '').toLowerCase();
                let platformLabel = '飞书';
                if (sessionSource.includes('wecom')) platformLabel = '企业微信';
                for (const msg of newMsgs) {
                  const content = (msg.content || '').trim();
                  if (!content || content === 'session_meta') continue;
                  const userMsgMatch = content.match(/用户消息[：:]\s*(.+)$/s);
                  let text = userMsgMatch ? userMsgMatch[1].trim() : content;
                  messages.push({
                    role: msg.role === 'user' ? 'user' : 'hermes',
                    text: text.slice(0, 1000),
                    time: new Date(msg.timestamp * 1000).toISOString(),
                    platform: platformLabel,
                    sessionKey: session.id,
                    roleId: 'dami'
                  });
                }
              }
            }
          } catch (cliErr) { /* sqlite3 CLI unavailable, skip */ }
        }
      } catch (e) { /* state.db 读取失败，跳过 */ }
    }
    return { messages };
  } catch (e) {
    return { messages: [], error: e.message };
  }
});
// ===== IPC: 在 Finder 中打开文件/文件夹 =====
ipcMain.handle('shell:openFolder', async (event, filePath) => {
  try {
    const resolved = filePath.replace(/^~/, homeDir);
    if (fs.existsSync(resolved)) {
      shell.showItemInFolder(resolved);
      return { success: true };
    }
    return { success: false, error: '路径不存在: ' + resolved };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
// ===== IPC: 引擎更新 =====
ipcMain.handle('execute:update', async (event, { downloadUrl }) => {
  const tmpFile = path.join(require('os').tmpdir(), 'hergent-update.tar.gz');
  try {
    await downloadFile(downloadUrl, tmpFile);
    const result = execSync(
      `${HERMES_BIN} profile import ${tmpFile} --profile hergent`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    fs.unlinkSync(tmpFile);
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, output: e.message };
  }
});
// ===== IPC: 状态 =====
ipcMain.handle('get:status', async () => {
  const profileDir = path.join(homeDir, '.hermes', 'profiles', PROFILE);
  const profileExists = fs.existsSync(profileDir);
  const channels = loadChannels();
  return {
    hermesInstalled: true,
    profileExists,
    channels,
    version: CURRENT_VERSION,
    profile: PROFILE,
    license: licenses.getLicenseStatus(),
  };
});
ipcMain.handle('get:errors', async () => {
  return ERROR_HISTORY;
});
// ===== IPC: 激活码 & 试用 =====
ipcMain.handle('activation:status', async () => {
  try {
    const body = await httpClient.httpGet(`${SERVER_URL}/api/credits?device_id=${licenses.getDeviceId()}`);
    const data = JSON.parse(body);
    return { credits: data.credits || 0 };
  } catch (e) {
    return { credits: 0, message: '无法连接服务' };
  }
});
ipcMain.handle('activation:device-id', async () => {
  return licenses.getDeviceId();
});
ipcMain.handle('activation:activate', async (event, { code }) => {
  const deviceId = licenses.getDeviceId();
  if (!licenses.verifyActivationCode(code, deviceId)) {
    return { success: false, message: '激活码无效，请核对后重试' };
  }
  const lic = licenses.loadLicense();
  const now = new Date();
  const expireDate = new Date(now.getTime() + LICENSE_DAYS * 24 * 60 * 60 * 1000);
  lic.activated = true;
  lic.activationCode = code;
  lic.activateDate = now.toISOString();
  lic.expireDate = expireDate.toISOString();
  licenses.saveLicense(lic);
  return {
    success: true,
    message: `激活成功！有效期至 ${expireDate.toLocaleDateString('zh-CN')}（${LICENSE_DAYS}天）`,
    expireDate: expireDate.toISOString(),
  };
});
// Alpha 激活码验证 — 调用远程服务器
ipcMain.handle('activation:verify', async (event, code) => {
  try {
    var body = await httpClient.nodeHttpPost('https://api.hergent.cn/api/auth/activate',
      JSON.stringify({ code: code, device: licenses.getDeviceId() }));
    return JSON.parse(body);
  } catch (e) { return { ok: false, message: '网络错误，请检查连接' }; }
});
// activation:server-activate 已移除 — 产品改为积分制，激活/鉴权走 /api/credits + deviceId
// ===== IPC: 查询积分余额（调用 Hermes Server API）=====
ipcMain.handle('activation:credits', async () => {
  try {
    const body = await httpClient.httpGet(`${SERVER_URL}/api/credits?device_id=${licenses.getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) {
    console.error(`[credits] error: ${e.message}`);
    return { credits: 0, message: '无法连接服务' };
  }
});
ipcMain.handle('billing:history', async () => {
  try {
    const body = await httpClient.httpGet(`${SERVER_URL}/api/billing/history?device_id=${licenses.getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) { return { recharges: [], usage: [], balance: 0 }; }
});
// 打开外部链接
ipcMain.handle('shell:open', async (event, url) => {
  require('electron').shell.openExternal(url);
  return true;
});
// ===== 窗口控制 =====
ipcMain.on('window:minimize', () => win.getMainWindow().minimize());
ipcMain.on('window:maximize', () => {
  win.getMainWindow().isMaximized() ? win.getMainWindow().unmaximize() : win.getMainWindow().maximize();
});
ipcMain.on('window:close', () => win.getMainWindow().close());
ipcMain.on('window:drag', (event, { deltaX, deltaY }) => {
  const [x, y] = win.getMainWindow().getPosition();
  win.getMainWindow().setPosition(x + deltaX, y + deltaY);
});
// ===== 右键菜单 =====
ipcMain.on('show-context-menu', (event) => {
  const { Menu, clipboard } = require('electron');
  const win = BrowserWindow.fromWebContents(event.sender);
  const menu = Menu.buildFromTemplate([
    { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy', enabled: true },
    { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut', enabled: true },
    { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste', enabled: true },
    { type: 'separator' },
    { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll', enabled: true },
  ]);
  menu.popup({ window: win });
});
// ===== 真正的 Hermes CLI 自动安装 =====
function findHermesInVenv(venvDir) {
  const candidates = isWindows ? ['hermes.exe', 'hermes.cmd'] : ['hermes'];
  const binSubdir = isWindows ? path.join('venv', 'Scripts') : path.join('venv', 'bin');
  for (const name of candidates) {
    const p = path.join(venvDir, binSubdir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: url });
    request.setHeader('User-Agent', 'Hergent-Desktop/1.0');
    request.on('response', (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { try { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve(); } catch(e) { reject(e); } });
      res.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}
async function ensurePython(send) {
  // 1. 检查系统 Python 3.11+
  try {
    const sysPython = isWindows ? 'python' : 'python3';
    const ver = execSync(`"${sysPython}" --version 2>&1`, { timeout: 5000, windowsHide: true }).toString();
    const match = ver.match(/Python (\d+)\.(\d+)/);
    if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 11) {
      send('python-ok|系统 Python ' + match[0]);
      return sysPython;
    }
  } catch(e) {}
  // 2. 检查已下载的便携 Python
  const portableDir = path.join(homeDir, '.hermes', 'python');
  const portablePython = isWindows
    ? path.join(portableDir, 'python', 'python.exe')
    : path.join(portableDir, 'python', 'bin', 'python3');
  if (fs.existsSync(portablePython)) {
    send('python-ok|便携 Python 已就绪');
    return portablePython;
  }
  // 3. 下载便携 Python
  send('python-dl|下载 Python 运行环境（约 18-40MB）…');
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const platform = isWindows ? 'windows' : 'darwin';
  const filename = `cpython-3.11.9-${arch}-${platform}.tar.gz`;
  const downloadUrl = `https://api.hergent.cn/updates/python/${filename}`;
  const tmpFile = path.join(homeDir, '.hermes', filename);
  try {
    await downloadFile(downloadUrl, tmpFile);
  } catch(e) {
    send('error|Python 下载失败: ' + e.message);
    return null;
  }
  // 4. 解压
  send('python-extract|解压 Python…');
  fs.mkdirSync(portableDir, { recursive: true });
  try {
    execSync(`tar -xzf "${tmpFile}" -C "${portableDir}"`, { timeout: 120000, windowsHide: true });
    try { fs.unlinkSync(tmpFile); } catch(_) {}
  } catch(e) {
    send('error|Python 解压失败: ' + e.message);
    return null;
  }
  if (fs.existsSync(portablePython)) {
    send('python-ok|Python 安装完成');
    return portablePython;
  }
  send('error|Python 安装后未找到可执行文件');
  return null;
}
ipcMain.handle('hermes:bootstrap', async (event) => {
  const send = (msg) => { try { event.sender.send('hermes:boot-progress', msg); } catch(_) {} };
  const log = (msg) => {
    const lf = path.join(homeDir, '.hermes', 'app_debug.log');
    try { fs.appendFileSync(lf, `[${new Date().toISOString()}] BOOT: ${msg}\n`); } catch(_) {}
  };
  // 如果已经装好了，快速通过
  if (HERMES_BIN !== HERMES_CMD && fs.existsSync(HERMES_BIN)) {
    send('check|检查环境…');
    send('done|准备就绪！');
    return { success: true, message: 'Hermes ready', path: HERMES_BIN };
  }
  send('check|检查环境…');
  log('bootstrap starting');
  // Step 1: Python
  const pythonPath = await ensurePython(send);
  if (!pythonPath) {
    send('error|Python 环境安装失败，请检查网络连接后重试');
    return { success: false, message: 'Python 安装失败' };
  }
  // Step 2: 创建目录和虚拟环境
  send('mkdir|创建虚拟环境…');
  const venvDir = path.join(homeDir, '.hermes', 'hermes-agent');
  fs.mkdirSync(venvDir, { recursive: true });
  send('venv|创建虚拟环境…');
  try {
    execSync(`"${pythonPath}" -m venv "${path.join(venvDir, 'venv')}"`, { timeout: 120000, windowsHide: true });
  } catch(e) {
    log('venv failed: ' + e.message);
    send('error|虚拟环境创建失败');
    return { success: false, message: '虚拟环境创建失败' };
  }
  const venvPython = isWindows
    ? path.join(venvDir, 'venv', 'Scripts', 'python.exe')
    : path.join(venvDir, 'venv', 'bin', 'python3');
  // Step 3: pip install hermes-agent
  send('pip|安装 Hermes Agent（首次约需 1-2 分钟）…');
  try {
    // Try Tsinghua mirror first, fallback to PyPI
    try {
      execSync(`"${venvPython}" -m pip install --quiet -i https://pypi.tuna.tsinghua.edu.cn/simple hermes-agent aiohttp`, { timeout: 300000, windowsHide: true });
    } catch(_) {
      execSync(`"${venvPython}" -m pip install --quiet hermes-agent aiohttp`, { timeout: 300000, windowsHide: true });
    }
  } catch(e) {
    log('pip failed: ' + e.message);
    send('error|Hermes Agent 安装失败，请检查网络连接');
    return { success: false, message: 'Hermes Agent 安装失败' };
  }
  // Step 4: 找到 hermes 可执行文件
  const foundBin = findHermesInVenv(venvDir);
  if (!foundBin || !fs.existsSync(foundBin)) {
    send('error|未找到 Hermes 可执行文件');
    return { success: false, message: '未找到 Hermes' };
  }
  // 更新全局 HERMES_BIN
  HERMES_BIN = foundBin;
  log('bootstrap complete, HERMES_BIN=' + HERMES_BIN);
  // Step 5: 写 Gateway 配置 — 委托给 Hermes CLI
  send('config|配置 Hermes…');
  try {
    const cfgEnv = { ...process.env, HERMES_HOME: path.join(homeDir, '.hermes') };
    const set = (k, v) => spawnSync(HERMES_BIN, ['config', 'set', k, v], { timeout: 5000, env: cfgEnv });
    const dsKey = licenses.getDeepSeekApiKey();
    set('model.name', 'deepseek-v4-flash');
    set('model.provider', 'openai');
    set('platforms.api_server.enabled', 'true');
    set('platforms.api_server.port', '18765');
    set('max_turns', '60');
    set('custom_providers.0.name', 'openai');
    set('custom_providers.0.base_url', `${SERVER_URL}/v1`);
    set('custom_providers.0.api_key', dsKey);
    log('config written via hermes config set');
  } catch(e) {
    log('config write warning: ' + e.message);
  }
  // Step 6: 启动 Hermes Gateway（bootstrap 前 HERMES_BIN 不存在，此时重启）
  send('gateway|启动 AI 引擎…');
  log('post-bootstrap: restarting gateway');
  gateway.startHermesGateway().then(ok => {
    log('post-bootstrap gateway: ' + (ok ? 'OK' : 'FAILED'));
  });
  send('done|准备就绪！');
  return { success: true, message: 'Hermes ready', path: HERMES_BIN };
});
// 查找 Hermes 引擎的 git 仓库目录（用于检测更新）
function findHermesRepo() {
  // 1. 从 HERMES_BIN 所在位置找
  if (HERMES_BIN && fs.existsSync(HERMES_BIN)) {
    let dir = path.dirname(HERMES_BIN);
    // hermes -> venv/bin/hermes -> hermes-agent/
    for (let i = 0; i < 5; i++) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      dir = path.dirname(dir);
    }
  }
  // 2. 默认位置
  const defaultRepo = path.join(homeDir, '.hermes', 'hermes-agent');
  if (fs.existsSync(path.join(defaultRepo, '.git'))) return defaultRepo;
  // 3. 引擎解压位置
  const engineDir = engine.getEngineDir();
  if (fs.existsSync(path.join(engineDir, '.git'))) return engineDir;
  return null;
}
ipcMain.handle('hermes:check-cli', async () => {
  const exists = fs.existsSync(HERMES_BIN);
  if (!exists) return { available: false, version: null, updateAvailable: false };
  let version = '';
  try {
    const ver = spawnSync(HERMES_BIN, ['--version'], {
      timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    if (ver.status === 0 && ver.stdout) {
      const m = ver.stdout.match(/(?:Hermes Agent|v)\s*(v?\d+\.\d+\.\d+)/i);
      version = m ? m[1] : ver.stdout.trim().split('\n')[0];
    }
  } catch (_) {}
  return { available: true, version: version || 'unknown', updateAvailable: false, commitsBehind: 0 };
});
ipcMain.handle('hermes:check-engine-update', async () => {
  let updateAvailable = false;
  let commitsBehind = 0;
  const repo = findHermesRepo();
  if (!repo) return { updateAvailable: false, commitsBehind: 0, repo: null };
  try {
    spawnSync('git', ['fetch', 'origin'], {
      cwd: repo, timeout: 15000,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    const count = spawnSync('git', ['rev-list', 'HEAD..origin/main', '--count'], {
      cwd: repo, timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    if (count.status === 0 && count.stdout) {
      commitsBehind = parseInt(count.stdout.trim(), 10) || 0;
      updateAvailable = commitsBehind > 0;
    }
  } catch (_) {}
  return { updateAvailable, commitsBehind, repo };
});
ipcMain.handle('hermes:update-engine', async () => {
  const repo = findHermesRepo();
  if (!repo) return { success: false, error: '未找到 Hermes 引擎目录' };
  try {
    // Step 1: git pull
    const pull = spawnSync('git', ['pull', 'origin', 'main'], {
      cwd: repo, timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    if (pull.status !== 0) {
      return { success: false, error: pull.stderr || 'git pull 失败' };
    }
    // Step 2: 引擎更新后重启 gateway
    try {
      if (HERMES_BIN && fs.existsSync(HERMES_BIN)) {
        spawnSync(HERMES_BIN, ['gateway', 'restart'], {
          timeout: 15000,
          stdio: ['ignore', 'ignore', 'ignore']
        });
      }
    } catch (_) {}
    // Step 3: 重新读取版本
    let version = '';
    try {
      const ver = spawnSync(HERMES_BIN, ['--version'], {
        timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      if (ver.status === 0 && ver.stdout) {
        const m = ver.stdout.match(/(?:Hermes Agent|v)\s*(v?\d+\.\d+\.\d+)/i);
        version = m ? m[1] : ver.stdout.trim().split('\n')[0];
      }
    } catch (_) {}
    return { success: true, version: version || 'updated', message: pull.stdout || '更新完成' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('hermes:cancel', async () => {
  if (_cancelFn) {
    try { _cancelFn(); } catch (_) {}
    _cancelFn = null;
  }
  return { success: true };
});
ipcMain.handle('session:clear', async (event, role) => {
  const roleId = role || 'dami';
  try {
    const engineDir = engine.getEngineDir();
    const roleHome = path.join(engineDir, '.hermes', 'agents', roleId);
    const opts = { timeout: 5000, env: { ...process.env, HERMES_HOME: roleHome } };
    if (isWindows) {
      spawnSync(HERMES_BIN, ['session', 'reset'], { ...opts, shell: true });
    } else {
      spawnSync(HERMES_BIN, ['session', 'reset'], opts);
    }
  } catch (_) {}
  return { success: true };
});
ipcMain.handle('notify:send', async (event, { title, body }) => {
  try {
    new (require('electron').Notification)({ title: title || 'Hergent', body: body || '' }).show();
    return { success: true };
  } catch (_) { return { success: false }; }
});
ipcMain.handle('theme:get', async () => {
  let userPreference = 'system';
  try {
    const tp = path.join(app.getPath('userData'), 'theme.json');
    if (fs.existsSync(tp)) {
      const saved = JSON.parse(fs.readFileSync(tp, 'utf8'));
      userPreference = saved.mode || 'system';
    }
  } catch(_) {}
  const effectiveIsDark = userPreference === 'dark' || (userPreference === 'system' && nativeTheme.shouldUseDarkColors);
  return { userPreference, effectiveIsDark };
});
ipcMain.handle('theme:set', async (event, mode) => {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'theme.json'), JSON.stringify({ mode }));
  } catch(_) {}
  const effectiveIsDark = mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
  return { effectiveIsDark };
});
// 系统主题变化时通知渲染进程
nativeTheme.on('updated', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
});
// ---- 记忆系统 (按角色隔离) ----
// ---- 记忆系统（CRUD + 类型推断 + 统计）----
function _inferMemoryType(title, preview) {
  const t = (title + ' ' + (preview || '')).toLowerCase();
  if (/习惯|偏好|喜欢|常用|经常|总是|爱|讨厌|不喜欢|介意/i.test(t)) return 'preference';
  if (/姓名|名字|电话|邮箱|住址|公司|职位|年龄|生日|毕业于|来自|住在/i.test(t)) return 'fact';
  if (/工作|开会|周报|项目|任务|流程|上班|加班|协作|团队/i.test(t)) return 'pattern';
  if (/风格|简洁|详细|正式|幽默|严谨|语气|语气词|回复方式/i.test(t)) return 'style';
  return 'fact'; // 默认归类为事实
}
const MEMORY_TYPES = {
  preference: { label: '偏好习惯', icon: '💝', order: 1 },
  fact:       { label: '重要事实', icon: '📌', order: 2 },
  pattern:    { label: '工作模式', icon: '🔄', order: 3 },
  style:      { label: '个人风格', icon: '🎨', order: 4 },
};
function getRoleMemoryPath(roleId) {
  const engineDir = engine.getEngineDir();
  // 优先用角色独立记忆路径，不存在则回退到共享路径
  const roleMemPath = path.join(engineDir, '.hermes', 'agents', roleId || 'dami', 'memories', 'MEMORY.md');
  if (fs.existsSync(roleMemPath)) return roleMemPath;
  return path.join(engineDir, '.hermes', 'memories', 'MEMORY.md');
}
ipcMain.handle('memory:list', async (event, role) => {
  try {
    const roleId = role || 'dami';
    const memoryPath = getRoleMemoryPath(roleId);
    if (!fs.existsSync(memoryPath)) return { memories: [], stats: { total: 0, byType: {}, mtime: null } };
    const content = fs.readFileSync(memoryPath, 'utf8');
    const stat = fs.statSync(memoryPath);
    const sections = content.split(/^§/m).filter(s => s.trim());
    const memories = sections.map((sec, i) => {
      const lines = sec.trim().split('\n');
      const title = (lines[0] || '').replace(/^#+\s*/, '').trim() || '记忆片段';
      const preview = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      const id = crypto.createHash('md5').update(sec).digest('hex').slice(0, 8);
      const type = _inferMemoryType(title, preview);
      return { id, title, preview, type, updated: stat.mtime.toISOString() };
    });
    // 按类型分组统计
    const byType = {};
    memories.forEach(m => { byType[m.type] = (byType[m.type] || 0) + 1; });
    return { memories, stats: { total: memories.length, byType, mtime: stat.mtime.toISOString() } };
  } catch (_) { return { memories: [], stats: { total: 0, byType: {}, mtime: null } }; }
});
ipcMain.handle('memory:add', async (event, role, title, content, type) => {
  try {
    const roleId = role || 'dami';
    const memoryPath = getRoleMemoryPath(roleId);
    const dir = path.dirname(memoryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const typeLabel = MEMORY_TYPES[type] ? MEMORY_TYPES[type].label : '重要事实';
    const entry = `\n§ ## ${title}\n> 类型: ${typeLabel}\n\n${content}\n`;
    fs.appendFileSync(memoryPath, entry);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('memory:update', async (event, role, id, title, content, type) => {
  try {
    const roleId = role || 'dami';
    const memoryPath = getRoleMemoryPath(roleId);
    if (!fs.existsSync(memoryPath)) return { success: false, error: '记忆文件不存在' };
    const oldContent = fs.readFileSync(memoryPath, 'utf8');
    const sections = oldContent.split(/^§/m);
    let found = false;
    const updated = sections.map(sec => {
      const sid = crypto.createHash('md5').update(sec).digest('hex').slice(0, 8);
      if (sid === id) {
        found = true;
        const typeLabel = MEMORY_TYPES[type] ? MEMORY_TYPES[type].label : '重要事实';
        return `§ ## ${title}\n> 类型: ${typeLabel}\n\n${content}\n`;
      }
      return sec;
    });
    if (!found) return { success: false, error: '未找到该记忆' };
    fs.writeFileSync(memoryPath, updated.join('').trim() + '\n');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('memory:delete', async (event, id, role) => {
  try {
    const roleId = role || 'dami';
    const memoryPath = getRoleMemoryPath(roleId);
    if (!fs.existsSync(memoryPath)) return { success: false, error: '记忆文件不存在' };
    const content = fs.readFileSync(memoryPath, 'utf8');
    const sections = content.split(/^§/m);
    const kept = sections.filter(sec => {
      const sid = crypto.createHash('md5').update(sec).digest('hex').slice(0, 8);
      return sid !== id;
    });
    fs.writeFileSync(memoryPath, kept.join('').trim() + '\n');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('memory:stats', async (event, role) => {
  try {
    const roleId = role || 'dami';
    const memoryPath = getRoleMemoryPath(roleId);
    if (!fs.existsSync(memoryPath)) return { total: 0, byType: {}, mtime: null, level: 0, levelLabel: '初始' };
    const content = fs.readFileSync(memoryPath, 'utf8');
    const stat = fs.statSync(memoryPath);
    const sections = content.split(/^§/m).filter(s => s.trim());
    const byType = {};
    sections.forEach(sec => {
      const lines = sec.trim().split('\n');
      const title = (lines[0] || '').replace(/^#+\s*/, '').trim();
      const preview = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      const t = _inferMemoryType(title, preview);
      byType[t] = (byType[t] || 0) + 1;
    });
    const total = sections.length;
    let level = 0, levelLabel = '初始';
    if (total >= 31) { level = 4; levelLabel = '非常了解'; }
    else if (total >= 16) { level = 3; levelLabel = '比较熟悉'; }
    else if (total >= 6) { level = 2; levelLabel = '逐渐了解'; }
    else if (total >= 1) { level = 1; levelLabel = '初步认识'; }
    return { total, byType, mtime: stat.mtime.toISOString(), level, levelLabel };
  } catch (_) { return { total: 0, byType: {}, mtime: null, level: 0, levelLabel: '初始' }; }
});
// ---- 技能列表 ----
ipcMain.handle('skills:list', async () => {
  try {
    engine.ensureSharedState(); // 确保技能已从 bundle 同步
    const engineDir = engine.getEngineDir();
    const skillsDir = path.join(engineDir, '.hermes', 'skills');
    if (!fs.existsSync(skillsDir)) return { categories: [], total: 0 };
    function parseSkill(skillDir, slug) {
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) return null;
      const content = fs.readFileSync(skillMd, 'utf8').slice(0, 2000);
      let name = slug, description = '';
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fm = fmMatch[1];
        const nm = fm.match(/^name:\s*(.+)$/m);
        const ds = fm.match(/^description:\s*(.+)$/m);
        if (nm) name = nm[1].trim();
        if (ds) description = ds[1].trim().slice(0, 120);
      } else {
        const titleMatch = content.match(/^#\s+(.+)/m);
        if (titleMatch) name = titleMatch[1].trim();
      }
      return { name, slug, description };
    }
    const categories = [];
    const topEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const e of topEntries) {
      if (!e.isDirectory()) continue;
      // 1. 顶层技能: skillsDir/name/SKILL.md
      const direct = parseSkill(path.join(skillsDir, e.name), e.name);
      if (direct) { categories.push({ ...direct, category: '其他' }); continue; }
      // 2. 分类目录: skillsDir/category/skillName/SKILL.md
      const categoryName = e.name;
      const subEntries = fs.readdirSync(path.join(skillsDir, e.name), { withFileTypes: true });
      for (const se of subEntries) {
        if (!se.isDirectory()) continue;
        const skill = parseSkill(path.join(skillsDir, e.name, se.name), se.name);
        if (skill) categories.push({ ...skill, category: categoryName });
      }
    }
    return { categories, total: categories.length };
  } catch (_) { return { categories: [], total: 0 }; }
});
ipcMain.handle('roles:list', async () => {
  const roles = rolesMgr.loadRoles();
  return Object.entries(roles).map(([id, r]) => ({ id, ...r }));
});
// ---- 角色 CRUD ----
ipcMain.handle('roles:save', async (event, roles) => {
  try {
    if (typeof roles === 'object' && !Array.isArray(roles)) {
      rolesMgr.saveRoles(roles);
      return { success: true };
    }
    return { success: false, error: '格式错误' };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('roles:add', async (event, roleData) => {
  try {
    const roles = rolesMgr.loadRoles();
    let id = (roleData.name || '新角色').replace(/[^a-zA-Z0-9一-鿿]/g, '').slice(0, 12) || 'custom';
    if (roles[id]) id = id + '_' + Date.now().toString(36);
    roles[id] = { name: roleData.name || '新角色', systemPrompt: roleData.systemPrompt || '', opening: roleData.opening || '', builtIn: false };
    rolesMgr.saveRoles(roles);
    return { success: true, id, role: { id, ...roles[id] } };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('roles:delete', async (event, roleId) => {
  try {
    const roles = rolesMgr.loadRoles();
    if (!roles[roleId]) return { success: false, error: '角色不存在' };
    if (roles[roleId].builtIn) return { success: false, error: '内置角色不可删除' };
    delete roles[roleId];
    rolesMgr.saveRoles(roles);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('roles:update', async (event, roleId, updates) => {
  try {
    const roles = rolesMgr.loadRoles();
    if (!roles[roleId]) return { success: false, error: '角色不存在' };
    if (updates && typeof updates === 'object') Object.assign(roles[roleId], updates);
    rolesMgr.saveRoles(roles);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
// ---- 服务端 URL ----
ipcMain.handle('server:get-url', async () => {
  try {
    const p = path.join(app.getPath('userData'), 'server-url.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return { url: SERVER_URL };
});
ipcMain.handle('server:save-url', async (event, url) => {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'server-url.json'), JSON.stringify({ url }));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
// ---- 模型配置（通过 hermes config set 切换）----
ipcMain.handle('config:get-model', async () => {
  try {
    const engineDir = engine.getEngineDir();
    const configPath = path.join(engineDir, '.hermes', 'config.yaml');
    if (!fs.existsSync(configPath)) return { model: 'deepseek-v4-flash', provider: 'openai' };
    const yaml = fs.readFileSync(configPath, 'utf8');
    const result = { model: '', provider: '' };
    const modelMatch = yaml.match(/^model:\s*\n(?:\s+name:\s*(.+)\s*\n\s+provider:\s*(.+)|)/m);
    if (modelMatch) {
      result.model = (modelMatch[1] || 'deepseek-v4-flash').trim();
      result.provider = (modelMatch[2] || 'openai').trim();
    }
    const cpSection = yaml.match(/^custom_providers:\s*\n([\s\S]*?)(?:^\w|\Z)/m);
    if (cpSection) {
      const providers = [];
      const entries = cpSection[1].split(/(?:^|\n)\s*- /);
      for (const entry of entries) {
        const name = entry.match(/^\s*name:\s*(.+)/m);
        const baseUrl = entry.match(/^\s*base_url:\s*(.+)/m);
        const apiKey = entry.match(/^\s*api_key:\s*(.+)/m);
        const model = entry.match(/^\s*model:\s*(.+)/m);
        if (name) providers.push({
          name: name[1].trim(),
          base_url: (baseUrl && baseUrl[1]) ? baseUrl[1].trim() : '',
          api_key: (apiKey && apiKey[1]) ? apiKey[1].trim().replace(/^hermes_/, '') : '',
          model: (model && model[1]) ? model[1].trim() : 'deepseek-v4-flash',
        });
      }
      result.custom_providers = providers;
    }
    return result;
  } catch (e) { return { model: 'deepseek-v4-flash', provider: 'openai', error: e.message }; }
});
ipcMain.handle('config:set-model', async (event, opts) => {
  try {
    const engineDir = engine.getEngineDir();
    const engineHermesHome = path.join(engineDir, '.hermes');
    const agentHermesHome = path.join(homeDir, '.hermes');
    // 直接写 YAML，避免 v0.15.x hermes config set 写出字典格式
    const newModel = opts.model || 'deepseek-v4-flash';
    const newProvider = opts.provider || 'openai';
    const apiKeyId = 'hermes_' + licenses.getDeviceId();
    // 更新主引擎 config
    const mainCfgPath = path.join(engineDir, '.hermes', 'config.yaml');
    try {
      let mc = fs.existsSync(mainCfgPath) ? fs.readFileSync(mainCfgPath, 'utf8') : '';
      if (mc.match(/^model:/m)) {
        mc = mc.replace(/^model:\n(\s+name: .+\n)(\s+provider: .+\n)?(\s+base_url: .+\n)?(\s+default: .+\n)?/m,
          'model:\n  name: ' + newModel + '\n  provider: ' + newProvider + '\n');
      } else {
        mc = 'model:\n  name: ' + newModel + '\n  provider: ' + newProvider + '\n' + mc;
      }
      if (mc.match(/^custom_providers:/m)) {
        mc = mc.replace(/^custom_providers:\n(?:  - name: .+\n    base_url: .+\n    api_key: .+\n    model: .+\n?)*/m,
          'custom_providers:\n  - name: openai\n    base_url: ' + SERVER_URL + '/v1\n    api_key: ' + apiKeyId + '\n    model: ' + newModel + '\n');
      } else {
        mc += '\ncustom_providers:\n  - name: openai\n    base_url: ' + SERVER_URL + '/v1\n    api_key: ' + apiKeyId + '\n    model: ' + newModel + '\n';
      }
      fs.writeFileSync(mainCfgPath, mc);
    } catch (_) {}
    // 同步模型到所有角色 config
    const allRoles = rolesMgr.loadRoles();
    for (const [roleId] of Object.entries(allRoles)) {
      const roleCfgPath = path.join(engineDir, '.hermes', 'agents', roleId, 'config.yaml');
      if (!fs.existsSync(roleCfgPath)) continue;
      try {
        let rc = fs.readFileSync(roleCfgPath, 'utf8');
        if (rc.match(/^model:/m)) {
          rc = rc.replace(/^model:\n(\s+name: .+\n)(\s+provider: .+\n)?(\s+base_url: .+\n)?(\s+default: .+\n)?/m,
            'model:\n  name: ' + newModel + '\n  provider: ' + newProvider + '\n');
        } else {
          rc = 'model:\n  name: ' + newModel + '\n  provider: ' + newProvider + '\n' + rc;
        }
        if (rc.match(/^custom_providers:/m)) {
          rc = rc.replace(/^custom_providers:\n(?:  - name: .+\n    base_url: .+\n    api_key: .+\n    model: .+\n?)*/m,
            'custom_providers:\n  - name: openai\n    base_url: ' + SERVER_URL + '/v1\n    api_key: ' + apiKeyId + '\n    model: ' + newModel + '\n');
        } else {
          rc += '\ncustom_providers:\n  - name: openai\n    base_url: ' + SERVER_URL + '/v1\n    api_key: ' + apiKeyId + '\n    model: ' + newModel + '\n';
        }
        fs.writeFileSync(roleCfgPath, rc);
      } catch (_) {}
    }
    // 自定义模型额外操作
    if (opts.custom_base_url) {
      try {
        const http = require('http');
        const postData = JSON.stringify({ base_url: opts.custom_base_url, api_key: opts.custom_api_key || '', model_name: opts.model || '' });
        const req = http.request({ hostname: 'localhost', port: 8765, path: '/api/custom-model/config', method: 'POST', headers: { 'Content-Type': 'application/json' } });
        req.write(postData);
        req.end();
      } catch (_) {}
    }
    // 强制重启 Gateway 使模型变更生效
    gateway.stopHermesGateway();
    // 兜底：杀干净所有残留 gateway 进程
    if (isWindows) {
      try { execSync('taskkill /F /IM python.exe /FI "MEMUSAGE gt 0" 2>nul', { timeout: 5000 }); } catch (_) {}
    } else {
      try { const ed = engine.getEngineDir(); execSync(`pkill -f "${ed}/python/bin/python3.11.*gateway run"`, { timeout: 5000 }); } catch (_) {}
    }
    await new Promise(r => setTimeout(r, 3000));
    await gateway.startHermesGateway();
    const ready = await gateway.waitForGateway(90000);
    return { success: ready };
  } catch (e) { return { success: false, error: e.message }; }
});
// ---- 认证（对接服务端）----
ipcMain.handle('auth:me', async (event, token) => {
  try {
    const body = await httpClient.httpGet(`${SERVER_URL}/api/auth/me`, { 'X-Hermes-Token': token });
    return JSON.parse(body);
  } catch (e) { return { user: null, error: 'auth not configured' }; }
});
ipcMain.handle('auth:send-code', async (event, phone) => {
  try {
    const body = await httpClient.httpPost(`${SERVER_URL}/api/auth/send-code`, JSON.stringify({ phone }));
    return JSON.parse(body);
  } catch (e) { return { success: false, error: 'auth not configured' }; }
});
ipcMain.handle('auth:verify-code', async (event, phone, code) => {
  try {
    const body = await httpClient.httpPost(`${SERVER_URL}/api/auth/verify-code`, JSON.stringify({ phone, code }));
    return JSON.parse(body);
  } catch (e) { return { success: false, error: 'auth not configured' }; }
});
ipcMain.handle('auth:wechat-url', async () => {
  try {
    const body = await httpClient.httpGet(`${SERVER_URL}/api/auth/wechat/login-url`);
    return JSON.parse(body);
  } catch (e) { return { url: '', error: 'auth not configured' }; }
});
ipcMain.handle('auth:logout', async (event, token) => {
  try {
    await httpClient.httpPost(`${SERVER_URL}/api/auth/logout`, JSON.stringify({}), { headers: { 'X-Hermes-Token': token } });
  } catch (_) {}
  return { success: true };
});
// ---- 渠道 ----
ipcMain.handle('channels:remove', async (event, channel, role) => {
  try {
    const cp = getConfigPath();
    if (fs.existsSync(cp)) {
      const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
      if (role) {
        // 按角色删除：只移除该角色在该平台的配置
        if (cfg[channel] && cfg[channel][role]) {
          delete cfg[channel][role];
          // 如果该平台下没有角色了，删除整个平台
          const remaining = Object.keys(cfg[channel]).filter(k => !k.startsWith('_'));
          if (remaining.length === 0) delete cfg[channel];
        }
      } else {
        // 没有指定角色，删除整个平台
        delete cfg[channel];
      }
      fs.writeFileSync(cp, JSON.stringify(cfg, null, 2));
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
// 配对审批 — 委托给 Hermes 原生命令
ipcMain.handle('channels:pairing-approve', async (event, channel, role, code) => {
  try {
    const engineDir = engine.getEngineDir();
    const result = spawnSync(HERMES_BIN, ['pairing', 'approve', code], {
      timeout: 15000,
      env: { ...process.env, HERMES_HOME: path.join(engineDir, '.hermes') },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status === 0) {
      restartGateway();
      return { ok: true };
    }
    const errMsg = result.stderr.toString().trim() || result.stdout.toString().trim() || 'pairing approve failed';
    return { ok: false, error: errMsg };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
// ---- 聊天导出 ----
ipcMain.handle('chat:export', async (event, opts) => {
  try {
    const defaultPath = path.join(app.getPath('documents'), opts.defaultName || 'chat_export.md');
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath, filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled) return { success: false, cancelled: true };
    fs.writeFileSync(result.filePath, opts.content || '', 'utf8');
    return { success: true, filePath: result.filePath };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('avatar:remove', async (event, role) => {
  try {
    const avatarPath = path.join(AVATARS_DIR, `custom-${role}.png`);
    if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
  } catch (_) {}
  return { success: true };
});
// ---- 充值 ----
ipcMain.handle('recharge:request', async (event, amount) => {
  try {
    const body = await httpClient.httpGet(`${SERVER_URL}/api/payment/url?amount=${amount}&device_id=${licenses.getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) { return { success: false, error: '充值服务暂不可用' }; }
});
ipcMain.handle('payment:create', async (event, amount) => {
  // 本机 server.py 直接调支付宝 API（不需要公网回调）
  var url = 'http://localhost:8765/api/payment/url?amount=' + amount + '&device_id=' + licenses.getDeviceId();
  try {
    var body = await httpClient.nodeHttpGet(url);
    return JSON.parse(body);
  } catch (e) {
    logger.reportCriticalError("payment", e, { action: "create" });
    return { success: false, error: "创建支付订单失败: " + e.message };
  }
});
ipcMain.handle('payment:check', async (event, orderId) => {
  try {
    // 本机 server.py 查询支付宝订单状态（主动查，不等回调）
    var body = await httpClient.nodeHttpGet('http://localhost:8765/api/payment/status?order_id=' + orderId);
    return JSON.parse(body);
  } catch (e) {
    logger.reportCriticalError("payment", e, { action: "check", orderId });
    return { paid: false, error: e.message };
  }
});
ipcMain.handle("payment:dev-pay", async (event, { orderId, deviceId, amount }) => {
  try {
    var realDeviceId = licenses.getDeviceId();
    var res = await httpClient.nodeHttpPost("http://localhost:8765/api/payment/dev-pay?order_id=" + orderId + "&device_id=" + realDeviceId + "&amount=" + amount, "{}");
    return JSON.parse(res);
  } catch (e) {
    logger.reportCriticalError("payment", e, { action: "dev-pay", orderId });
    return { success: false, error: "DEV充值失败: " + e.message };
  }
});
// ---- 用量明细 ----
ipcMain.handle('usage:history', async (event, limit) => {
  try {
    const body = await httpClient.httpGet(`${SERVER_URL}/api/usage/history?limit=${limit || 20}&device_id=${licenses.getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) { return { records: [] }; }
});
app.whenReady().then(() => {
  logger.startup('app.whenReady fired, starting services...');
  // 自定义协议：avatar:// — 从 Resources/avatars/ 加载头像（锁死在 App 目录）
  protocol.handle('avatar', (request) => {
    const fileName = request.url.replace('avatar://', '');
    const filePath = path.join(AVATARS_DIR, fileName);
    return net.fetch(`file://${filePath}`);
  });
  logger.startup('calling startCreditsServer...');
  creditsSrv.startCreditsServer(app);
  logger.startup('calling createWindow...');
  win.createWindow(isWindows, path.join(__dirname, "preload.js"));
  logger.startup('window created, calling startHermesGateway...');
  gateway.startHermesGateway().then(ok => {
    logger.startup('startHermesGateway result: ' + (ok ? 'OK' : 'FAILED'));
    console.log('[gateway] startup:', ok ? 'OK' : 'FAILED');
    if (ok) gateway.startHealthMonitor();
  });
  // 匿名日活心跳（不收集个人信息，仅用于统计活跃设备数）
  function _telemetryPing() {
    try {
      const body = JSON.stringify({ device: licenses.getDeviceId().slice(0, 16), version: CURRENT_VERSION, platform: process.platform });
      const u = new URL('https://api.hergent.cn/api/telemetry/ping');
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({ hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', timeout: 5000,
        rejectUnauthorized: _tlsReject,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); });
      req.on('error', () => {});  // 静默失败，不影响用户体验
      req.write(body); req.end();
    } catch (_) {}
  }
  _telemetryPing();
  setInterval(_telemetryPing, 30 * 60 * 1000); // 每 30 分钟
  // 确保成果目录存在
  const reportsDir = path.join(app.getPath('documents'), 'Hergent', '成果');
  for (const sub of ['业务报表', '我的创作', '我的工具']) {
    const d = path.join(reportsDir, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  // 更新检查 — 必须在 app.whenReady() 后初始化（electron-updater 依赖 app 模块）
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (msg) => { try { fs.appendFileSync(path.join(homeDir, '.hermes', 'updater.log'), `[INFO] ${msg}\n`); } catch(_) {} },
    warn: (msg) => { try { fs.appendFileSync(path.join(homeDir, '.hermes', 'updater.log'), `[WARN] ${msg}\n`); } catch(_) {} },
    error: (msg) => { try { fs.appendFileSync(path.join(homeDir, '.hermes', 'updater.log'), `[ERROR] ${msg}\n`); } catch(_) {} },
  };
  autoUpdater.on('checking-for-update', () => {
    try { win.getMainWindow()?.webContents?.send('update:status', { event: 'checking' }); } catch(_) {}
  });
  autoUpdater.on('update-available', (info) => {
    try { win.getMainWindow()?.webContents?.send('update:status', { event: 'available', version: info.version }); } catch(_) {}
    // 桌面通知：新版本可用
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        new Notification({ title: 'Hergent 新版本', body: 'v' + (info.version || '?') + ' 可用，点击底部横幅更新' }).show();
      }
    } catch(_) {}
  });
  autoUpdater.on('update-not-available', () => {
    try { win.getMainWindow()?.webContents?.send('update:status', { event: 'not-available' }); } catch(_) {}
  });
  autoUpdater.on('download-progress', (progress) => {
    try { win.getMainWindow()?.webContents?.send('update:status', { event: 'progress', percent: Math.round(progress.percent) }); } catch(_) {}
  });
  autoUpdater.on('update-downloaded', (info) => {
    try { win.getMainWindow()?.webContents?.send('update:status', { event: 'downloaded', version: info.version }); } catch(_) {}
    // 桌面通知：下载完成
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        new Notification({ title: 'Hergent 更新就绪', body: 'v' + (info.version || '') + ' 已下载，即将重启安装' }).show();
      }
    } catch(_) {}
  });
  autoUpdater.on('error', (err) => {
    try { win.getMainWindow()?.webContents?.send('update:status', { event: 'error', message: err.message }); } catch(_) {}
  });
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { updateAvailable: false, currentVersion: CURRENT_VERSION, reason: 'dev-mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo && result.updateInfo.version !== CURRENT_VERSION) {
        return { updateAvailable: true, version: result.updateInfo.version, currentVersion: CURRENT_VERSION, releaseNotes: result.updateInfo.releaseNotes };
      }
    } catch (_) {}
    return { updateAvailable: false, currentVersion: CURRENT_VERSION };
  });
  ipcMain.handle('update:install', async () => {
    if (!app.isPackaged) {
      return { success: false, error: 'dev mode not supported' };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('update:quit-and-install', async () => {
    if (!app.isPackaged) return { success: false, error: 'dev mode' };
    try {
      // 先停掉 Gateway 和服务，确保干净退出
      gateway.stopHermesGateway();
      creditsSrv.stopCreditsServer();
      // macOS 需要 isSilent=false 才能正常触发重启
      const isSilent = process.platform !== 'darwin';
      autoUpdater.quitAndInstall(true, isSilent);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  // 启动 15 秒后自动检查更新（窗口+网关初始化完成后）
  setTimeout(() => {
    if (app.isPackaged) {
      try { autoUpdater.checkForUpdates(); } catch (_) {}
    }
  }, 15000);
  // frameless 窗口在 macOS 上必须手动配 Edit 菜单，否则 Cmd+C/V/A 不生效
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' }
      ]
    }]));
  } else {
    // Windows: 隐藏默认菜单栏（File/Edit/View/Window/Help）
    Menu.setApplicationMenu(null);
  }
});
ipcMain.handle('app:version', () => CURRENT_VERSION);
app.on("window-all-closed", () => { gateway.stopHealthMonitor(); creditsSrv.stopCreditsServer(); gateway.stopHermesGateway(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) win.createWindow(isWindows, path.join(__dirname, "preload.js")); });
