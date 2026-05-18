const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net } = require('electron');
const path = require('path');
const { execSync, exec, spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const PROFILE = 'hermes-desktop';
const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
const VERSION_URL = 'https://your-domain.com/version.json';
const CURRENT_VERSION = '1.0.0';
// getConfigPath() is lazy — app.getPath() must be called after app.whenReady()
function getConfigPath() { return path.join(app.getPath('userData'), 'channels.json'); }

// ===== Hermes Gateway 管理 =====
const GATEWAY_PORT = 18765;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
let gatewayProcess = null;

function isGatewayRunning() {
  return new Promise((resolve) => {
    const req = net.request({ method: 'GET', url: `${GATEWAY_URL}/health` });
    req.setHeader('User-Agent', 'Hergent-Desktop/1.0');
    req.on('response', (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function waitForGateway(maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isGatewayRunning()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function startHermesGateway() {
  const gf = path.join(homeDir, '.hermes', 'app_debug.log');
  const glog = (msg) => { try { fs.appendFileSync(gf, `[${new Date().toISOString()}] GW: ${msg}\n`); } catch(_) {} };

  glog(`startHermesGateway called, HERMES_BIN=${HERMES_BIN}, isWindows=${isWindows}`);
  if (!fs.existsSync(HERMES_BIN)) {
    glog('HERMES_BIN not found');
    return false;
  }

  if (await isGatewayRunning()) {
    glog('Already running');
    return true;
  }

  // 确保独立配置存在（Gateway 用）
  const hergentConfigPath = path.join(homeDir, '.hermes', 'hergent-config.yaml');
  glog(`config path: ${hergentConfigPath}`);
  if (!fs.existsSync(hergentConfigPath)) {
    glog('writing fresh hergent config');
    fs.writeFileSync(hergentConfigPath, [
      'model:',
      '  default: deepseek-chat',
      '  provider: hergent',
      'platforms:',
      '  api_server:',
      '    enabled: true',
      '    port: 18765',
      'gateway:',
      '  port: 0',
      'api_server:',
      '  enabled: true',
      '  port: 18765',
      'custom_providers:',
      '  - name: hergent',
      `    base_url: ${SERVER_URL}/v1`,
      '    key: hergent-desktop',
      ''
    ].join('\n'));
  }

  // 预写有效的主 config.yaml，防止 Hermes 自动配置写坏格式
  const mainConfigPath = path.join(homeDir, '.hermes', 'config.yaml');
  if (!fs.existsSync(mainConfigPath)) {
    glog('writing fresh main config.yaml');
    fs.mkdirSync(path.dirname(mainConfigPath), { recursive: true });
    fs.writeFileSync(mainConfigPath, [
      'model:',
      '  default: deepseek-chat',
      '  provider: hergent',
      'platforms:',
      '  api_server:',
      '    enabled: true',
      '    port: 18765',
      'gateway:',
      '  port: 0',
      'api_server:',
      '  enabled: true',
      '  port: 18765',
      'custom_providers:',
      '  - name: hergent',
      `    base_url: ${SERVER_URL}/v1`,
      '    key: hergent-desktop',
      ''
    ].join('\n'));
  }

  // Windows: spawn 直接调 hermes.exe（不用 cmd.exe 管道，避免中文路径问题）
  // stderr 用 Node.js pipe 写入文件
  if (isWindows) {
    const gatewayLogFile = path.join(homeDir, '.hermes', 'gateway_stderr.log');
    glog(`Windows: spawning: ${HERMES_BIN} gateway run`);
    try {
      gatewayProcess = spawn(HERMES_BIN, ['gateway', 'run'], {
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, HERMES_CONFIG_PATH: hergentConfigPath },
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      });
      // Pipe stderr to log file
      const stderrStream = fs.createWriteStream(gatewayLogFile, { flags: 'a' });
      gatewayProcess.stderr.pipe(stderrStream);
      gatewayProcess.unref();
      gatewayProcess.on('error', (err) => { glog('SPAWN ERROR: ' + err.message); });
      gatewayProcess.on('exit', (code, sig) => {
        glog(`process exited code=${code} sig=${sig}`);
        // Read stderr log and append to debug log
        try {
          stderrStream.end();
          setTimeout(() => {
            try {
              if (fs.existsSync(gatewayLogFile)) {
                const stderrContent = fs.readFileSync(gatewayLogFile, 'utf8').trim().slice(0, 2000);
                if (stderrContent) glog(`STDERR: ${stderrContent}`);
              }
            } catch(_) {}
          }, 500);
        } catch(_) {}
      });
    } catch(e) {
      glog('spawn exception: ' + e.message);
      return false;
    }
  } else {
    // macOS/Linux: 使用 venv Python 直接启动
    const pythonBin = path.join(path.dirname(HERMES_BIN), 'python3');
    glog(`macOS/Linux: python path: ${pythonBin}, exists: ${fs.existsSync(pythonBin)}`);
    if (fs.existsSync(pythonBin)) {
      glog(`spawning via Python: ${pythonBin} -m hermes gateway run`);
      try {
        gatewayProcess = spawn(pythonBin, ['-m', 'hermes', 'gateway', 'run'], {
          env: { ...process.env, HOME: homeDir, HERMES_CONFIG_PATH: hergentConfigPath },
          stdio: 'ignore',
          detached: true
        });
        gatewayProcess.unref();
        gatewayProcess.on('error', (err) => { glog('SPAWN ERROR: ' + err.message); });
        gatewayProcess.on('exit', (code, sig) => { glog(`process exited code=${code} sig=${sig}`); });
      } catch(e) {
        glog('spawn exception: ' + e.message);
        return false;
      }
    } else {
      glog(`Fallback spawning: ${HERMES_BIN} gateway run`);
      try {
        gatewayProcess = spawn(HERMES_BIN, ['gateway', 'run'], {
          env: { ...process.env, HOME: homeDir, HERMES_CONFIG_PATH: hergentConfigPath },
          stdio: 'ignore',
          detached: true
        });
        gatewayProcess.unref();
        gatewayProcess.on('error', (err) => { glog('SPAWN ERROR: ' + err.message); });
        gatewayProcess.on('exit', (code, sig) => { glog(`process exited code=${code} sig=${sig}`); });
      } catch(e) {
        glog('spawn exception: ' + e.message);
        return false;
      }
    }
  }

  glog('waiting for health check...');
  const ready = await waitForGateway();
  glog('health check result: ' + ready);
  if (ready) {
    glog('Gateway ready on ' + GATEWAY_URL);
    return true;
  }
  glog('Gateway failed to start within timeout');
  return false;
}

function stopHermesGateway() {
  if (gatewayProcess) {
    gatewayProcess.kill();
    gatewayProcess = null;
  }
}

// 网关 ready 后通过 IPC 通知渲染进程
ipcMain.handle('gateway:status', async () => {
  const running = await isGatewayRunning();
  return { running, url: running ? GATEWAY_URL : null };
});
let serverProcess = null;
const SERVER_SCRIPT = path.join(__dirname, '..', '..', '..', 'server', 'server.py');

function startCreditsServer() {
  // 优先从同目录找 server.py，否则从开发路径找
  const candidates = [
    path.join(__dirname, '..', 'server.py'),       // .app/Contents/Resources/server.py
    path.join(app.getPath('home'), 'Documents', 'laozhangai-product', 'server', 'server.py'),
  ];
  let scriptPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { scriptPath = c; break; }
  }
  if (!scriptPath) {
    console.log('[credits-server] server.py not found, skipping');
    return;
  }

  // 优先用 .app 内置 venv（一键安装零依赖）
  const bundledVenv = process.platform === 'darwin'
    ? path.join(__dirname, 'python', 'venv', 'bin', 'python3')
    : null;
  const hermesVenv = process.platform === 'darwin'
    ? path.join(app.getPath('home'), '.hermes', 'hermes-agent', 'venv', 'bin', 'python3')
    : null;
  let pythonPath = 'python3';
  if (bundledVenv && fs.existsSync(bundledVenv)) {
    pythonPath = bundledVenv;
  } else if (hermesVenv && fs.existsSync(hermesVenv)) {
    pythonPath = hermesVenv;
  }
  console.log(`[credits-server] Python: ${pythonPath}`);

  // 从 auth.json 读取 DeepSeek API Key
  let deepseekKey = '';
  try {
    const authPath = path.join(app.getPath('home'), '.hermes', 'auth.json');
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const pool = authData.credential_pool || {};
    const keys = pool.deepseek || [];
    if (keys.length > 0) deepseekKey = keys[0].access_token || '';
  } catch (e) { /* ignore */ }

  console.log(`[credits-server] Starting: ${pythonPath} ${scriptPath}`);
  serverProcess = spawn(pythonPath, [scriptPath], {
    env: { ...process.env, PYTHONUNBUFFERED: '1', DEEPSEEK_API_KEY: deepseekKey }
  });
  serverProcess.on('error', (err) => {
    console.error(`[credits-server] spawn error: ${err.message}`);
  });

  serverProcess.stdout?.on('data', d => console.log(`[credits-server] ${d.toString().trim()}`));
  serverProcess.stderr?.on('data', d => console.error(`[credits-server] ${d.toString().trim()}`));
}

function stopCreditsServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    console.log('[credits-server] stopped');
  }
}
const ACTIVATION_KEY = 'hermes-fmcg-activation-2026'; // HMAC 签名密钥（生成/校验共用）
const TRIAL_DAYS = 7;  // 免费试用天数
const LICENSE_DAYS = 365;  // 激活后有效期
const SERVER_URL = 'http://47.113.224.140';  // 备案完成后改为 https://api.hergent.cn
let SYSTEM_PROMPT = '';
try {
  SYSTEM_PROMPT = fs.readFileSync(path.join(homeDir, '.hermes', 'SOUL.md'), 'utf8').trim();
} catch (e) { /* 文件不存在时用内置精简版 */ }
if (!SYSTEM_PROMPT) {
  SYSTEM_PROMPT = '你是 Hermes AI，一个靠谱的AI助手。说人话、结论先行、不啰嗦。';
}

// Hermes CLI 路径检测
const isWindows = process.platform === 'win32';
const HERMES_CMD = isWindows ? 'hermes.exe' : 'hermes';
let HERMES_BIN = HERMES_CMD;

// ===== 引擎自解压（首次启动自动展开 hermes.tar.gz）=====
function getEngineDir() {
  return path.join(app.getPath('userData'), 'hermes-engine');
}

function extractBundledEngine() {
  const engineDir = getEngineDir();
  const versionFile = path.join(engineDir, '.extracted-version');
  const tarballPath = path.join(__dirname, '..', 'hermes.tar.gz');
  if (!fs.existsSync(tarballPath)) return false;

  const currentVersion = CURRENT_VERSION + '|' + (fs.statSync(tarballPath).size || 0);
  try {
    if (fs.existsSync(versionFile)) {
      const extracted = fs.readFileSync(versionFile, 'utf8').trim();
      if (extracted === currentVersion) return true;
    }
  } catch (_) {}

  try {
    if (!fs.existsSync(engineDir)) fs.mkdirSync(engineDir, { recursive: true });
    const cmd = isWindows
      ? `tar xzf "${tarballPath}" -C "${engineDir}"`
      : `tar xzf "${tarballPath}" -C "${engineDir}"`;
    execSync(cmd, { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.writeFileSync(versionFile, currentVersion);
    console.log('[engine] Extracted to', engineDir);
    return true;
  } catch (e) {
    console.error('[engine] Extraction failed:', e.message);
    return false;
  }
}

function resolveHermesPath() {
  // 1. 优先用 App 自带的引擎（首次启动自动解压）
  if (extractBundledEngine()) {
    const engineDir = getEngineDir();
    const bundled = path.join(engineDir, isWindows ? 'hermes.exe' : 'run.sh');
    if (fs.existsSync(bundled)) return bundled;
  }

  // 2. 检查 pip 安装位置（兼容旧版）
  const venvBase = path.join(homeDir, '.hermes', 'hermes-agent', isWindows ? path.join('venv', 'Scripts', HERMES_CMD) : path.join('venv', 'bin', HERMES_CMD));
  if (fs.existsSync(venvBase)) return venvBase;

  // 3. PATH 中查找
  try {
    const whichCmd = isWindows ? `where ${HERMES_CMD}` : `which ${HERMES_CMD}`;
    const result = execSync(whichCmd, { timeout: 5000 }).toString().trim();
    const lines = result.split('\n');
    if (lines[0] && fs.existsSync(lines[0])) return lines[0];
  } catch (_) {}

  return null;
}

const resolvedPath = resolveHermesPath();
if (resolvedPath) HERMES_BIN = resolvedPath;

function getLicensePath() {
  return path.join(app.getPath('userData'), 'license.json');
}

function loadLicense() {
  try {
    const p = getLicensePath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {}
  return null;
}

function saveLicense(data) {
  fs.writeFileSync(getLicensePath(), JSON.stringify(data, null, 2));
}

// 首次运行：记录 firstRunDate；已激活：不覆盖
function ensureLicenseInit() {
  const lic = loadLicense();
  if (!lic) {
    // 全新安装 — 记录首次运行时间，开始7天试用
    const now = new Date().toISOString();
    saveLicense({ firstRunDate: now, activated: false, credits: 0, activationCode: null, activateDate: null, expireDate: null });
    return { firstRunDate: now, activated: false, credits: 0 };
  }
  if (!lic.firstRunDate) {
    lic.firstRunDate = new Date().toISOString();
    saveLicense(lic);
  }
  return lic;
}

// 生成激活码（Hermes 在用户支付后调用）
function generateActivationCode(deviceId) {
  const payload = `${deviceId}|${ACTIVATION_KEY}`;
  const hmac = crypto.createHmac('sha256', ACTIVATION_KEY).update(payload).digest('hex');
  return 'HERMES-' + hmac.slice(0, 16).toUpperCase();
}

// 校验激活码
function verifyActivationCode(code, deviceId) {
  if (!code || !code.startsWith('HERMES-')) return false;
  const expected = generateActivationCode(deviceId);
  return code.toUpperCase() === expected;
}

// 获取设备ID（基于机器唯一标识，首次生成后保存）
function getDeviceId() {
  const lic = loadLicense();
  if (lic && lic.deviceId) return lic.deviceId;
  // 首次：基于 userData 路径 + 随机数生成唯一 ID
  const raw = app.getPath('userData') + '|' + crypto.randomBytes(8).toString('hex');
  const id = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
  if (lic) { lic.deviceId = id; saveLicense(lic); }
  else saveLicense({ firstRunDate: new Date().toISOString(), activated: false, credits: 0, deviceId: id });
  return id;
}

// 获取试用/激活状态
function getLicenseStatus() {
  const lic = ensureLicenseInit();
  const now = new Date();

  if (lic.activated && lic.expireDate) {
    const expire = new Date(lic.expireDate);
    const remaining = Math.ceil((expire - now) / (1000 * 60 * 60 * 24));
    if (remaining <= 0) {
      // 激活已过期
      lic.activated = false;
      saveLicense(lic);
      return { status: 'expired', trialDays: 0, remainingDays: 0, credits: 0, message: '激活已过期，请续费' };
    }
    return { status: 'activated', trialDays: TRIAL_DAYS, remainingDays: remaining, credits: lic.credits || 0, message: `已激活，剩余 ${remaining} 天` };
  }

  // 未激活 — 检查试用期
  const firstRun = new Date(lic.firstRunDate);
  const usedDays = Math.ceil((now - firstRun) / (1000 * 60 * 60 * 24));
  const remaining = Math.max(0, TRIAL_DAYS - usedDays);

  if (remaining <= 0) {
    return { status: 'trial_expired', trialDays: TRIAL_DAYS, remainingDays: 0, credits: lic.credits || 0, usedDays, message: `7天试用已到期，请激活继续使用` };
  }

  return { status: 'trial', trialDays: TRIAL_DAYS, remainingDays: remaining, usedDays, credits: lic.credits || 0, usedDays, message: `试用第 ${usedDays} 天，剩余 ${remaining} 天` };
}


let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    resizable: true,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, 'icon.png'),
  });

  mainWindow.loadFile('index.html');
  mainWindow.center();
}

// ===== 通道配置读写 =====
function loadChannels() {
  try {
    if (fs.existsSync(getConfigPath())) {
      return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
    }
  } catch {}
  return {};
}
function saveChannels(data) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2));
}

