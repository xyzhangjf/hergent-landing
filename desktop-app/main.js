const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, nativeTheme } = require('electron');
const path = require('path');
const { execSync, exec, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const PROFILE = 'hermes-desktop';
const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
const CURRENT_VERSION = '1.0.17';
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
const _roleGateways = []; // { roleId, process, home } — 飞书每角色独立Gateway
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

async function waitForGateway(maxWaitMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isGatewayRunning()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}


// 所有平台都走角色独立 Gateway，主 Gateway 不再直接处理任何平台连接
function getPlatformEnvVars() {
  return {};
}

// 平台定义: { key, envVars: {fieldName -> envName}, credField: 凭证标识字段 }
const PLATFORM_DEFS = {
  feishu:    { label: '飞书',  credField: 'app_id', envVars: { app_id: 'FEISHU_APP_ID', app_secret: 'FEISHU_APP_SECRET' } },
  wecom:     { label: '企微',  credField: 'bot_id', envVars: { bot_id: 'WECOM_BOT_ID', secret: 'WECOM_SECRET' } },
  dingtalk:  { label: '钉钉',  credField: 'client_id', envVars: { client_id: 'DINGTALK_CLIENT_ID', client_secret: 'DINGTALK_CLIENT_SECRET' } },
  qq:        { label: 'QQ',    credField: 'app_id', envVars: { app_id: 'QQ_APP_ID', app_secret: 'QQ_APP_SECRET' } },
};

// 获取角色最近的平台 session ID（飞书等），用于 App 聊天与平台共享上下文
function getLatestPlatformSession(roleId) {
  try {
    const engineDir = getEngineDir();
    const sessionsDir = path.join(engineDir, '.hermes', 'agents', roleId, 'sessions');
    const indexPath = path.join(sessionsDir, 'sessions.json');
    if (!fs.existsSync(indexPath)) return null;
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    let latest = null;
    for (const [key, meta] of Object.entries(index)) {
      if (meta.platform === 'cli' || meta.platform === 'api_server') continue;
      if (!latest || meta.updated_at > latest.updated_at) {
        latest = { sessionId: meta.session_id, updated: meta.updated_at };
      }
    }
    return latest ? latest.sessionId : null;
  } catch (_) { return null; }
}

// 从 channels.json 读取所有平台每角色配置
// 返回 [{ platform, roleId, name, creds: {app_id, app_secret, ...}, envVars: {FEISHU_APP_ID: ..., ...} }]
function getPlatformRoleConfigs() {
  const configs = [];
  try {
    const cp = getConfigPath();
    if (!fs.existsSync(cp)) return configs;
    const channels = JSON.parse(fs.readFileSync(cp, 'utf8'));
    const roles = loadRoles();
    for (const [platformKey, platformDef] of Object.entries(PLATFORM_DEFS)) {
      const platformData = channels[platformKey];
      if (!platformData) continue;
      for (const [roleId, cfg] of Object.entries(platformData)) {
        if (roleId.startsWith('_')) continue;
        const credField = platformDef.credField;
        if (!cfg[credField]) continue;
        const envVars = {};
        for (const [fieldName, envName] of Object.entries(platformDef.envVars)) {
          envVars[envName] = cfg[fieldName] || '';
        }
        configs.push({
          platform: platformKey,
          roleId,
          name: (roles[roleId] && roles[roleId].name) || roleId,
          creds: cfg,
          envVars,
          label: platformDef.label
        });
      }
    }
  } catch (_) {}
  return configs;
}

// 向后兼容别名
function getFeishuRoleConfigs() {
  return getPlatformRoleConfigs().filter(c => c.platform === 'feishu');
}


// 为每个有平台配置的角色启动独立 Gateway 进程（飞书/企微/钉钉/QQ）
function spawnRoleGateways(pythonBin, libsDir, glog) {
  const configs = getPlatformRoleConfigs();
  if (configs.length === 0) { glog('No platform role configs found, skipping role gateways'); return; }

  // 先停掉旧的角色 Gateway
  for (const rg of _roleGateways) {
    try { rg.process.kill(); } catch (_) {}
  }
  _roleGateways.length = 0;

  const engineDir = getEngineDir();

  for (const cfg of configs) {
    const roleHome = path.join(engineDir, '.hermes', 'agents', cfg.roleId);
    if (!fs.existsSync(roleHome)) { fs.mkdirSync(roleHome, { recursive: true }); }

    // 确保角色 Gateway 有自己的 config.yaml（写模型配置）
    const roleConfigPath = path.join(roleHome, 'config.yaml');
    const roleConfigEnv = { ...process.env, HERMES_HOME: roleHome };
    const rset = (k, v) => spawnSync(HERMES_BIN, ['config', 'set', k, v], { timeout: 5000, env: roleConfigEnv });
    rset('model.name', 'deepseek-v4-pro');
    rset('model.provider', 'hergent');
    rset('model.base_url', 'http://localhost:8765/v1');
    rset('model.default', 'deepseek-v4-pro');
    // 从主引擎配置读取当前模型和 provider
    const mainConfigPath = path.join(engineDir, '.hermes', 'config.yaml');
    let currentModel = 'deepseek-v4-pro';
    let currentProvider = 'hergent';
    try {
      if (fs.existsSync(mainConfigPath)) {
        const mainCfg = fs.readFileSync(mainConfigPath, 'utf8');
        const mn = mainCfg.match(/^model:\s*\n\s+name:\s*(.+)/m);
        const mp = mainCfg.match(/^model:\s*\n\s+provider:\s*(.+)/m);
        if (mn) currentModel = mn[1].trim();
        if (mp) currentProvider = mp[1].trim();
      }
    } catch (_) {}
    rset('model.name', currentModel);
    rset('model.provider', currentProvider);
    rset('model.base_url', 'http://localhost:8765/v1');
    rset('model.default', currentModel);
    rset('custom_providers.0.name', 'hergent');
    rset('custom_providers.0.base_url', 'http://localhost:8765/v1');
    rset('custom_providers.0.api_key', 'hermes_' + getDeviceId());
    rset('custom_providers.0.model', currentModel);
    rset('custom_providers.1.name', 'bailian');
    rset('custom_providers.1.base_url', 'http://localhost:8765/v1');
    rset('custom_providers.1.api_key', 'hermes_' + getDeviceId());
    rset('custom_providers.1.model', currentProvider === 'bailian' ? currentModel : 'qwen3-max');

    glog(`Starting ${cfg.label} gateway for role ${cfg.roleId} (${cfg.name})...`);
    try {
      const roleProc = spawn(pythonBin, ['-m', 'hermes_cli.main', 'gateway', 'run', '--replace'], {
        env: { ...process.env, HOME: homeDir, HERMES_HOME: roleHome, HERMES_CONFIG_PATH: roleConfigPath,
               ...cfg.envVars,
               API_SERVER_ENABLED: 'false', GATEWAY_ALLOW_ALL_USERS: 'true',
               PYTHONPATH: libsDir, PYTHONHOME: '' },
        stdio: 'ignore',
        detached: true
      });
      roleProc.unref();
      roleProc.on('error', (err) => { glog(`Role GW ${cfg.roleId}/${cfg.platform} SPAWN ERROR: ` + err.message); });
      roleProc.on('exit', (code, sig) => { glog(`Role GW ${cfg.roleId}/${cfg.platform} exited code=${code} sig=${sig}`); });
      _roleGateways.push({ roleId: cfg.roleId, platform: cfg.platform, process: roleProc, home: roleHome });
      glog(`Role GW ${cfg.roleId}/${cfg.platform} spawned OK`);
    } catch(e) {
      glog(`Role GW ${cfg.roleId}/${cfg.platform} spawn exception: ` + e.message);
    }
  }
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

  const isRunning = await isGatewayRunning();

  if (!isRunning) {
  // 确保 Gateway 配置正确（通过 hermes config set）
  const mainConfigPath = path.join(gwHome, 'config.yaml');
  try {
    const deviceId = getDeviceId();
    const cfgEnv = { ...process.env, HERMES_HOME: gwHome };
    const set = (k, v) => spawnSync(HERMES_BIN, ['config', 'set', k, v], { timeout: 5000, env: cfgEnv });
    const dsKey = getDeepSeekApiKey();
    // 仅在首次配置时写入默认模型，后续保留用户选择
    const existingModel = (() => { try { const c = fs.readFileSync(mainConfigPath, 'utf8'); const m = c.match(/^model:\s*\n\s+name:\s*(.+)/m); return m ? m[1].trim() : null; } catch(_) { return null; } })();
    if (!existingModel) {
      set('model.name', 'deepseek-v4-pro');
      set('model.provider', 'hergent');
      set('model.base_url', `${SERVER_URL}/v1`);
      set('model.default', 'deepseek-v4-pro');
      set('custom_providers.0.model', 'deepseek-v4-pro');
      set('custom_providers.1.model', 'qwen3-max');
    }
    set('platforms.api_server.enabled', 'true');
    set('platforms.api_server.port', String(GATEWAY_PORT));
    set('platforms.api_server.key', GATEWAY_API_KEY);
    // DeepSeek 原生 provider: Gateway 自带 base_url，custom_providers 提供 API key
    set('custom_providers.0.name', 'hergent');
    set('custom_providers.0.base_url', `${SERVER_URL}/v1`);
    set('custom_providers.0.api_key', dsKey);
    // 阿里云百炼 provider（通过积分服务代理）
    set('custom_providers.1.name', 'bailian');
    set('custom_providers.1.base_url', `${SERVER_URL}/v1`);
    set('custom_providers.1.api_key', dsKey);
    set('memory.memory_enabled', 'true');
    set('memory.memory_char_limit', '12000');
    set('memory.user_char_limit', '8000');
    set('memory.flush_min_turns', '6');
    set('memory.nudge_interval', '10');
  } catch(e) {
    glog('config update error: ' + e.message);
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
      const libsDir = path.join(binDir, 'libs');
      glog(`spawning via Python: ${pythonBin} -m hermes_cli.main gateway run, PYTHONPATH=${libsDir}`);
      try {
        gatewayProcess = spawn(pythonBin, ['-m', 'hermes_cli.main', 'gateway', 'run', '--replace'], {
          env: { ...process.env, HOME: homeDir, HERMES_HOME: gwHome, HERMES_CONFIG_PATH: mainConfigPath, API_SERVER_PORT: String(GATEWAY_PORT), API_SERVER_ENABLED: 'true', API_SERVER_KEY: GATEWAY_API_KEY, GATEWAY_ALLOW_ALL_USERS: 'true', PYTHONPATH: libsDir, PYTHONHOME: '' },
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
  } // end if (!isRunning)

  // 启动飞书每角色独立 Gateway（无论主Gateway是否已运行）
  const binDir2 = path.dirname(HERMES_BIN);
  const pythonCandidates2 = [
    path.join(binDir2, 'python', 'bin', 'python3.11'),
    path.join(binDir2, 'python3.11'),
    path.join(binDir2, 'python3'),
  ];
  const pythonBin2 = pythonCandidates2.find(p => fs.existsSync(p));
  if (pythonBin2) {
    const libsDir2 = path.join(binDir2, 'libs');
    spawnRoleGateways(pythonBin2, libsDir2, glog);
  } else {
    glog('Role GW: no python binary found for role gateways');
  }

  glog('waiting for health check...');
  const ready = isRunning || await waitForGateway();
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
    try { gatewayProcess.kill(); } catch (_) {}
    gatewayProcess = null;
  }
  for (const rg of _roleGateways) {
    try { rg.process.kill(); } catch (_) {}
  }
  _roleGateways.length = 0;
  // 清理所有 Hergent 残留 gateway 进程
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try { execSync('pkill -f "hergent.*gateway run"', { timeout: 5000 }); } catch (_) {}
  } else {
    try { execSync('taskkill /F /IM python3.11.exe /FI "WINDOWTITLE eq gateway run"', { timeout: 5000 }); } catch (_) {}
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

  // 优先用引擎自带的 Python（libs 里有 fastapi/uvicorn/httpx 等全套依赖）
  const home = app.getPath('home');
  const engineDir = getEngineDir(); // ~/Library/Application Support/hergent/hermes-engine
  const agentPython = path.join(home, '.hermes', 'hermes-agent', 'python', 'bin', 'python3.11');
  const agentVenvPython = path.join(home, '.hermes', 'hermes-agent', 'venv', 'bin', 'python3.11');
  const enginePython = path.join(engineDir, 'python', 'bin', 'python3.11');
  const agentLibs = path.join(home, '.hermes', 'hermes-agent', 'libs');
  const engineLibs = path.join(engineDir, 'libs');
  let pythonPath = 'python3';
  let pythonLibs = null;
  // 引擎 Python 优先（已预装 fastapi/uvicorn/httpx），Agent Python 兜底
  if (fs.existsSync(enginePython)) {
    pythonPath = enginePython;
    pythonLibs = engineLibs;
  } else if (fs.existsSync(agentVenvPython)) {
    pythonPath = agentVenvPython;
    pythonLibs = agentLibs;
  } else if (fs.existsSync(agentPython)) {
    pythonPath = agentPython;
    pythonLibs = agentLibs;
  }
  console.log(`[credits-server] Python: ${pythonPath}, libs: ${pythonLibs || 'none'}`);

  // 确保引擎 Python 有 fastapi/uvicorn（引擎打包时可能不含）
  if (pythonPath !== 'python3') {
    try {
      const checkFastapi = spawnSync(pythonPath, ['-c', 'import fastapi, uvicorn'], { timeout: 5000 });
      if (checkFastapi.status !== 0) {
        console.log('[credits-server] Installing fastapi/uvicorn...');
        spawnSync(pythonPath, ['-m', 'pip', 'install', 'fastapi', 'uvicorn', '--quiet'], { timeout: 60000 });
      }
    } catch (_) {}
  }

  // 从多处读取 DeepSeek API Key
  let deepseekKey = '';
  try {
    const authPath = path.join(home, '.hermes', 'auth.json');
    if (fs.existsSync(authPath)) {
      const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      const pool = authData.credential_pool || {};
      const keys = pool.deepseek || [];
      if (keys.length > 0) deepseekKey = keys[0].access_token || '';
    }
  } catch (e) { /* ignore */ }
  // 兜底: 从引擎 config.yaml 读取
  if (!deepseekKey) {
    try {
      const cfgPath = path.join(engineDir, 'config.yaml');
      if (fs.existsSync(cfgPath)) {
        const cfg = fs.readFileSync(cfgPath, 'utf8');
        const keyMatch = cfg.match(/api_key:\s*(\S+)/);
        if (keyMatch && keyMatch[1] && keyMatch[1] !== "''" && keyMatch[1] !== '""') {
          deepseekKey = keyMatch[1];
        }
      }
    } catch (_) {}
  }
  // 最终兜底
  if (!deepseekKey || deepseekKey === 'hermes-local-proxy') deepseekKey = 'sk-1e5cab7058234b538ddb161ccaf65c58';

  console.log(`[credits-server] Starting: ${pythonPath} ${scriptPath}`);
  const spawnEnv = { ...process.env, PYTHONUNBUFFERED: '1', DEEPSEEK_API_KEY: deepseekKey, BAILIAN_API_KEY: 'sk-5065e1a611f14703a8591202bd5409a4' };
  if (pythonLibs) {
    spawnEnv.PYTHONPATH = pythonLibs;
    spawnEnv.PYTHONHOME = '';
  }
  serverProcess = spawn(pythonPath, [scriptPath], { env: spawnEnv });
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
const SERVER_URL = 'http://localhost:8765';
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
let _cancelFn = null; // 当前活跃操作的取消函数，hermes:cancel 调用时触发

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

// 每次启动都确保引擎配置正确（通过 hermes config set）
function ensureEngineConfig() {
  const engineDir = getEngineDir();
  const hermesHome = path.join(engineDir, '.hermes');
  const configPath = path.join(hermesHome, 'config.yaml');

  // 已配置则跳过
  if (fs.existsSync(configPath)) return;

  if (!fs.existsSync(hermesHome)) fs.mkdirSync(hermesHome, { recursive: true });

  const cfgEnv = { ...process.env, HERMES_HOME: hermesHome };
  const set = (k, v) => { try { spawnSync(HERMES_BIN, ['config', 'set', k, v], { timeout: 5000, env: cfgEnv }); } catch (_) {} };
  const dsKey = getDeepSeekApiKey();
  set('model.name', 'deepseek-v4-pro');
  set('model.provider', 'hergent');
  set('platforms.api_server.enabled', 'true');
  set('platforms.api_server.port', String(GATEWAY_PORT));
  set('platforms.api_server.key', GATEWAY_API_KEY);
  set('custom_providers.0.name', 'hergent');
  set('custom_providers.0.base_url', `${SERVER_URL}/v1`);
  set('custom_providers.0.api_key', dsKey);
  set('custom_providers.0.model', 'deepseek-v4-pro');
  set('memory.memory_enabled', 'true');
  set('memory.memory_char_limit', '12000');
  set('memory.user_char_limit', '8000');
  set('memory.flush_min_turns', '6');
  set('memory.nudge_interval', '10');
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
          const srcDir = path.join(bundledSkills, e.name);
          const dstDir = path.join(userPath, e.name);
          try {
            // 复制整个技能目录（含 scripts/ 等子目录），不只 SKILL.md
            fs.cpSync(srcDir, dstDir, { recursive: true, force: true });
          } catch (e2) { console.log('skill copy error: ' + (e2.message || e2)); }
        }
      }

      // 从 Hermes 官方仓库同步技能（git pull + 增量复制）
      const skillsCache = path.join(homeDir, '.hermes', 'hermes-skills-cache');
      if (fs.existsSync(skillsCache)) {
        try {
          const gitPull = spawnSync('git', ['-C', skillsCache, 'pull', '--ff-only'], { timeout: 10000 });
          if (gitPull.status === 0) { console.log('[skills-sync] git pull OK'); }
        } catch (_) { /* 网络不可用跳过 */ }

        // Hergent 自有技能名，不被上游覆盖
        const hergentNames = new Set();
        const bundledSkills = path.join(__dirname, 'skills');
        if (fs.existsSync(bundledSkills)) {
          for (const e of fs.readdirSync(bundledSkills, { withFileTypes: true })) {
            if (e.isDirectory()) hergentNames.add(e.name);
          }
        }

        for (const srcDir of ['skills', 'optional-skills']) {
          const srcRoot = path.join(skillsCache, srcDir);
          if (!fs.existsSync(srcRoot)) continue;
          for (const cat of fs.readdirSync(srcRoot, { withFileTypes: true })) {
            if (!cat.isDirectory() || cat.name === 'index-cache') continue;
            const catPath = path.join(srcRoot, cat.name);
            for (const sk of fs.readdirSync(catPath, { withFileTypes: true })) {
              if (!sk.isDirectory()) continue;
              if (hergentNames.has(sk.name)) continue;
              const skillMdSrc = path.join(catPath, sk.name, 'SKILL.md');
              if (!fs.existsSync(skillMdSrc)) continue;
              const dstDir = path.join(userPath, sk.name);
              const dst = path.join(dstDir, 'SKILL.md');
              try {
                if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== fs.readFileSync(skillMdSrc, 'utf8')) {
                  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
                  for (const entry of fs.readdirSync(path.join(catPath, sk.name), { withFileTypes: true })) {
                    const s = path.join(catPath, sk.name, entry.name);
                    const d = path.join(dstDir, entry.name);
                    entry.isDirectory() ? fs.cpSync(s, d, { recursive: true }) : fs.copyFileSync(s, d);
                  }
                }
              } catch (e2) { /* 单个技能失败不影响其他 */ }
            }
          }
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
    } catch (e) { console.log('shared state symlink error: ' + (e.message || e)); }
  }
  // 将新同步的技能传播到各角色
  try { syncRoleSkills(); } catch (_) {}
}

// 为每个角色创建独立的 Hermes Home（独立 workspace + skills + config + memory + persona）
// 将共享技能目录中的角色专属技能 symlink 到各角色的 skills/ 目录
function syncRoleSkills() {
  const engineDir = getEngineDir();
  const sharedSkills = path.join(engineDir, '.hermes', 'skills');
  if (!fs.existsSync(sharedSkills)) return;
  const roles = loadRoles();
  for (const [roleId] of Object.entries(roles)) {
    const roleSkills = path.join(engineDir, '.hermes', 'agents', roleId, 'skills');
    if (!fs.existsSync(roleSkills)) fs.mkdirSync(roleSkills, { recursive: true });
    const wanted = ROLE_SKILLS[roleId] || [];
    // 清除旧 symlink
    try {
      for (const entry of fs.readdirSync(roleSkills, { withFileTypes: true })) {
        try { fs.rmSync(path.join(roleSkills, entry.name), { recursive: true }); } catch (_) {}
      }
    } catch (_) {}
    // Symlink 角色专属技能
    for (const slug of wanted) {
      const src = path.join(sharedSkills, slug);
      const dst = path.join(roleSkills, slug);
      try {
        if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true });
        if (fs.existsSync(src)) fs.symlinkSync(src, dst, 'dir');
      } catch (_) {}
    }
  }
}

