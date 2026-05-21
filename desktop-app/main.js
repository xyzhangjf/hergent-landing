const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, nativeTheme } = require('electron');
const path = require('path');
const { execSync, exec, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const PROFILE = 'hermes-desktop';
const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
const VERSION_URL = 'https://github.com/xyzhangjf/hergent-landing/releases/download/v1.0.4/version.json';
const CURRENT_VERSION = '1.0.4';
// getConfigPath() is lazy — app.getPath() must be called after app.whenReady()
function getConfigPath() { return path.join(app.getPath('userData'), 'channels.json'); }

// ===== 集中日志系统 =====
const ERROR_HISTORY = []; // 内存中保留最近 20 条错误

function hergentLog(level, category, message) {
  if (level === 'ERROR') {
    const ts = new Date().toISOString();
    ERROR_HISTORY.unshift({ ts, category, message });
    if (ERROR_HISTORY.length > 20) ERROR_HISTORY.pop();
  }
}

// 全局异常兜底
process.on('uncaughtException', (err) => {
  hergentLog('ERROR', 'process', `uncaughtException: ${err.message}\n${err.stack || ''}`);
});
process.on('unhandledRejection', (reason) => {
  hergentLog('ERROR', 'process', `unhandledRejection: ${reason}`);
});

// ===== Hermes Gateway 管理 =====
const GATEWAY_PORT = 18765;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const GATEWAY_API_KEY = 'hergent-local-gateway-key-2026';
let gatewayProcess = null;
const ROLE_SESSIONS = {}; // roleId -> sessionId, 保持会话连续性

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
  const engineDir = getEngineDir();
  const gwHome = path.join(engineDir, '.hermes');
  const gf = path.join(gwHome, 'app_debug.log');
  const glog = (msg) => { try { fs.appendFileSync(gf, `[${new Date().toISOString()}] GW: ${msg}\n`); } catch(_) {} };

  glog(`startHermesGateway called, HERMES_BIN=${HERMES_BIN}, isWindows=${isWindows}`);
  if (!fs.existsSync(HERMES_BIN)) {
    glog('HERMES_BIN not found');
    return false;
  }

  ensureSharedState();
  ensureRoleConfigs();
  markEngineReady();

  if (await isGatewayRunning()) {
    glog('Already running');
    return true;
  }

  // 确保 Gateway 配置的 api_server.port 正确
  const mainConfigPath = path.join(gwHome, 'config.yaml');
  try {
    let configContent = '';
    if (fs.existsSync(mainConfigPath)) {
      configContent = fs.readFileSync(mainConfigPath, 'utf8');
    }
    // 检查端口是否已设置为 GATEWAY_PORT
    const portMatch = configContent.match(/^api_server:\s*\n(\s+port:\s*(\d+))?/m);
    if (!portMatch || !portMatch[2] || parseInt(portMatch[2]) !== GATEWAY_PORT) {
      glog('updating api_server.port in config');
      const lines = configContent.split('\n');
      const newLines = [];
      let inApiServer = false, portWritten = false, keyWritten = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^api_server:\s*$/.test(line)) {
          inApiServer = true;
          newLines.push('api_server:');
          newLines.push('  enabled: true');
          newLines.push(`  port: ${GATEWAY_PORT}`);
          newLines.push(`  key: ${GATEWAY_API_KEY}`);
          portWritten = true;
          keyWritten = true;
          // 跳过旧的 api_server 子项
          while (i + 1 < lines.length && /^\s+\w/.test(lines[i + 1])) i++;
          continue;
        }
        newLines.push(line);
      }
      if (!portWritten) {
        newLines.push('api_server:');
        newLines.push('  enabled: true');
        newLines.push(`  port: ${GATEWAY_PORT}`);
        newLines.push(`  key: ${GATEWAY_API_KEY}`);
      }
      fs.writeFileSync(mainConfigPath, newLines.join('\n'));
    }
  } catch(e) {
    glog('config update error: ' + e.message);
    // 兜底：直接写入完整配置
    const deviceId = getDeviceId();
    const configYaml = [
      'model:',
      '  default: deepseek-chat',
      '  provider: hergent',
      'api_server:',
      '  enabled: true',
      `  port: ${GATEWAY_PORT}`,
      `  key: ${GATEWAY_API_KEY}`,
      'custom_providers:',
      '  - name: hergent',
      `    base_url: ${SERVER_URL}/v1`,
      `    api_key: hermes_${deviceId}`,
      'memory:',
      '  memory_enabled: true',
      '  memory_char_limit: 12000',
      '  user_char_limit: 8000',
      '  flush_min_turns: 6',
      '  nudge_interval: 10',
      '',
    ].join('\n');
    fs.writeFileSync(mainConfigPath, configYaml);
  }

  // Windows: hermes.bat 需要通过 shell 启动（cmd.exe /c）
  if (isWindows) {
    const gatewayLogFile = path.join(gwHome, 'gateway_stderr.log');
    glog(`Windows: spawning: ${HERMES_BIN} gateway run`);
    try {
      gatewayProcess = spawn(HERMES_BIN, ['gateway', 'run', '--replace'], {
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, HERMES_HOME: gwHome, HERMES_CONFIG_PATH: mainConfigPath, API_SERVER_PORT: String(GATEWAY_PORT), API_SERVER_ENABLED: 'true', API_SERVER_KEY: GATEWAY_API_KEY, GATEWAY_ALLOW_ALL_USERS: 'true' },
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: true,
        windowsHide: true
      });
      const stderrStream = fs.createWriteStream(gatewayLogFile, { flags: 'a' });
      gatewayProcess.stderr.pipe(stderrStream);
      gatewayProcess.unref();
      gatewayProcess.on('error', (err) => { glog('SPAWN ERROR: ' + err.message); });
      gatewayProcess.on('exit', (code, sig) => {
        glog(`process exited code=${code} sig=${sig}`);
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
    const binDir = path.dirname(HERMES_BIN);
    const pythonCandidates = [
      path.join(binDir, 'python', 'bin', 'python3.11'),
      path.join(binDir, 'python3.11'),
      path.join(binDir, 'python3'),
    ];
    const pythonBin = pythonCandidates.find(p => fs.existsSync(p));
    glog(`macOS/Linux: python path: ${pythonBin || 'not found'}`);
    if (pythonBin) {
      glog(`spawning via Python: ${pythonBin} -m hermes_cli.main gateway run`);
      try {
        gatewayProcess = spawn(pythonBin, ['-m', 'hermes_cli.main', 'gateway', 'run', '--replace'], {
          env: { ...process.env, HOME: homeDir, HERMES_HOME: gwHome, HERMES_CONFIG_PATH: mainConfigPath, API_SERVER_PORT: String(GATEWAY_PORT), API_SERVER_ENABLED: 'true', API_SERVER_KEY: GATEWAY_API_KEY, GATEWAY_ALLOW_ALL_USERS: 'true' },
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
        gatewayProcess = spawn(HERMES_BIN, ['gateway', 'run', '--replace'], {
          env: { ...process.env, HOME: homeDir, HERMES_HOME: gwHome, HERMES_CONFIG_PATH: mainConfigPath, API_SERVER_PORT: String(GATEWAY_PORT), API_SERVER_ENABLED: 'true', API_SERVER_KEY: GATEWAY_API_KEY, GATEWAY_ALLOW_ALL_USERS: 'true' },
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
  const ready = isEngineReady();
  return { running, ready, url: running ? GATEWAY_URL : null };
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
  // 验证关键文件是否存在（防止 sentinel 存在但解压不完整的情况，如 Gatekeeper 删除了 dylib）
  const criticalFiles = isWindows
    ? [path.join(engineDir, 'python', 'python.exe')]
    : [path.join(engineDir, 'python', 'bin', 'python3.11'), path.join(engineDir, 'python', 'lib', 'libpython3.11.dylib')];
  try {
    if (fs.existsSync(versionFile) && criticalFiles.every(f => fs.existsSync(f))) {
      const extracted = fs.readFileSync(versionFile, 'utf8').trim();
      if (extracted === currentVersion) return true;
    }
  } catch (_) {}

  try {
    if (!fs.existsSync(engineDir)) fs.mkdirSync(engineDir, { recursive: true });
    // 清除 tarball 自身的隔离属性，防止提取出的文件继承 quarantine
    if (!isWindows) {
      try { spawnSync('/usr/bin/xattr', ['-cr', tarballPath], { timeout: 5000 }); } catch (_) {}
    }
    const cmd = isWindows
      ? `tar xzf "${tarballPath}" -C "${engineDir}"`
      : `tar xzf "${tarballPath}" -C "${engineDir}"`;
    execSync(cmd, { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    // 提取后立即清除所有文件的隔离属性，防止 Gatekeeper 拦截二进制/dylib
    if (!isWindows) {
      try { spawnSync('/usr/bin/xattr', ['-cr', engineDir], { timeout: 10000 }); } catch (_) {}
    }
    fs.writeFileSync(versionFile, currentVersion);
    console.log('[engine] Extracted to', engineDir);
    return true;
  } catch (e) {
    console.error('[engine] Extraction failed:', e.message);
    return false;
  }
}

// 每次启动都确保引擎配置正确（独立于解压，解决升级后 config 不更新的问题）
function ensureEngineConfig() {
  const engineDir = getEngineDir();
  const hermesHome = path.join(engineDir, '.hermes');
  const configPath = path.join(hermesHome, 'config.yaml');

  // 已配置则跳过
  if (fs.existsSync(configPath)) return;

  if (!fs.existsSync(hermesHome)) fs.mkdirSync(hermesHome, { recursive: true });

  // 直接写 YAML，避免 hermes config set 把 custom_providers 写成 dict
  const deviceId = getDeviceId();
  const configYaml = [
    'model:',
    '  default: deepseek-chat',
    '  provider: hergent',
    'api_server:',
    '  enabled: true',
    `  port: ${GATEWAY_PORT}`,
    `  key: ${GATEWAY_API_KEY}`,
    'custom_providers:',
    '  - name: hergent',
    `    base_url: ${SERVER_URL}/v1`,
    `    api_key: hermes_${deviceId}`,
    'memory:',
    '  memory_enabled: true',
    '  memory_char_limit: 12000',
    '  user_char_limit: 8000',
    '  flush_min_turns: 6',
    '  nudge_interval: 10',
    '',
  ].join('\n');
  fs.writeFileSync(configPath, configYaml);
}

// 将引擎的 memories/ 和 skills/ 链接到用户 ~/.hermes/，共享长期记忆和全部技能
function ensureSharedState() {
  const engineDir = getEngineDir();
  const hermesHome = path.join(engineDir, '.hermes');
  const userHermes = path.join(homeDir, '.hermes');

  const linkDirs = ['memories', 'skills'];
  for (const dir of linkDirs) {
    const enginePath = path.join(hermesHome, dir);
    const userPath = path.join(userHermes, dir);

    try { if (fs.lstatSync(enginePath).isSymbolicLink()) continue; } catch (_) {}

    if (!fs.existsSync(userPath)) continue;

    // skills: 先将 Hergent 独有技能合并到用户目录
    if (dir === 'skills') {
      const bundledSkills = path.join(__dirname, 'skills');
      if (fs.existsSync(bundledSkills)) {
        const entries = fs.readdirSync(bundledSkills, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const src = path.join(bundledSkills, e.name, 'SKILL.md');
          if (!fs.existsSync(src)) continue;
          const dstDir = path.join(userPath, e.name);
          const dst = path.join(dstDir, 'SKILL.md');
          try {
            if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== fs.readFileSync(src, 'utf8')) {
              if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
              fs.writeFileSync(dst, fs.readFileSync(src));
            }
          } catch (_) {}
        }
      }
    }

    try {
      if (fs.existsSync(enginePath)) {
        const bak = enginePath + '.empty';
        if (!fs.existsSync(bak)) fs.renameSync(enginePath, bak);
        else fs.rmSync(enginePath, { recursive: true, force: true });
      }
      fs.symlinkSync(userPath, enginePath);
    } catch (_) {}
  }
}

// 为每个角色创建独立的 Hermes Home（独立 workspace + skills + config + memory + persona）
function ensureRoleConfigs() {
  const engineDir = getEngineDir();
  const roles = loadRoles();
  for (const [roleId, role] of Object.entries(roles)) {
    const roleHome = path.join(engineDir, '.hermes', 'agents', roleId);
    const roleWorkspace = path.join(roleHome, 'workspace');
    const roleSkills = path.join(roleHome, 'skills');
    const roleMemories = path.join(roleHome, 'memories');
    if (!fs.existsSync(roleHome)) fs.mkdirSync(roleHome, { recursive: true });
    if (!fs.existsSync(roleWorkspace)) fs.mkdirSync(roleWorkspace, { recursive: true });
    if (!fs.existsSync(roleSkills)) fs.mkdirSync(roleSkills, { recursive: true });
    if (!fs.existsSync(roleMemories)) fs.mkdirSync(roleMemories, { recursive: true });

    // 写入角色专属 SOUL.md (persona 文件)
    const soulPath = path.join(roleHome, 'SOUL.md');
    const soulContent = [
      '# ' + (role.name || roleId),
      '',
      (role.systemPrompt || '你是 Hergent 数字员工。'),
      '',
      '## 核心能力',
      '',
      role.opening || '高效、靠谱、考虑周全。',
      '',
      '## 行为准则',
      '',
      '- 说人话、结论先行、不啰嗦',
      '- 主动帮用户省时间',
      '- 不确定的事先核实再说',
      '- 如果有更简单的方法，主动提出来',
      ''
    ].join('\n');
    try {
      const existingSoul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : '';
      if (existingSoul !== soulContent) fs.writeFileSync(soulPath, soulContent);
    } catch (_) {}

    // 写入角色专属 config.yaml — 直接写 YAML 避免 custom_providers 变 dict
    const roleConfigPath = path.join(roleHome, 'config.yaml');
    if (!fs.existsSync(roleConfigPath)) {
      try {
        const roleConfigYaml = [
          'model:',
          '  default: deepseek-chat',
          '  provider: hergent',
          'custom_providers:',
          '  - name: hergent',
          `    base_url: ${SERVER_URL}/v1`,
          `    api_key: hermes_${getDeviceId()}`,
          `system_prompt_file: ${soulPath}`,
          `system_prompt: "${(role.systemPrompt || '').replace(/"/g, '\\"')}"`,
          'memory:',
          '  memory_enabled: true',
          `  memory_dir: ${roleMemories}`,
          'session:',
          `  sessions_dir: ${path.join(roleHome, 'sessions')}`,
          'terminal:',
          `  cwd: ${roleWorkspace}`,
          '',
        ].join('\n');
        fs.writeFileSync(roleConfigPath, roleConfigYaml);
      } catch (_) {}
    }
  }
}

// 写标记文件，表示引擎完全就绪（配置 + skills + 角色全部到位）
function markEngineReady() {
  const engineDir = getEngineDir();
  fs.writeFileSync(path.join(engineDir, '.hermes', '.hermes-ready'), new Date().toISOString());
}

function isEngineReady() {
  return fs.existsSync(path.join(getEngineDir(), '.hermes', '.hermes-ready'));
}

// 确保技能就位 — skills/ 已通过 ensureSharedState 链接到 ~/.hermes/skills/
function ensureBuiltinSkills() {
  ensureSharedState();
}

function resolveHermesPath() {
  // 1. 优先用 App 自带的引擎（首次启动自动解压）
  if (extractBundledEngine()) {
    const engineDir = getEngineDir();
    // 清除引擎二进制的隔离属性（递归清理 python/ 目录，包含 dylib 等）避免 Gatekeeper 拦截
    if (!isWindows) {
      ['python', 'run.sh', 'hermes'].forEach(p => {
        const full = path.join(engineDir, p);
        if (fs.existsSync(full)) {
          const r = spawnSync('/usr/bin/xattr', ['-cr', full], { timeout: 10000 });
          if (r.status !== 0) console.log('[engine] xattr failed for', p, 'status', r.status);
        }
      });
    }
    const bundled = path.join(engineDir, isWindows ? 'hermes.bat' : 'run.sh');
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

// ===== 角色持久化 =====
function getRolesPath() { return path.join(app.getPath('userData'), 'roles.json'); }

const DEFAULT_ROLES = {
  dami: { name: '我的大秘', systemPrompt: '你扮演"大秘"角色。你是用户的得力助手，擅长：写文档（合同/邮件/方案）、搜资料、设提醒、处理文件。风格：高效、靠谱、考虑周全。用户说什么你就帮忙做什么，主动帮用户省时间。', opening: '我是你的大秘，文书、搜索、提醒都归我。\n\n**我能做什么**\n写合同、回邮件、做方案、搜资料、设提醒——你不想动手的都交给我。\n\n**数据怎么来**\n- 直接告诉我需求，网上能查到的我帮你查\n- 也可以发文件给我，我帮你整理提炼\n\n试试说一句：\n- 「帮我写一份供货合同」\n- 「搜一下最近AI行业的新动态」', builtIn: true },
  accountant: { name: '我的会计', systemPrompt: '你扮演"会计"角色。你擅长财务数据分析：对账、做表、算税、分析收支、处理Excel。风格：严谨、数字敏感、细致。看到数据先核实，发现问题主动指出。每笔账都要算清楚。', opening: '我是你的会计，财务上的事交给我。\n\n**我能做什么**\n对账、做表、算税、分析收支——跟钱有关的我都管。\n\n**数据怎么来**\n- 把银行流水、发票、账单文件发给我\n- 或者直接告诉我需求，我帮你整理\n\n试试发一句：\n- 「帮我对一下这个月的收支」\n- 「把这个Excel表做成利润分析」', builtIn: true },
  programmer: { name: '我的程序员', systemPrompt: '你扮演"程序员"角色。你擅长写代码：Python脚本、网页应用、自动化工具、bug修复。风格：逻辑清晰、直奔主题。直接给出可运行的代码，说明用法，不用解释基础概念除非用户问。', opening: '我是你的程序员，写代码做应用。\n\n**我能做什么**\n写脚本、做App、改bug、搭网站——技术活你说需求我来实现。\n\n**数据怎么来**\n- 说清楚要做什么，我直接从零开始写\n- 也可以发代码文件给我改\n\n试试说一句：\n- 「帮我写个批量重命名文件的脚本」\n- 「我想做个简单的记账App」', builtIn: true },
  writer: { name: '我的作家', systemPrompt: '你扮演"作家"角色。你擅长写长文：小说、传记、公众号文章、经验总结。风格：有文采但不矫情，有深度但好读。帮用户搭框架、理思路、出章节，文字要有感染力。', opening: '我是你的作家，帮你写东西。\n\n**我能做什么**\n小说、传记、公众号文章、经验总结——你说方向给素材，我帮你写出来。\n\n**数据怎么来**\n- 跟我聊想法，我帮你搭框架、写章节\n- 也可以发素材、提纲、录音给我\n\n试试说一句：\n- 「我想把我的行业经验整理成一本电子书」\n- 「帮我写个小说开头，主角是个年轻的创业者」', builtIn: true },
  screenwriter: { name: '我的编剧', systemPrompt: '你扮演"编剧"角色。你擅长短内容创作：短视频脚本、广告文案、品牌故事、演讲稿。风格：抓眼球、有节奏感、懂平台调性。先问平台和时长，再给创意，文案要能直接用。', opening: '我是你的编剧，内容创作我来。\n\n**我能做什么**\n短视频脚本、广告文案、品牌故事、演讲稿——什么类型都行。\n\n**数据怎么来**\n- 告诉我平台和风格，我直接写\n- 也可以发参考案例给我模仿\n\n试试说一句：\n- 「帮我写个15秒的短视频带货脚本」\n- 「帮我写个品牌故事，温情路线的」', builtIn: true },
  tutor: { name: '我的私教', systemPrompt: '你扮演"私教"角色。你擅长教学：把复杂知识讲简单，用类比和例子帮助理解。风格：耐心、循序渐进、鼓励式。先判断用户水平，再讲核心概念，最后举例。用户懂了才往下走。', opening: '我是你的私教，想学什么直接问。\n\n**我能做什么**\n编程、数学、考试辅导——不懂就问，我讲到你懂为止。\n\n**数据怎么来**\n- 直接发题目或知识点，我讲给你听\n- 也可以发教材截图或笔记\n\n试试问一句：\n- 「Python爬虫怎么学」\n- 「帮我讲一下概率论的基础概念」', builtIn: true },
  health: { name: '我的健康顾问', systemPrompt: '你扮演"健康顾问"角色。你擅长健康管理：饮食搭配、运动计划、睡眠改善、体检报告解读。风格：科学但不吓人，建议具体可执行。提醒用户"我不是医生，严重问题要看医生"但不啰嗦。', opening: '我是你的健康顾问，身体的事问我。\n\n**我能做什么**\n饮食搭配、运动计划、睡眠改善、体检指标解读——帮你把健康管起来。\n\n**数据怎么来**\n- 告诉我你的情况，我帮你分析建议\n- 也可以发体检报告给我看\n\n试试问一句：\n- 「久坐上班怎么安排饮食和运动」\n- 「帮我看一下这份体检报告」', builtIn: true },
  investor: { name: '我的投资顾问', systemPrompt: '你扮演"投资顾问"角色。你擅长理财分析：市场行情、资产配置、风险评估。风格：中立客观、数据说话。不推荐具体股票，不承诺收益，帮用户理解风险和机会。开头声明不构成投资建议。', opening: '我是你的投资顾问，钱的事帮你理清楚。\n\n**我能做什么**\n市场分析、资产配置、风险评估——不推荐具体股票，但帮你做决策参考。\n\n**数据怎么来**\n- 告诉我你想了解的方向和预算\n- 也可以发财报、研报给我分析\n\n试试问一句：\n- 「我有10万闲钱，低风险的怎么配」\n- 「帮我分析一下最近的市场行情」', builtIn: true }
};
const resolvedPath = resolveHermesPath();
if (resolvedPath) HERMES_BIN = resolvedPath;

if (HERMES_BIN) {
  ensureEngineConfig();
  ensureBuiltinSkills();
  ensureRoleConfigs();
  markEngineReady();
}

function loadRoles() {
  try {
    const rp = getRolesPath();
    if (fs.existsSync(rp)) {
      const data = JSON.parse(fs.readFileSync(rp, 'utf8'));
      if (typeof data === 'object' && !Array.isArray(data)) return data;
    }
  } catch (_) {}
  return { ...DEFAULT_ROLES };
}

function saveRoles(roles) {
  fs.writeFileSync(getRolesPath(), JSON.stringify(roles, null, 2));
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
    icon: path.join(__dirname, process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
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
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: url });
    request.setHeader('User-Agent', 'HermesAI-Desktop/1.0');
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9');
    Object.entries(headers).forEach(([k, v]) => request.setHeader(k, v));
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

// ===== Gateway 对话帮助函数（可复用，供 chat 和 pipeline 共享） =====
async function chatViaGateway(roleId, userMessage, eventSender) {
  const roles = loadRoles();
  const currentRole = roles[roleId] || roles['dami'];
  const chatMessages = [
    { role: 'system', content: currentRole.systemPrompt || '你是 Hergent 数字员工，运行在用户的电脑上。你可以读写文件、执行代码、操控系统。说人话、不啰嗦。' },
    { role: 'user', content: userMessage }
  ];

  return new Promise((resolve, reject) => {
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
              try { eventSender.send('hermes:stream', { text: d, type: 'response' }); } catch (_) {}
            }
          } catch (_) {}
        }
      });
      res.on('end', () => resolve(fullResponse));
    });
    request.on('error', reject);
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
          const creditsRes = await httpGet(`${SERVER_URL}/api/credits?device_id=${getDeviceId()}`);
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
          // CLI Fallback: 直接用 hermes chat -q（不依赖 gateway）
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] Gateway still not ready, falling back to CLI\\n`);
          // Windows: 用 python.exe 直接调 hermes 脚本
          // macOS: 用 run.sh + hermes chat -q
          if (isWindows) {
            const engineDir = getEngineDir();
            const winPython = path.join(engineDir, 'python', 'python.exe');
            const winHermes = path.join(engineDir, 'hermes');
            if (!fs.existsSync(winPython) || !fs.existsSync(winHermes)) {
              return { requestId, success: false, output: 'Hermes 引擎未安装，请先在设置中安装' };
            }
            try {
              const child = spawn(winPython, [winHermes, 'chat', '-q', fullText, '--max-turns', '60', '--source', 'tool'], {
                env: { ...process.env, PYTHONPATH: path.join(engineDir, 'libs'), PYTHONHOME: '', HERMES_HOME: path.join(engineDir, '.hermes', 'agents', role || 'dami') }
              });
              const cliResult = await new Promise((resolve, reject) => {
                let stdout = '', stderr = '';
                const timer = setTimeout(() => { child.kill(); reject(new Error('回复超时')); }, 600000);
                child.stdout.on('data', d => { stdout += d.toString(); });
                child.stderr.on('data', d => { stderr += d.toString(); });
                child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || 'AI 处理失败')); });
                child.on('error', e => { clearTimeout(timer); reject(e); });
              });
              let responseText = cliResult.stdout.split('\n').filter(l => { const t = l.trim(); return t && !t.startsWith('Query:') && !t.startsWith('Initializing') && !t.startsWith('─') && !t.startsWith('session_id:') && !t.startsWith('┊') && !t.startsWith('↻') && !t.includes('╭') && !t.includes('╰') && !t.startsWith('Resume this session') && !t.startsWith('hermes --resume') && !t.startsWith('Session:') && !t.startsWith('Duration:') && !t.startsWith('Messages:') && !t.startsWith('⚠'); }).map(l => l.trim()).join('\n').trim();
              const cliCreditsUsed = Math.max(1, Math.ceil((fullText.length + responseText.length) / 500));
              // 积分由服务端 /v1/chat/completions 按实际 token 用量扣减，客户端不重复扣
              return { requestId, success: true, output: responseText.slice(0, 8000), offline: true };
            } catch (e) {
              return { requestId, success: false, output: `执行失败：${e.message}` };
            }
          }
          // macOS/Linux Fallback
          if (!isWindows) {
            const engineDir = getEngineDir();
            const pyDir = path.join(engineDir, 'python');
            if (fs.existsSync(pyDir)) { spawnSync('/usr/bin/xattr', ['-cr', pyDir], { timeout: 10000 }); }
          }
          const versionCheck = spawnSync(HERMES_BIN, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
          if (versionCheck.status !== 0) {
            return { requestId, success: false, output: 'Hermes 引擎未安装，请先在设置中安装' };
          }
          try {
              const engineDir = getEngineDir();
              const child = spawn(HERMES_BIN, ['chat', '-q', fullText, '--max-turns', '60', '--source', 'tool'], {
                env: { ...process.env, HERMES_HOME: path.join(engineDir, '.hermes', 'agents', role || 'dami') }
              });
              const cliResult = await new Promise((resolve, reject) => {
                let stdout = '', stderr = '';
                const timer = setTimeout(() => { child.kill(); reject(new Error('回复超时')); }, 600000);
                child.stdout.on('data', d => { stdout += d.toString(); });
                child.stderr.on('data', d => { stderr += d.toString(); });
                child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || 'AI 处理失败')); });
                child.on('error', e => { clearTimeout(timer); reject(e); });
              });
              const boxMatch = cliResult.stdout.match(/Hermes[^\n]*\n([\s\S]*?)\n\s*[╰─][─\s]*(?:╯)?\s*\n/);
              let responseText = boxMatch ? boxMatch[1].split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim() : '';
              if (!responseText) responseText = cliResult.stdout.split('\n').filter(l => { const t = l.trim(); return t && !t.startsWith('Query:') && !t.startsWith('Initializing') && !t.startsWith('─') && !t.startsWith('session_id:') && !t.startsWith('┊') && !t.startsWith('↻') && !t.includes('╭') && !t.includes('╰') && !t.startsWith('Resume this session') && !t.startsWith('hermes --resume') && !t.startsWith('Session:') && !t.startsWith('Duration:') && !t.startsWith('Messages:') && !t.startsWith('⚠'); }).map(l => l.trim()).join('\n').trim();
              const cliCreditsUsed = Math.max(1, Math.ceil((fullText.length + responseText.length) / 500));
              // 积分由服务端 /v1/chat/completions 按实际 token 用量扣减，客户端不重复扣
              return { requestId, success: true, output: responseText.slice(0, 8000), offline: true };
            } catch (e) {
              return { requestId, success: false, output: `执行失败：${e.message}` };
            }
        }

        const roleId = role || 'dami';
        const roles = loadRoles();
        const currentRole = roles[roleId] || roles['dami'];
        try {
          const sessionId = ROLE_SESSIONS[roleId] || null;
          const result = await new Promise((resolve, reject) => {
            const chatMessages = [
              { role: 'system', content: currentRole.systemPrompt || '你是 Hergent 数字员工，运行在用户的电脑上。你可以读写文件、执行代码、操控系统。说人话、不啰嗦。' },
              { role: 'user', content: fullText }
            ];
            const postData = JSON.stringify({ model: 'deepseek-chat', messages: chatMessages, stream: true, max_tokens: 4096 });
            const request = net.request({
              method: 'POST',
              url: `${GATEWAY_URL}/v1/chat/completions`
            });
            request.setHeader('Content-Type', 'application/json');
            request.setHeader('User-Agent', 'Hergent-Desktop/1.0');
            request.setHeader('Authorization', `Bearer ${GATEWAY_API_KEY}`);
            if (sessionId) {
              request.setHeader('X-Hermes-Session-Id', sessionId);
            }
            request.on('response', (res) => {
              if (res.statusCode !== 200) {
                let b = ''; res.on('data', c => b += c);
                res.on('end', () => reject(new Error(`Gateway ${res.statusCode}`)));
                return;
              }
              // 捕获会话 ID，后续请求复用
              const sid = res.headers['x-hermes-session-id'];
              if (sid) ROLE_SESSIONS[roleId] = sid;
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
          const gwResponseText = result.finalLines.join('');
          // 积分由服务端 /v1/chat/completions 按实际 token 用量扣减，客户端不重复扣
          return { requestId, success: true, output: gwResponseText, offline: false };
        } catch (e) {
          return { requestId, success: false, output: `执行失败：${e.message}` };
        }
      }
    }

  
  if (action === 'pipeline:run') {
    const { steps, context } = args || {};
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return { requestId: 'req_' + Date.now(), success: false, output: 'pipeline steps 为空' };
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
        let gatewayReady = await isGatewayRunning();
        if (!gatewayReady) {
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] pipeline step ${i+1}: gateway not ready, starting...\n`);
          gatewayReady = await startHermesGateway();
        }

        let stepOutput = '';
        if (gatewayReady) {
          stepOutput = await chatViaGateway(stepRole, fullPrompt, event.sender);
        } else {
          // CLI fallback
          const child = spawn(HERMES_BIN, ['chat', '-q', fullPrompt, '--max-turns', '60', '--source', 'tool'], {
            env: { ...process.env, HERMES_HOME: path.join(engineDir, '.hermes', 'agents', stepRole) }
          });
          const cliResult = await new Promise((resolve, reject) => {
            let stdout = '', stderr = '';
            const timer = setTimeout(() => { child.kill(); reject(new Error('回复超时')); }, 600000);
            child.stdout.on('data', d => { stdout += d.toString(); });
            child.stderr.on('data', d => { stderr += d.toString(); });
            child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr || 'AI 处理失败')); });
            child.on('error', e => { clearTimeout(timer); reject(e); });
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
      const roleName = (loadRoles()[r.role] || {}).name || r.role;
      return `### ${roleName}\n${r.output}`;
    }).join('\n\n---\n\n');

    return { requestId: 'req_' + Date.now(), success: true, output: finalOutput, pipeline: results };
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
    const ready = isEngineReady();
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

ipcMain.handle('get:errors', async () => {
  return ERROR_HISTORY;
});


// ===== IPC: 激活码 & 试用 =====
ipcMain.handle('activation:status', async () => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/credits?device_id=${getDeviceId()}`);
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
    const body = await httpGet(`${SERVER_URL}/api/credits?device_id=${getDeviceId()}`);
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

  // Step 5: 写 Gateway 配置 — 委托给 Hermes CLI
  send('config|配置 Hermes…');
  try {
    const cfgEnv = { ...process.env, HERMES_HOME: path.join(homeDir, '.hermes') };
    const set = (k, v) => spawnSync(HERMES_BIN, ['config', 'set', k, v], { timeout: 5000, env: cfgEnv });
    set('model.default', 'deepseek-chat');
    set('model.provider', 'hergent');
    set('api_server.enabled', 'true');
    set('api_server.port', '18765');
    set('max_turns', '60');
    set('custom_providers.0.name', 'hergent');
    set('custom_providers.0.base_url', `${SERVER_URL}/v1`);
    set('custom_providers.0.key', `hermes_${getDeviceId()}`);
    log('config written via hermes config set');
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
  const engineDir = getEngineDir();
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
  return { success: true };
});
ipcMain.handle('session:clear', async (event, role) => {
  const roleId = role || 'dami';
  try {
    const engineDir = getEngineDir();
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
function getRoleMemoryPath(roleId) {
  const engineDir = getEngineDir();
  // 优先用角色独立记忆路径，不存在则回退到共享路径
  const roleMemPath = path.join(engineDir, '.hermes', 'agents', roleId || 'dami', 'memories', 'MEMORY.md');
  if (fs.existsSync(roleMemPath)) return roleMemPath;
  return path.join(engineDir, '.hermes', 'memories', 'MEMORY.md');
}

ipcMain.handle('memory:list', async (event, role) => {
  try {
    const roleId = role || 'dami';
    const memoryPath = getRoleMemoryPath(roleId);
    if (!fs.existsSync(memoryPath)) return { memories: [] };
    const content = fs.readFileSync(memoryPath, 'utf8');
    const sections = content.split(/^§/m).filter(s => s.trim());
    const memories = sections.map((sec, i) => {
      const lines = sec.trim().split('\n');
      const title = (lines[0] || '').replace(/^#+\s*/, '').trim() || '记忆片段';
      const preview = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      const id = crypto.createHash('md5').update(sec).digest('hex').slice(0, 8);
      return { id, title, preview, updated: new Date().toISOString() };
    });
    return { memories };
  } catch (_) { return { memories: [] }; }
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
// ---- 技能列表 ----
ipcMain.handle('skills:list', async () => {
  try {
    const engineDir = getEngineDir();
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
      if (direct) { categories.push(direct); continue; }
      // 2. 分类目录: skillsDir/category/skillName/SKILL.md
      const subEntries = fs.readdirSync(path.join(skillsDir, e.name), { withFileTypes: true });
      for (const se of subEntries) {
        if (!se.isDirectory()) continue;
        const skill = parseSkill(path.join(skillsDir, e.name, se.name), se.name);
        if (skill) categories.push(skill);
      }
    }
    return { categories, total: categories.length };
  } catch (_) { return { categories: [], total: 0 }; }
});
ipcMain.handle('roles:list', async () => {
  const roles = loadRoles();
  return Object.entries(roles).map(([id, r]) => ({ id, ...r }));
});
// ---- 角色 CRUD ----
ipcMain.handle('roles:save', async (event, roles) => {
  try {
    if (typeof roles === 'object' && !Array.isArray(roles)) {
      saveRoles(roles);
      return { success: true };
    }
    return { success: false, error: '格式错误' };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('roles:add', async (event, roleData) => {
  try {
    const roles = loadRoles();
    let id = (roleData.name || '新角色').replace(/[^a-zA-Z0-9一-鿿]/g, '').slice(0, 12) || 'custom';
    if (roles[id]) id = id + '_' + Date.now().toString(36);
    roles[id] = { name: roleData.name || '新角色', systemPrompt: roleData.systemPrompt || '', opening: roleData.opening || '', builtIn: false };
    saveRoles(roles);
    return { success: true, id, role: { id, ...roles[id] } };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('roles:delete', async (event, roleId) => {
  try {
    const roles = loadRoles();
    if (!roles[roleId]) return { success: false, error: '角色不存在' };
    if (roles[roleId].builtIn) return { success: false, error: '内置角色不可删除' };
    delete roles[roleId];
    saveRoles(roles);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('roles:update', async (event, roleId, updates) => {
  try {
    const roles = loadRoles();
    if (!roles[roleId]) return { success: false, error: '角色不存在' };
    if (updates && typeof updates === 'object') Object.assign(roles[roleId], updates);
    saveRoles(roles);
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
// ---- 认证（对接服务端）----
ipcMain.handle('auth:me', async (event, token) => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/auth/me`, { 'X-Hermes-Token': token });
    return JSON.parse(body);
  } catch (e) { return { user: null, error: 'auth not configured' }; }
});
ipcMain.handle('auth:send-code', async (event, phone) => {
  try {
    const body = await httpPost(`${SERVER_URL}/api/auth/send-code`, JSON.stringify({ phone }));
    return JSON.parse(body);
  } catch (e) { return { success: false, error: 'auth not configured' }; }
});
ipcMain.handle('auth:verify-code', async (event, phone, code) => {
  try {
    const body = await httpPost(`${SERVER_URL}/api/auth/verify-code`, JSON.stringify({ phone, code }));
    return JSON.parse(body);
  } catch (e) { return { success: false, error: 'auth not configured' }; }
});
ipcMain.handle('auth:wechat-url', async () => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/auth/wechat/login-url`);
    return JSON.parse(body);
  } catch (e) { return { url: '', error: 'auth not configured' }; }
});
ipcMain.handle('auth:logout', async (event, token) => {
  try {
    await httpPost(`${SERVER_URL}/api/auth/logout`, JSON.stringify({}), { headers: { 'X-Hermes-Token': token } });
  } catch (_) {}
  return { success: true };
});
// ---- 渠道 ----
ipcMain.handle('channels:remove', async (event, channel, role) => {
  try {
    const cp = getConfigPath();
    if (fs.existsSync(cp)) {
      const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
      delete cfg[channel];
      fs.writeFileSync(cp, JSON.stringify(cfg, null, 2));
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
// 配对审批 — 委托给 Hermes 原生命令
ipcMain.handle('channels:pairing-approve', async (event, channel, role, code) => {
  try {
    const engineDir = getEngineDir();
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
    const body = await httpGet(`${SERVER_URL}/api/payment/url?amount=${amount}&device_id=${getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) { return { success: false, error: '充值服务暂不可用' }; }
});
// ---- 用量明细 ----
ipcMain.handle('usage:history', async (event, limit) => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/usage/history?limit=${limit || 20}&device_id=${getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) { return { records: [] }; }
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
    try { mainWindow?.webContents?.send('update:status', { event: 'checking' }); } catch(_) {}
  });
  autoUpdater.on('update-available', (info) => {
    try { mainWindow?.webContents?.send('update:status', { event: 'available', version: info.version }); } catch(_) {}
  });
  autoUpdater.on('update-not-available', () => {
    try { mainWindow?.webContents?.send('update:status', { event: 'not-available' }); } catch(_) {}
  });
  autoUpdater.on('download-progress', (progress) => {
    try { mainWindow?.webContents?.send('update:status', { event: 'progress', percent: Math.round(progress.percent) }); } catch(_) {}
  });
  autoUpdater.on('update-downloaded', (info) => {
    try { mainWindow?.webContents?.send('update:status', { event: 'downloaded', version: info.version }); } catch(_) {}
  });
  autoUpdater.on('error', (err) => {
    try { mainWindow?.webContents?.send('update:status', { event: 'error', message: err.message }); } catch(_) {}
  });

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { updateAvailable: false, reason: 'dev-mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo && result.updateInfo.version !== CURRENT_VERSION) {
        return { updateAvailable: true, version: result.updateInfo.version, releaseNotes: result.updateInfo.releaseNotes };
      }
    } catch (_) {}
    return { updateAvailable: false };
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
    try {
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

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