// ===== 网关控制 =====
async function restartGateway() {
  return new Promise((resolve) => {
    const cmd = `${HERMES_CLI} gateway restart 2>&1`;
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      if (err) {
        resolve({ success: false, output: output || err.message });
      } else {
        resolve({ success: true, output: output.trim() });
      }
    });
  });
}

// ===== Hermes CLI 帮助函数 =====
const HERMES_CLI = HERMES_BIN;

function hermesCLI(args, timeout = 30000) {
  const cmd = `${HERMES_CLI} ${args}`;
  const result = execSync(cmd, { timeout, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  return result.trim();
}

// ===== HTTP 帮助函数 =====
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: url });
    request.setHeader('User-Agent', 'HermesAI-Desktop/1.0');
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9');
    request.on('response', (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    });
    request.on('error', reject);
    request.end();
  });
}
function httpPost(url, bodyStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'POST', url: url });
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('User-Agent', 'HermesAI-Desktop/1.0');
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9');
    if (opts.headers) {
      Object.entries(opts.headers).forEach(([k, v]) => request.setHeader(k, v));
    }
    request.on('response', (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    });
    request.on('error', reject);
    request.write(bodyStr);
    request.end();
  });
}

// ===== 飞书 Bot API =====
async function getFeishuToken(appId, appSecret) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ app_id: appId, app_secret: appSecret });
    const options = {
      hostname: 'open.feishu.cn',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0) resolve(json.tenant_access_token);
          else reject(new Error(`飞书API错误: ${json.code} ${json.msg}`));
        } catch { reject(new Error(`解析响应失败: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendFeishuBotMessage(token, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      receive_id: 'all',
      msg_type: 'text',
      content: JSON.stringify({ text }),
    });
    const options = {
      hostname: 'open.feishu.cn',
      path: '/open-apis/im/v1/messages?receive_id_type=open_id',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0) resolve(json);
          else reject(new Error(`发送消息失败: ${json.code} ${json.msg}`));
        } catch { reject(new Error(`解析响应失败: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== 企微 Bot API =====
async function getWecomToken(corpId, corpSecret) {
  return new Promise((resolve, reject) => {
    https.get(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`,
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.errcode === 0) resolve(json.access_token);
            else reject(new Error(`企微API错误: ${json.errcode} ${json.errmsg}`));
          } catch { reject(new Error(`解析响应失败: ${data}`)); }
        });
      }
    ).on('error', reject);
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
      const { action, text, files: filePaths } = args || {};
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
          const creditsRes = await httpGet(`${SERVER_URL}/api/credits`);
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
          return { requestId, success: false, output: creditsMsg };
        }

        // === 优先走本地 Hermes Gateway，未就绪则重试启动 ===
        let gatewayReady = await isGatewayRunning();
        if (!gatewayReady) {
          // 尝试启动 Gateway（可能 bootstrap 才完成，app.whenReady() 时 HERMES_BIN 不存在）
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] Gateway not ready, attempting restart\\n`);
          gatewayReady = await startHermesGateway();
        }
        if (!gatewayReady) {
          // Windows: CLI 回退不可用（prompt_toolkit 需要 Win32 控制台）
          if (isWindows) {
            // Gateway 已通过 detached 方式在后台启动，等 health check 通过即可
            return { requestId, success: false, output: 'AI 引擎正在启动中，请稍后重试…（约需 10-20 秒）' };
          }
          // macOS/Linux Fallback: 直接用 hermes chat -q（不依赖 gateway）
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] Gateway still not ready, falling back to CLI\\n`);
          try { execSync(`"${HERMES_BIN}" --version`, { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch(_) {
            return { requestId, success: false, output: 'Hermes 引擎未安装，请先在设置中安装' };
          }
          try {
              const child = spawn(HERMES_BIN, ['chat', '-q', fullText, '--max-turns', '60', '--source', 'tool']);
              const cliResult = await new Promise((resolve, reject) => {
                let stdout = '', stderr = '';
                const timer = setTimeout(() => { child.kill(); reject(new Error('回复超时')); }, 600000);
                child.stdout.on('data', d => { stdout += d.toString(); });
                child.stderr.on('data', d => { stderr += d.toString(); });
                child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || 'AI 处理失败')); });
                child.on('error', e => { clearTimeout(timer); reject(e); });
              });
              const boxMatch = cliResult.stdout.match(/Hermes[^\\n]*\\n([\\s\\S]*?)\\n\\s*[╰─][─\\s]*(?:╯)?\\s*\\n/);
              let responseText = boxMatch ? boxMatch[1].split('\\n').map(l => l.trim()).filter(Boolean).join('\\n').trim() : '';
              if (!responseText) responseText = cliResult.stdout.split('\\n').filter(l => { const t = l.trim(); return t && !t.startsWith('Query:') && !t.startsWith('Initializing') && !t.startsWith('─') && !t.startsWith('session_id:') && !t.startsWith('┊') && !t.startsWith('↻') && !t.includes('╭') && !t.includes('╰') && !t.startsWith('Resume this session') && !t.startsWith('hermes --resume') && !t.startsWith('Session:') && !t.startsWith('Duration:') && !t.startsWith('Messages:') && !t.startsWith('⚠'); }).map(l => l.trim()).join('\\n').trim();
              return { requestId, success: true, output: responseText.slice(0, 8000), offline: true };
            } catch (e) {
              return { requestId, success: false, output: `执行失败：${e.message}` };
            }
        }

        try {
          const result = await new Promise((resolve, reject) => {
            const chatMessages = [
              { role: 'system', content: '你是 Hergent 数字员工，运行在用户的电脑上。你可以读写文件、执行代码、操控系统。说人话、不啰嗦。' },
              { role: 'user', content: fullText }
            ];
            const postData = JSON.stringify({ model: 'deepseek-chat', messages: chatMessages, stream: true, max_tokens: 4096 });
            const request = net.request({
              method: 'POST',
              url: `${GATEWAY_URL}/v1/chat/completions`
            });
            request.setHeader('Content-Type', 'application/json');
            request.setHeader('User-Agent', 'Hergent-Desktop/1.0');
            request.on('response', (res) => {
              if (res.statusCode !== 200) {
                let b = ''; res.on('data', c => b += c);
                res.on('end', () => reject(new Error(`Gateway ${res.statusCode}`)));
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
                      try { event.sender.send('hermes:stream', { text: d, type: 'response' }); } catch (_) {}
                    }
                  } catch (_) {}
                }
              });
              res.on('end', () => resolve({ finalLines: [fullResponse] }));
            });
            request.on('error', reject);
            request.write(postData);
            request.end();
          });
          return { requestId, success: true, output: result.finalLines.join(''), offline: true };
        } catch (e) {
          return { requestId, success: false, output: `执行失败：${e.message}` };
        }
      }
    }

  
  if (action === 'fs:list') {
    const dir = (args && args.dir) || path.join(homeDir, 'Documents');
    try {
      const names = fs.readdirSync(dir);
      return { files: names };
    } catch (e) {
      return { files: [], error: e.message };
    }
  } else if (action === 'fs:read') {
    const filePath = (args && args.path) || '';
    try {
      const content = fs.readFileSync(filePath, 'utf8');
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
const AVATARS_DIR = path.join(__dirname, '..', 'avatars');

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
    // 用 sips 裁剪为正方形并缩放到 256x256
    execSync(`sips -Z 256 --cropToHeightWidth 256 256 "${srcPath}" --out "${dstPath}" 2>/dev/null || sips -Z 256 "${srcPath}" --out "${dstPath}"`, { timeout: 5000 });
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
    const result = hermesCLI('cron list', 5000);
    // 解析格式化输出：每个任务由 hex id + [active/disabled] 开头，后面是缩进的 Key: Value 行
    const tasks = [];
    const lines = result.split('\n');
    let current = null;
    for (const line of lines) {
      const hexMatch = line.match(/^\s+([a-f0-9]{8,})\s+\[(active|disabled)\]/);
      if (hexMatch) {
        if (current) tasks.push(current);
        current = { id: hexMatch[1], status: hexMatch[2], name: '', schedule: '', nextRun: '', lastRun: '', deliver: '' };
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
    if (current) tasks.push(current);
    return tasks;
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
  // 合并 Hermes 网关真实连接状态
  const gatewayPath = path.join(homeDir, '.hermes', 'gateway_state.json');
  try {
    if (fs.existsSync(gatewayPath)) {
      const state = JSON.parse(fs.readFileSync(gatewayPath, 'utf-8'));
      if (state.platforms) {
        for (const [key, platform] of Object.entries(state.platforms)) {
          if (platform.state === 'connected') {
            if (channels[key]) {
              channels[key]._connected = true;
            } else {
              channels[key] = { _connected: true };
            }
          }
        }
      }
    }
  } catch {}
  return channels;
});

ipcMain.handle('channels:save', async (event, channel, config) => {
  // 1. 写入 Hermes config.yaml（通过 hermes config set）
  try {
    for (const [key, value] of Object.entries(config)) {
      if (!value) continue;
      const escaped = value.replaceAll('"', '\\"');
      hermesCLI(`config set ${channel}.${key} "${escaped}"`, 5000);
    }
    // 确保启用该通道
    hermesCLI(`config set ${channel}.enabled true`, 5000);
  } catch (e) {
    console.error('hermes config set failed:', e.message);
  }

  // 2. 保存到 channels.json
  const data = loadChannels();
  data[channel] = config;
  saveChannels(data);

  // 3. 重启网关使新配置生效
  let gatewayResult = { success: false, output: '' };
  try {
    gatewayResult = await restartGateway();
  } catch (e) {
    gatewayResult = { success: false, output: e.message };
  }

  // 4. 等2秒让网关初始化，再查连接状态
  let connectStatus = null;
  if (gatewayResult.success) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const gatewayPath = path.join(homeDir, '.hermes', 'gateway_state.json');
      if (fs.existsSync(gatewayPath)) {
        const state = JSON.parse(fs.readFileSync(gatewayPath, 'utf-8'));
        const platform = state.platforms && state.platforms[channel];
        if (platform && platform.state === 'connected') {
          connectStatus = 'connected';
        }
      }
    } catch {}
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
  const gatewayPath = path.join(homeDir, '.hermes', 'gateway_state.json');

  try {
    // 1. 检查网关状态文件是否存在
    if (!fs.existsSync(gatewayPath)) {
      // 网关可能未启动，尝试重启
      const restartResult = await restartGateway();
      if (!restartResult.success) {
        return { success: false, output: '网关未启动，请尝试点击「重启网关」按钮' };
      }
      // 等3秒让网关初始化
      await new Promise(r => setTimeout(r, 3000));
    }

    // 2. 读取网关状态
    const state = JSON.parse(fs.readFileSync(gatewayPath, 'utf-8'));
    const platform = state.platforms && state.platforms[channel];

    if (!platform) {
      return { success: false, output: `${channel} 尚未在网关中注册，请先保存配置并重启网关` };
    }

    if (platform.state === 'connected') {
      return { success: true, output: `${channel} 已连接 ✅` };
    } else if (platform.state === 'retrying') {
      return { success: false, output: `${channel} 连接中...当前状态：重试中。请检查 App ID/Secret 是否正确` };
    } else {
      return { success: false, output: `${channel} 状态: ${platform.state}${platform.error_message ? ' — ' + platform.error_message : '。请检查配置是否正确'}` };
    }
  } catch (e) {
    return { success: false, output: `读取网关状态失败: ${e.message}` };
  }
});

// ===== IPC: 网关控制 =====
ipcMain.handle('channels:gateway-status', async () => {
  try {
    const running = await isGatewayRunning();
    return { running, url: running ? GATEWAY_URL : null, message: running ? '网关运行中' : '网关未启动' };
  } catch (e) {
    return { running: false, message: `读取状态失败: ${e.message}` };
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

// ===== IPC: 更新 =====
ipcMain.handle('check:update', async () => {
  return new Promise((resolve) => {
    https.get(VERSION_URL, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          const hasUpdate = info.version !== CURRENT_VERSION;
          resolve({ hasUpdate, info, currentVersion: CURRENT_VERSION });
        } catch {
          resolve({ hasUpdate: false, error: '解析更新信息失败', currentVersion: CURRENT_VERSION });
        }
      });
    }).on('error', (err) => {
      resolve({ hasUpdate: false, error: err.message, currentVersion: CURRENT_VERSION });
    });
  });
});

ipcMain.handle('execute:update', async (event, { downloadUrl }) => {
  const tmpFile = `/tmp/dairy-pack-update.tar.gz`;
  try {
    await downloadFile(downloadUrl, tmpFile);
    const result = execSync(
      `hermes profile import ${tmpFile} --profile dairy-pack`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    fs.unlinkSync(tmpFile);
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, output: e.message };
  }
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlinkSync(dest); reject(err); });
  });
}

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
    license: getLicenseStatus(),
  };
});


// ===== IPC: 激活码 & 试用 =====
ipcMain.handle('activation:status', async () => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/credits`);
    const data = JSON.parse(body);
    return { credits: data.credits || 0 };
  } catch (e) {
    return { credits: 0, message: '无法连接服务' };
  }
});

ipcMain.handle('activation:device-id', async () => {
  return getDeviceId();
});

ipcMain.handle('activation:activate', async (event, { code }) => {
  const deviceId = getDeviceId();
  if (!verifyActivationCode(code, deviceId)) {
    return { success: false, message: '激活码无效，请核对后重试' };
  }

  const lic = loadLicense();
  const now = new Date();
  const expireDate = new Date(now.getTime() + LICENSE_DAYS * 24 * 60 * 60 * 1000);
  lic.activated = true;
  lic.activationCode = code;
  lic.activateDate = now.toISOString();
  lic.expireDate = expireDate.toISOString();
  saveLicense(lic);

  return {
    success: true,
    message: `激活成功！有效期至 ${expireDate.toLocaleDateString('zh-CN')}（${LICENSE_DAYS}天）`,
    expireDate: expireDate.toISOString(),
  };
});

// ===== IPC: 服务器端激活（调用 Hermes Server API）=====
ipcMain.handle('activation:server-activate', async (event, { code }) => {
  const deviceId = getDeviceId();
  return new Promise((resolve) => {
    const postData = JSON.stringify({ code, device_id: deviceId });
    const req = http.request({
      hostname: 'localhost', port: 8765, path: '/api/activate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success) {
            // 激活成功 → 更新本地 license
            const lic = loadLicense();
            const now = new Date();
            const expireDate = new Date(now.getTime() + LICENSE_DAYS * 24 * 60 * 60 * 1000);
            lic.activated = true;
            lic.activationCode = code;
            lic.activateDate = now.toISOString();
            lic.expireDate = expireDate.toISOString();
            lic.credits = json.credits || 0;
            saveLicense(lic);
          }
          resolve(json);
        } catch (e) {
          resolve({ success: false, message: '服务器返回异常' });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, message: '无法连接服务器，请确认服务已启动' }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, message: '服务器响应超时' }); });
    req.write(postData);
    req.end();
  });
});