function ensureRoleConfigs() {
  const engineDir = getEngineDir();
  const roles = loadRoles();
  // 读取主引擎模型配置，用于同步到所有角色
  const mainConfigPath = path.join(engineDir, '.hermes', 'config.yaml');
  let mainModel = 'deepseek-v4-pro', mainProvider = 'hergent';
  try {
    const mc = fs.readFileSync(mainConfigPath, 'utf8');
    const mm = mc.match(/^model:\s*\n\s+name:\s*(.+)/m);
    const mp = mc.match(/^model:\s*\n(?:.+\n)*?\s+provider:\s*(.+)/m);
    if (mm) mainModel = mm[1].trim();
    if (mp) mainProvider = mp[1].trim();
  } catch (_) {}
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
    } catch (e) { console.log(`SOUL.md write error for ${roleId}: ` + (e.message || e)); }

    // 写入角色专属 config.yaml — 直接写 YAML 避免 custom_providers 变 dict
    const roleConfigPath = path.join(roleHome, 'config.yaml');
    if (!fs.existsSync(roleConfigPath)) {
      try {
        const roleConfigYaml = [
          'model:',
          '  name: deepseek-v4-pro',
          '  provider: hergent',
          'custom_providers:',
          '  - name: hergent',
          `    base_url: ${SERVER_URL}/v1`,
          `    api_key: hermes_${getDeviceId()}`,
          '    model: deepseek-v4-pro',
          '  - name: bailian',
          `    base_url: ${SERVER_URL}/v1`,
          `    api_key: hermes_${getDeviceId()}`,
          '    model: qwen3-max',
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
      } catch (e) { console.log(`config.yaml write error for ${roleId}: ` + (e.message || e)); }
    }
    // 同步主引擎模型到该角色 — 整段替换 model section
    try {
      let roleCfg = fs.readFileSync(roleConfigPath, 'utf8');
      roleCfg = roleCfg.replace(
        /^model:\n(\s+name: .+\n)(\s+provider: .+\n)?(\s+base_url: .+\n)?(\s+default: .+\n)?/m,
        'model:\n  name: ' + mainModel + '\n  provider: ' + mainProvider + '\n'
      );
      // 同时更新 custom_providers 中 hergent provider 的 model 名 + apiKey
      // 兼容 YAML 列表格式 "- name:" 和普通格式 "name:"
      roleCfg = roleCfg.replace(
        /^(\s*-?\s*name: hergent\n\s+base_url: .+\n\s+)api_key: .+(\n\s+model: ).+/m,
        '$1api_key: hermes_' + getDeviceId() + '$2' + mainModel
      );
      // 确保 bailian provider 的 api_key 也统一
      roleCfg = roleCfg.replace(
        /^(\s*-?\s*name: bailian\n\s+base_url: .+\n\s+)api_key: .+/m,
        '$1api_key: hermes_' + getDeviceId()
      );
      // 确保存在 bailian provider
      if (!roleCfg.includes('- name: bailian')) {
        roleCfg = roleCfg.replace(
          /(  - name: hergent\n    base_url: .+\n    api_key: .+\n    model: .+)/,
          '$1\n  - name: bailian\n    base_url: ' + `${SERVER_URL}/v1` + '\n    api_key: hermes_' + getDeviceId() + '\n    model: qwen3-max'
        );
      }
      fs.writeFileSync(roleConfigPath, roleCfg);
    } catch (_) {}
  }
  syncRoleSkills();
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

// 角色技能映射 — 与 app.js ROLE_SKILLS 保持一致
const ROLE_SKILLS = {
  dami: ['zhoupu-order-import', 'contract-writing', 'wechat-writing'],
  accountant: ['bank-reconciliation', 'accounting-reports', 'excel-data'],
  programmer: ['python-coding', 'website-builder', 'karpathy-coding'],
  writer: [],
  screenwriter: ['video-scripting'],
  tutor: ['exam-tutoring'],
  health: ['health-analysis'],
  investor: ['investment-research'],
};

const DEFAULT_ROLES = {
  dami: { name: '我的大秘', systemPrompt: '你是用户的得力助手"大秘"，你叫大秘。擅长写文档（合同/邮件/方案）、搜资料、设提醒、处理文件。你的风格是高效、靠谱、考虑周全。用户说什么你就帮忙做什么，主动帮用户省时间。直接开始工作，不要说你是什么角色。', opening: '我是你的大秘，文书、搜索、提醒都归我。\n\n**我能做什么**\n写合同、回邮件、做方案、搜资料、设提醒——你不想动手的都交给我。\n\n**数据怎么来**\n- 直接告诉我需求，网上能查到的我帮你查\n- 也可以发文件给我，我帮你整理提炼\n\n试试说一句：\n- 「帮我写一份供货合同」\n- 「搜一下最近AI行业的新动态」', builtIn: true },
  accountant: { name: '我的会计', systemPrompt: '你是用户的私人会计。你叫"会计"，精通财务数据处理：对账、做表、算税、分析收支、Excel操作。你的风格是严谨、数字敏感、细致。看到数据先核实，发现问题主动指出。每笔账都要算清楚。直接开始工作，不要说你是什么角色。', opening: '我是你的会计，财务上的事交给我。\n\n**我能做什么**\n对账、做表、算税、分析收支——跟钱有关的我都管。\n\n**数据怎么来**\n- 把银行流水、发票、账单文件发给我\n- 或者直接告诉我需求，我帮你整理\n\n试试发一句：\n- 「帮我对一下这个月的收支」\n- 「把这个Excel表做成利润分析」', builtIn: true },
  programmer: { name: '我的程序员', systemPrompt: '你是用户的私人程序员。你精通写代码：Python脚本、网页应用、自动化工具、bug修复。你的风格是逻辑清晰、直奔主题。直接给出可运行的代码并说明用法，不解释基础概念除非用户问。直接开始工作，不要说你是什么角色。', opening: '我是你的程序员，写代码做应用。\n\n**我能做什么**\n写脚本、做App、改bug、搭网站——技术活你说需求我来实现。\n\n**数据怎么来**\n- 说清楚要做什么，我直接从零开始写\n- 也可以发代码文件给我改\n\n试试说一句：\n- 「帮我写个批量重命名文件的脚本」\n- 「我想做个简单的记账App」', builtIn: true },
  writer: { name: '我的作家', systemPrompt: '你是用户的私人作家。你擅长写长文：小说、传记、公众号文章、经验总结。你的风格是有文采但不矫情，有深度但好读。帮用户搭框架、理思路、出章节，文字要有感染力。直接开始工作，不要说你是什么角色。', opening: '我是你的作家，帮你写东西。\n\n**我能做什么**\n小说、传记、公众号文章、经验总结——你说方向给素材，我帮你写出来。\n\n**数据怎么来**\n- 跟我聊想法，我帮你搭框架、写章节\n- 也可以发素材、提纲、录音给我\n\n试试说一句：\n- 「我想把我的行业经验整理成一本电子书」\n- 「帮我写个小说开头，主角是个年轻的创业者」', builtIn: true },
  screenwriter: { name: '我的编剧', systemPrompt: '你是用户的私人编剧。你擅长短内容创作：短视频脚本、广告文案、品牌故事、演讲稿。你的风格是抓眼球、有节奏感、懂平台调性。先问平台和时长，再给创意，文案要能直接用。直接开始工作，不要说你是什么角色。', opening: '我是你的编剧，内容创作我来。\n\n**我能做什么**\n短视频脚本、广告文案、品牌故事、演讲稿——什么类型都行。\n\n**数据怎么来**\n- 告诉我平台和风格，我直接写\n- 也可以发参考案例给我模仿\n\n试试说一句：\n- 「帮我写个15秒的短视频带货脚本」\n- 「帮我写个品牌故事，温情路线的」', builtIn: true },
  tutor: { name: '我的私教', systemPrompt: '你是用户的私人教师。你擅长教学：把复杂知识讲简单，用类比和例子帮助理解。你的风格是耐心、循序渐进、鼓励式。先判断用户水平，再讲核心概念，最后举例。用户懂了才往下走。直接开始教学，不要说你是什么角色。', opening: '我是你的私教，想学什么直接问。\n\n**我能做什么**\n编程、数学、考试辅导——不懂就问，我讲到你懂为止。\n\n**数据怎么来**\n- 直接发题目或知识点，我讲给你听\n- 也可以发教材截图或笔记\n\n试试问一句：\n- 「Python爬虫怎么学」\n- 「帮我讲一下概率论的基础概念」', builtIn: true },
  health: { name: '我的健康顾问', systemPrompt: '你是用户的私人健康顾问。你擅长健康管理：饮食搭配、运动计划、睡眠改善、体检报告解读。你的风格是科学但不吓人，建议具体可执行。需要时提醒用户"我不是医生，严重问题要看医生"但不要每次都啰嗦。直接开始服务，不要说你是什么角色。', opening: '我是你的健康顾问，身体的事问我。\n\n**我能做什么**\n饮食搭配、运动计划、睡眠改善、体检指标解读——帮你把健康管起来。\n\n**数据怎么来**\n- 告诉我你的情况，我帮你分析建议\n- 也可以发体检报告给我看\n\n试试问一句：\n- 「久坐上班怎么安排饮食和运动」\n- 「帮我看一下这份体检报告」', builtIn: true },
  investor: { name: '我的投资顾问', systemPrompt: '你是用户的私人理财顾问。你擅长理财分析：市场行情、资产配置、风险评估。你的风格是中立客观、用数据说话。不推荐具体股票，不承诺收益，帮用户理解风险和机会。首次回复时简单声明不构成投资建议，之后直接开始分析。不要说你是什么角色。', opening: '我是你的投资顾问，钱的事帮你理清楚。\n\n**我能做什么**\n市场分析、资产配置、风险评估——不推荐具体股票，但帮你做决策参考。\n\n**数据怎么来**\n- 告诉我你想了解的方向和预算\n- 也可以发财报、研报给我分析\n\n试试问一句：\n- 「我有10万闲钱，低风险的怎么配」\n- 「帮我分析一下最近的市场行情」', builtIn: true }
};
const resolvedPath = resolveHermesPath();
if (resolvedPath) HERMES_BIN = resolvedPath;