// ===== IPC: 查询积分余额（调用 Hermes Server API）=====
ipcMain.handle('activation:credits', async () => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/credits`);
    return JSON.parse(body);
  } catch (e) {
    return { credits: 0, message: '无法连接服务' };
  }
});

// 打开外部链接
ipcMain.handle('shell:open', async (event, url) => {
  require('electron').shell.openExternal(url);
  return true;
});

// ===== 窗口控制 =====
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:close', () => mainWindow.close());
ipcMain.on('window:drag', (event, { deltaX, deltaY }) => {
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + deltaX, y + deltaY);
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
    execSync(`"${venvPython}" -m pip install --quiet -i https://pypi.tuna.tsinghua.edu.cn/simple hermes-agent aiohttp 2>&1 || "${venvPython}" -m pip install --quiet hermes-agent aiohttp 2>&1`,
      { timeout: 300000, windowsHide: true });
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

  // Step 5: 写配置文件（Gateway 用 + 主配置）
  send('config|配置 Hermes…');
  try {
    const hergentConfigPath = path.join(homeDir, '.hermes', 'hergent-config.yaml');
    fs.writeFileSync(hergentConfigPath, [
      'model:',
      '  default: deepseek-chat',
      '  provider: hergent',
      'platforms:',
      '  api_server:',
      '    enabled: true',
      '    port: 18765',
      'gateway:',
      '  port: 0',
      'api_server:',
      '  enabled: true',
      '  port: 18765',
      'max_turns: 60',
      'custom_providers:',
      '  - name: hergent',
      `    base_url: ${SERVER_URL}/v1`,
      '    key: hergent-desktop',
      ''
    ].join('\n'));
    // 同时写主 config.yaml，防止 Hermes 自动配置写坏格式
    const mainConfigPath = path.join(homeDir, '.hermes', 'config.yaml');
    if (!fs.existsSync(mainConfigPath)) {
      fs.writeFileSync(mainConfigPath, [
        'model:',
        '  default: deepseek-chat',
        '  provider: hergent',
        'gateway:',
        '  port: 0',
        'api_server:',
        '  enabled: true',
        '  port: 18765',
        'max_turns: 60',
        'custom_providers:',
        '  - name: hergent',
        `    base_url: ${SERVER_URL}/v1`,
        '    key: hergent-desktop',
        ''
      ].join('\n'));
    }
    log('config written: ' + hergentConfigPath);
  } catch(e) {
    log('config write warning: ' + e.message);
  }

  // Step 6: 启动 Hermes Gateway（bootstrap 前 HERMES_BIN 不存在，此时重启）
  send('gateway|启动 AI 引擎…');
  log('post-bootstrap: restarting gateway');
  startHermesGateway().then(ok => {
    log('post-bootstrap gateway: ' + (ok ? 'OK' : 'FAILED'));
  });

  send('done|准备就绪！');
  return { success: true, message: 'Hermes ready', path: HERMES_BIN };
});
ipcMain.handle('hermes:check-cli', async () => {
  const exists = fs.existsSync(HERMES_BIN);
  return { available: exists, version: exists ? 'checking...' : null };
});
ipcMain.handle('hermes:cancel', async () => {
  return { success: true };
});
ipcMain.handle('session:clear', async (event, role) => {
  return { success: true };
});
ipcMain.handle('notify:send', async (event, { title, body }) => {
  return { success: true };
});
ipcMain.handle('theme:get', async () => {
  try {
    const tp = path.join(app.getPath('userData'), 'theme.json');
    if (fs.existsSync(tp)) return JSON.parse(fs.readFileSync(tp, 'utf8'));
  } catch(_) {}
  return { isDark: nativeTheme.shouldUseDarkColors };
});
ipcMain.handle('theme:set', async (event, theme) => {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'theme.json'), JSON.stringify(theme));
  } catch(_) {}
  return { success: true };
});
ipcMain.handle('memory:list', async () => {
  return { memories: [] };
});
ipcMain.handle('memory:delete', async (event, id) => {
  return { success: true };
});
ipcMain.handle('skills:list', async () => {
  return { categories: [] };
});
ipcMain.handle('roles:list', async () => {
  const roles = loadRoles();
  return { roles };
});
ipcMain.handle('roles:save', async (event, roles) => {
  return { success: true };
});
ipcMain.handle('roles:add', async (event, roleData) => {
  return { success: true };
});
ipcMain.handle('roles:delete', async (event, roleId) => {
  return { success: true };
});
ipcMain.handle('roles:update', async (event, roleId, updates) => {
  return { success: true };
});
ipcMain.handle('server:get-url', async () => {
  return { url: SERVER_URL };
});
ipcMain.handle('server:save-url', async (event, url) => {
  return { success: true };
});
ipcMain.handle('auth:me', async (event, token) => {
  return { user: null, error: 'auth not configured' };
});
ipcMain.handle('auth:send-code', async (event, phone) => {
  return { success: false, error: 'auth not configured' };
});
ipcMain.handle('auth:verify-code', async (event, phone, code) => {
  return { success: false, error: 'auth not configured' };
});
ipcMain.handle('auth:wechat-url', async () => {
  return { url: '', error: 'auth not configured' };
});
ipcMain.handle('auth:logout', async (event, token) => {
  return { success: true };
});
ipcMain.handle('channels:remove', async (event, channel, role) => {
  return { success: true };
});
ipcMain.handle('channels:pairing-approve', async (event, channel, role, code) => {
  return { success: false, error: 'pairing not configured' };
});
ipcMain.handle('chat:export', async (event, opts) => {
  return { success: false, error: 'export not available' };
});
ipcMain.handle('avatar:remove', async (event, role) => {
  return { success: true };
});
ipcMain.handle('update:check', async () => {
  return { updateAvailable: false };
});
ipcMain.handle('update:install', async () => {
  return { success: false, error: 'auto-update not available' };
});
ipcMain.handle('update:quit-and-install', async () => {
  return { success: false };
});
ipcMain.handle('recharge:request', async (event, amount) => {
  return { success: false, error: 'recharge not available' };
});
ipcMain.handle('usage:history', async (event, limit) => {
  return { records: [] };
});
app.whenReady().then(() => {
  // 自定义协议：avatar:// — 从 Resources/avatars/ 加载头像（锁死在 App 目录）
  protocol.handle('avatar', (request) => {
    const fileName = request.url.replace('avatar://', '');
    const filePath = path.join(AVATARS_DIR, fileName);
    return net.fetch(`file://${filePath}`);
  });

  startCreditsServer();
  createWindow();
  startHermesGateway().then(ok => console.log('[gateway] startup:', ok ? 'OK' : 'FAILED'));

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
  }
});

app.on('window-all-closed', () => { stopCreditsServer(); stopHermesGateway(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