// Delay init that needs userData path until app is ready
app.whenReady().then(() => {
  if (HERMES_BIN) {
    ensureEngineConfig();
    ensureBuiltinSkills();
    ensureRoleConfigs();
    markEngineReady();
  }
});

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
  if (lic) {
    lic.deviceId = id; saveLicense(lic);
    console.log('warn: license.json 存在但缺少 deviceId，已补充');
  } else {
    // license.json 丢失 — 可能是数据损坏或首次安装
    const engineDir = getEngineDir();
    if (fs.existsSync(path.join(engineDir, '.extracted-version'))) {
      console.log('warn: license.json 丢失，生成新 deviceId，服务端积分/激活状态可能丢失');
    }
    saveLicense({ firstRunDate: new Date().toISOString(), activated: false, credits: 0, deviceId: id });
  }
  return id;
}

function getDeepSeekApiKey() {
  try {
    const authPath = path.join(homeDir, '.hermes', 'auth.json');
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      const pool = auth.credential_pool?.deepseek;
      if (pool && pool.length > 0) return pool[0].access_token;
    }
  } catch (_) {}
  return process.env.DEEPSEEK_API_KEY || 'hermes-local-proxy';
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
    titleBarStyle: 'hidden',
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
  stopHermesGateway();
  try { execSync('pkill -9 -f "gateway run"', { timeout: 5000 }); } catch (_) {}
  await new Promise(r => setTimeout(r, 3000));
  const ok = await startHermesGateway();
  return { success: ok, output: ok ? 'Gateway restarted' : 'Gateway restart failed' };
}

// ===== Hermes CLI 帮助函数 =====

function hermesCLI(args, timeout = 30000) {
  const cmd = `${HERMES_BIN} ${args}`;
  const hermesHome = path.join(getEngineDir(), '.hermes');
  const result = execSync(cmd, { timeout, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HERMES_HOME: hermesHome } });
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
    const postData = JSON.stringify({ model: 'deepseek-v4-pro', messages: chatMessages, stream: true, max_tokens: 4096 });
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
          return { requestId, success: false, output: creditsMsg, sessionId: null };
        }

        // === 使用 Hermes CLI（完整工具支持：文件/浏览器/代码执行） ===
        // Gateway 暂不用于 chat: v4-pro 流式响应解析兼容性问题
        // CLI 路径已验证：工具调用正常，响应完整
        {
          // macOS/Linux: 直接用 hermes chat -q
          if (isWindows) {
            const engineDir = getEngineDir();
            const winPython = path.join(engineDir, 'python', 'python.exe');
            const winHermes = path.join(engineDir, 'hermes');
            if (!fs.existsSync(winPython) || !fs.existsSync(winHermes)) {
              return { requestId, success: false, output: 'Hermes 引擎未安装，请先在设置中安装', sessionId: null };
            }
            try {
              const winRoleId = role || 'dami';
              const winArgs = [winHermes, 'chat', '-q', fullText, '--max-turns', '60', '--source', 'tool'];
              const winPlatformSid = getLatestPlatformSession(winRoleId);
              if (winPlatformSid || ROLE_SESSIONS[winRoleId]) { winArgs.push('--resume', winPlatformSid || ROLE_SESSIONS[winRoleId]); }
              const child = spawn(winPython, winArgs, {
                env: { ...process.env, PYTHONPATH: path.join(engineDir, 'libs'), PYTHONHOME: '', HERMES_HOME: path.join(engineDir, '.hermes', 'agents', role || 'dami') }
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
              const sidMatch = cliResult.stdout.match(/Session:\s+(\S+)/);
              if (sidMatch) ROLE_SESSIONS[winRoleId] = sidMatch[1];
              const cliCreditsUsed = Math.max(1, Math.ceil((fullText.length + responseText.length) / 500));
              try {
                await httpPost(`${SERVER_URL}/api/credits/deduct?device_id=${getDeviceId()}`,
                  JSON.stringify({ credits: cliCreditsUsed, model: 'deepseek-v4-pro' }));
              } catch (_) { /* 积分报告失败不影响主流程 */ }
              return { requestId, success: true, output: responseText.slice(0, 8000), offline: true, sessionId: ROLE_SESSIONS[roleId] || null };
            } catch (e) {
              return { requestId, success: false, output: `执行失败：${e.message}`, sessionId: ROLE_SESSIONS[roleId] || null };
            }
          }
          // macOS/Linux: 使用 Agent Python + PYTHONPATH 确保依赖齐全
          if (!isWindows) {
            const engineDir = getEngineDir();
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
            const platformSessionId = getLatestPlatformSession(roleId);
            const resumeId = platformSessionId || ROLE_SESSIONS[roleId];
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
              // 提取会话 ID，下次同一角色续接上下文
              const sidMatch = cliResult.stdout.match(/Session:\s+(\S+)/);
              if (sidMatch) ROLE_SESSIONS[roleId] = sidMatch[1];
              const cliCreditsUsed = Math.max(1, Math.ceil((fullText.length + responseText.length) / 500));
              try {
                await httpPost(`${SERVER_URL}/api/credits/deduct?device_id=${getDeviceId()}`,
                  JSON.stringify({ credits: cliCreditsUsed, model: 'deepseek-v4-pro' }));
              } catch (_) { /* 积分报告失败不影响主流程 */ }
              return { requestId, success: true, output: responseText.slice(0, 8000), offline: true, sessionId: ROLE_SESSIONS[roleId] || null };
            } catch (e) {
              return { requestId, success: false, output: `执行失败：${e.message}`, sessionId: ROLE_SESSIONS[roleId] || null };
            }
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
            const postData = JSON.stringify({ model: 'deepseek-v4-pro', messages: chatMessages, stream: true, max_tokens: 4096 });
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
              if (sid) ROLE_SESSIONS[roleId] = sid;
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
          // 积分扣减：Gateway 直连 DeepSeek，需主动报告用量
          const estimatedCredits = Math.max(1, Math.ceil((fullText.length + gwResponseText.length) / 500));
          try {
            await httpPost(`${SERVER_URL}/api/credits/deduct?device_id=${getDeviceId()}`,
              JSON.stringify({ credits: estimatedCredits, model: 'deepseek-v4-pro' }));
          } catch (_) { /* 积分报告失败不影响主流程 */ }
          return { requestId, success: true, output: gwResponseText, offline: false, sessionId: ROLE_SESSIONS[roleId] || null };
        } catch (e) {
          return { requestId, success: false, output: `执行失败：${e.message}`, sessionId: ROLE_SESSIONS[roleId] || null };
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
      const roleName = (loadRoles()[r.role] || {}).name || r.role;
      return `### ${roleName}\n${r.output}`;
    }).join('\n\n---\n\n');

    return { requestId: 'req_' + Date.now(), success: true, output: finalOutput, pipeline: results, sessionId: ROLE_SESSIONS[roleId] || null };
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
    const allTasks = [];
    // 查询主引擎 + 所有角色 Gateway 的定时任务
    const hermesHomes = [path.join(getEngineDir(), '.hermes')];
    const roleConfigs = getPlatformRoleConfigs();
    for (const cfg of roleConfigs) {
      hermesHomes.push(path.join(getEngineDir(), '.hermes', 'agents', cfg.roleId));
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
    const engineDir = getEngineDir();
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
    const gatewayPath = path.join(homeDir, '.hermes', 'gateway_state.json');
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        if (fs.existsSync(gatewayPath)) {
          const state = JSON.parse(fs.readFileSync(gatewayPath, 'utf-8'));
          const platform = state.platforms && state.platforms[channel];
          if (platform && platform.state === 'connected') {
            connectStatus = 'connected';
            break;
          }
        }
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

// ===== 飞书消息注入到 CLI 会话（共享上下文）=====
ipcMain.handle('chat:inject-message', async (event, roleId, message, cliSessionId) => {
  try {
    if (!cliSessionId) return { success: false, error: 'No CLI session ID' };
    const engineDir = getEngineDir();
    const sessionsDir = path.join(engineDir, '.hermes', 'agents', roleId, 'sessions');
    const sessionFile = path.join(sessionsDir, `session_${cliSessionId}.json`);
    if (!fs.existsSync(sessionFile)) return { success: false, error: 'Session file not found' };

    // 直接写 JSON：追加用户消息到 messages 数组（不触发AI处理）
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    session.messages = session.messages || [];
    session.messages.push({ role: 'user', content: `📱 来自飞书: ${message}` });
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
    const engineDir = getEngineDir();
    const messages = [];

    // 检查所有可能的 sessions 目录：主 Gateway + 每个角色 Gateway
    const sessionDirs = [path.join(engineDir, '.hermes', 'sessions')];
    const feishuConfigs = getFeishuRoleConfigs();
    for (const cfg of feishuConfigs) {
      sessionDirs.push(path.join(engineDir, '.hermes', 'agents', cfg.roleId, 'sessions'));
    }

    for (const sessionsDir of sessionDirs) {
      const indexPath = path.join(sessionsDir, 'sessions.json');
      if (!fs.existsSync(indexPath)) continue;

      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      for (const [sessionKey, meta] of Object.entries(index)) {
        if (meta.platform !== 'feishu' && meta.platform !== 'lark') continue;

        const sessionFile = path.join(sessionsDir, `session_${meta.session_id}.json`);
        if (!fs.existsSync(sessionFile)) continue;

        const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        const lastIdx = _feishuLastSeen[sessionKey] || -1;
        const newMsgs = (session.messages || []).slice(lastIdx + 1);

        if (newMsgs.length > 0) {
          _feishuLastSeen[sessionKey] = (session.messages || []).length - 1;
          // 从 sessionKey 或目录路径推断角色
          let roleId = 'dami';
          for (const cfg of feishuConfigs) {
            if (sessionsDir.includes(cfg.roleId)) { roleId = cfg.roleId; break; }
          }
          for (const msg of newMsgs) {
            let content = (msg.content || '').trim();
            if (!content) continue;
            // 跳过纯系统提示词消息
            if (content.length > 100 && content.includes('你是') && content.includes('擅长') && content.includes('风格')) continue;
            // 如果消息是 "系统提示词\n\n用户消息：xxx" 格式，只取用户消息部分
            const userMsgMatch = content.match(/用户消息[：:]\s*(.+)$/s);
            if (userMsgMatch) content = userMsgMatch[1].trim().slice(0, 1000);
            messages.push({
              role: msg.role === 'user' ? 'user' : 'hermes',
              text: content.slice(0, 1000),
              time: session.last_updated || new Date().toISOString(),
              platform: '飞书',
              sessionKey,
              roleId,
              chatName: meta.display_name || meta.origin?.user_name || '飞书用户'
            });
          }
        }
      }
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
  const tmpFile = `/tmp/hergent-update.tar.gz`;
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

// activation:server-activate 已移除 — 产品改为积分制，激活/鉴权走 /api/credits + deviceId

// ===== IPC: 查询积分余额（调用 Hermes Server API）=====
ipcMain.handle('activation:credits', async () => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/credits?device_id=${getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) {
    console.error(`[credits] error: ${e.message}`);
    return { credits: 0, message: '无法连接服务' };
  }
});

ipcMain.handle('billing:history', async () => {
  try {
    const body = await httpGet(`${SERVER_URL}/api/billing/history?device_id=${getDeviceId()}`);
    return JSON.parse(body);
  } catch (e) { return { recharges: [], usage: [], balance: 0 }; }
});

// 打开外部链接
ipcMain.handle('shell:open', async (event, url) => {
  require('electron').shell.openExternal(url);
  return true;
});

// ===== 窗口控制 =====
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
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
    const dsKey = getDeepSeekApiKey();
    set('model.name', 'deepseek-v4-pro');
    set('model.provider', 'hergent');
    set('platforms.api_server.enabled', 'true');
    set('platforms.api_server.port', '18765');
    set('max_turns', '60');
    set('custom_providers.0.name', 'hergent');
    set('custom_providers.0.base_url', `${SERVER_URL}/v1`);
    set('custom_providers.0.api_key', dsKey);
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
  if (_cancelFn) {
    try { _cancelFn(); } catch (_) {}
    _cancelFn = null;
  }
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
// ---- 模型配置（通过 hermes config set 切换）----
ipcMain.handle('config:get-model', async () => {
  try {
    const engineDir = getEngineDir();
    const configPath = path.join(engineDir, '.hermes', 'config.yaml');
    if (!fs.existsSync(configPath)) return { model: 'deepseek-v4-pro', provider: 'hergent' };
    const yaml = fs.readFileSync(configPath, 'utf8');
    const result = { model: '', provider: '' };
    const modelMatch = yaml.match(/^model:\s*\n(?:\s+name:\s*(.+)\s*\n\s+provider:\s*(.+)|)/m);
    if (modelMatch) {
      result.model = (modelMatch[1] || 'deepseek-v4-pro').trim();
      result.provider = (modelMatch[2] || 'hergent').trim();
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
          model: (model && model[1]) ? model[1].trim() : 'deepseek-v4-pro',
        });
      }
      result.custom_providers = providers;
    }
    return result;
  } catch (e) { return { model: 'deepseek-v4-pro', provider: 'hergent', error: e.message }; }
});

ipcMain.handle('config:set-model', async (event, opts) => {
  try {
    const engineDir = getEngineDir();
    const engineHermesHome = path.join(engineDir, '.hermes');
    const agentHermesHome = path.join(homeDir, '.hermes');

    // 同时更新引擎和 Agent 的 config（取决于 Gateway 实际用哪个）
    for (const hh of [engineHermesHome, agentHermesHome]) {
      if (!fs.existsSync(path.join(hh, 'config.yaml'))) continue;
      const cfgEnv = { ...process.env, HERMES_HOME: hh };
      const set = (k, v) => spawnSync(HERMES_BIN, ['config', 'set', k, v], { timeout: 5000, env: cfgEnv });
    if (opts.model) {
      set('model.name', opts.model);
      // 同步更新对应 provider 的 custom_providers model
      const providerIdx = opts.provider === 'bailian' ? '1' : '0';
      set(`custom_providers.${providerIdx}.model`, opts.model);
    }
    if (opts.provider) set('model.provider', opts.provider);
    if (opts.custom_base_url) {
      set('custom_providers.0.name', opts.provider || 'custom');
      // 自定义模型走积分代理（localhost:8765/v1），真 API 地址存到积分服务
      set('custom_providers.0.base_url', `${SERVER_URL}/v1`);
      set('custom_providers.0.api_key', opts.custom_api_key || '');
      set('custom_providers.0.model', opts.model || 'deepseek-v4-pro');
      // 同步自定义 API 信息到积分服务
      try {
        const http = require('http');
        const postData = JSON.stringify({ base_url: opts.custom_base_url, api_key: opts.custom_api_key || '', model_name: opts.model || '' });
        const req = http.request({ hostname: 'localhost', port: 8765, path: '/api/custom-model/config', method: 'POST', headers: { 'Content-Type': 'application/json' } });
        req.write(postData);
        req.end();
      } catch (_) {}
    }
    }
    // 同步模型到所有角色 config（整段替换 model section）
    const allRoles = loadRoles();
    for (const [roleId] of Object.entries(allRoles)) {
      const roleCfgPath = path.join(engineDir, '.hermes', 'agents', roleId, 'config.yaml');
      if (!fs.existsSync(roleCfgPath)) continue;
      try {
        let rc = fs.readFileSync(roleCfgPath, 'utf8');
        if (opts.model) {
          const m = rc.match(/^  name:\s*(.+)/m);  // 读取当前 name
          const p = rc.match(/^  provider:\s*(.+)/m);  // 读取当前 provider
          const curModel = (m && m[1]) ? m[1].trim() : 'deepseek-v4-pro';
          const curProvider = (p && p[1]) ? p[1].trim() : 'hergent';
          const newModel = opts.model;
          const newProvider = opts.provider || curProvider;
          rc = rc.replace(
            /^model:\n(\s+name: .+\n)(\s+provider: .+\n)?(\s+base_url: .+\n)?(\s+default: .+\n)?/m,
            'model:\n  name: ' + newModel + '\n  provider: ' + newProvider + '\n'
          );
          rc = rc.replace(
            /^(\s*-?\s*name: hergent\n\s+base_url: .+\n\s+)api_key: .+(\n\s+model: ).+/m,
            '$1api_key: hermes_' + getDeviceId() + '$2' + newModel
          );
          rc = rc.replace(
            /^(\s*-?\s*name: bailian\n\s+base_url: .+\n\s+)api_key: .+/m,
            '$1api_key: hermes_' + getDeviceId()
          );
        }
        if (!rc.includes('- name: bailian')) {
          rc = rc.replace(
            /(  - name: hergent\n    base_url: .+\n    api_key: .+\n    model: .+)/,
            '$1\n  - name: bailian\n    base_url: ' + `${SERVER_URL}/v1` + '\n    api_key: hermes_' + getDeviceId() + '\n    model: qwen3-max'
          );
        }
        fs.writeFileSync(roleCfgPath, rc);
      } catch (_) {}
    }
    // 强制重启 Gateway 使模型变更生效
    stopHermesGateway();
    // 兜底：杀干净所有残留 gateway 进程
    try { execSync('pkill -9 -f "gateway run"', { timeout: 5000 }); } catch (_) {}
    await new Promise(r => setTimeout(r, 3000));
    await startHermesGateway();
    const ready = await waitForGateway(90000);
    return { success: ready };
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

ipcMain.handle('app:version', () => CURRENT_VERSION);
app.on('window-all-closed', () => { stopCreditsServer(); stopHermesGateway(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
