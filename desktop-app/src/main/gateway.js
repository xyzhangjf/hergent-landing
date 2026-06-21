// Hergent Desktop — Hermes Gateway lifecycle
const path = require("path");
const fs = require("fs");
const { execSync, spawn, spawnSync } = require("child_process");
const { net } = require("electron");
const crypto = require("crypto");

const {
  GATEWAY_PORT, GATEWAY_URL, isWindows, HERMES_CMD,
  SERVER_URL, PLATFORM_DEFS, ROLE_SKILLS, homeDir,
} = require("./constants");
const logger = require("./logger");

let GATEWAY_API_KEY = "";
let _engine = null;
let _roles = null;
let _licenses = null;

function init(apiKey, engineMod, rolesMod, licenseMod) {
  GATEWAY_API_KEY = apiKey;
  _engine = engineMod;
  _roles = rolesMod;
  _licenses = licenseMod;
}

const _roleGateways = [];
const ROLE_SESSIONS = {};

// Config path helper (injected by main.js)
let _configPathFn = null;
function setConfigPath(fn) { _configPathFn = fn; }

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
// 获取角色最近的平台 session ID（飞书等），用于 App 聊天与平台共享上下文
function getLatestPlatformSession(roleId) {
  try {
    const engineDir = engine._engine.getEngineDir();
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
    const cp = _configPathFn();
    if (!fs.existsSync(cp)) return configs;
    const channels = JSON.parse(fs.readFileSync(cp, 'utf8'));
    const roles = rolesMgr._roles.loadRoles();
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
  // 先停掉旧的角色 Gateway（内存追踪 + 进程名精确匹配）
  for (const rg of _roleGateways) {
    try { rg.process.kill(); } catch (_) {}
  }
  _roleGateways.length = 0;
  const engineDir = engine._engine.getEngineDir();
  for (const cfg of configs) {
    const roleHome = path.join(engineDir, '.hermes', 'agents', cfg.roleId);
    if (!fs.existsSync(roleHome)) { fs.mkdirSync(roleHome, { recursive: true }); }
    // 确保角色 Gateway 有正确格式的 config.yaml（直接写 YAML，v0.15.x 要求列表格式）
    const roleConfigPath = path.join(roleHome, 'config.yaml');
    const mainConfigPath = path.join(engineDir, '.hermes', 'config.yaml');
    let currentModel = 'deepseek-v4-flash';
    let currentProvider = 'openai';
    try {
      if (fs.existsSync(mainConfigPath)) {
        const mainCfg = fs.readFileSync(mainConfigPath, 'utf8');
        const mn = mainCfg.match(/^model:\s*\n\s+name:\s*(.+)/m);
        const mp = mainCfg.match(/^model:\s*\n\s+provider:\s*(.+)/m);
        if (mn) currentModel = mn[1].trim();
        if (mp) currentProvider = mp[1].trim();
      }
    } catch (_) {}
    const deviceId = licenses._licenses.getDeviceId();
    const roleYamlLines = [
      'model:',
      '  name: ' + currentModel,
      '  provider: openai',
    ];
    // 将平台凭据写入 config YAML（飞书/企微/钉钉/QQ 都需要 YAML 中有对应 section）
    if (cfg.platform === 'feishu' && cfg.creds.app_id) {
      roleYamlLines.push(
        'feishu:',
        '  app_id: ' + cfg.creds.app_id,
        '  app_secret: ' + cfg.creds.app_secret,
        '  enabled: true'
      );
    }
    if (cfg.platform === 'wecom' && cfg.creds.bot_id) {
      roleYamlLines.push(
        'wecom:',
        '  bot_id: ' + cfg.creds.bot_id,
        '  secret: ' + cfg.creds.secret,
        '  enabled: true'
      );
    }
    roleYamlLines.push(
      'custom_providers:',
      '  - name: openai',
      '    base_url: ' + SERVER_URL + '/v1',
      '    api_key: hermes_' + deviceId,
      '    model: ' + currentModel,
      'memory:',
      '  memory_enabled: true',
      `  memory_dir: ${path.join(roleHome, 'memories')}`,
      'session:',
      `  sessions_dir: ${path.join(roleHome, 'sessions')}`,
      'terminal:',
      `  cwd: ${path.join(roleHome, 'workspace')}`,
      '',
    );
    const roleYaml = roleYamlLines.join('\n');
    try {
      fs.writeFileSync(roleConfigPath, roleYaml);
      fs.writeFileSync(path.join(roleHome, '.env'), 'OPENAI_API_KEY=hermes-local-proxy\n');
    } catch (_) {}
    glog(`Starting ${cfg.label} gateway for role ${cfg.roleId} (${cfg.name})...`);
    try {
      // Windows/macOS 统一用 python -m hermes_cli.main 启动角色 Gateway
      // Windows 需要把 python/ 目录加到 PATH 中，确保 python.exe 能找到其 DLL 依赖
      const roleEnv = { ...process.env, HOME: homeDir, HERMES_HOME: roleHome, HERMES_CONFIG_PATH: roleConfigPath,
             ...cfg.envVars,
             API_SERVER_ENABLED: 'false', GATEWAY_ALLOW_ALL_USERS: 'true',
             PYTHONPATH: libsDir, PYTHONHOME: '' };
      if (isWindows) {
        roleEnv.PATH = `${path.dirname(pythonBin)};${path.join(path.dirname(pythonBin), 'Scripts')};${process.env.PATH || ''}`;
        roleEnv.PYTHONUTF8 = '1';
      }
      const roleProc = spawn(pythonBin, ['-m', 'hermes_cli.main', 'gateway', 'run', '--replace'], {
        env: roleEnv,
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      });
      roleProc.unref();
      roleProc.on("error", (err) => { glog(`Role GW ${cfg.roleId}/${cfg.platform} SPAWN ERROR: ` + err.message); logger.reportCriticalError("gateway-roles", err, { roleId: cfg.roleId, platform: cfg.platform }); });
      roleProc.on('exit', (code, sig) => { glog(`Role GW ${cfg.roleId}/${cfg.platform} exited code=${code} sig=${sig}`); });
      _roleGateways.push({ roleId: cfg.roleId, platform: cfg.platform, process: roleProc, home: roleHome });
      glog(`Role GW ${cfg.roleId}/${cfg.platform} spawned OK`);
    } catch(e) {
      glog(`Role GW ${cfg.roleId}/${cfg.platform} spawn exception: ` + e.message);
    }
  }
}
async function startHermesGateway() {
  const engineDir = engine._engine.getEngineDir();
  const gwHome = path.join(engineDir, '.hermes');
  const gf = path.join(gwHome, 'app_debug.log');
  const glog = (msg) => { try { fs.appendFileSync(gf, `[${new Date().toISOString()}] GW: ${msg}\n`); } catch(_) {} };
  glog(`startHermesGateway called, HERMES_BIN=${HERMES_BIN}, isWindows=${isWindows}`);
  if (!fs.existsSync(HERMES_BIN)) {
    glog('HERMES_BIN not found');
    return false;
  }
  engine.ensureSharedState();
  engine.ensureRoleConfigs();
  engine.markEngineReady();
  const isRunning = await isGatewayRunning();
  if (!isRunning) {
  // 直接写 YAML（v0.15.x 要求 custom_providers 必须为列表格式，hermes config set 却写字典格式）
  const mainConfigPath = path.join(gwHome, 'config.yaml');
  try {
    const deviceId = licenses._licenses.getDeviceId();
    const dsKey = licenses._licenses.getDeepSeekApiKey();
    const existingModel = (() => { try { const c = fs.readFileSync(mainConfigPath, 'utf8'); const m = c.match(/^model:\s*\n\s+name:\s*(.+)/m); return m ? m[1].trim() : null; } catch(_) { return null; } })();
    const modelName = existingModel || 'deepseek-v4-flash';
    const provider = 'openai';
    const apiKeyId = 'hermes_' + deviceId;
    const configYaml = [
      'model:',
      '  name: ' + modelName,
      '  provider: ' + provider,
      'platforms:',
      '  api_server:',
      '    enabled: true',
      '    port: ' + GATEWAY_PORT,
      '    key: ' + GATEWAY_API_KEY,
      'custom_providers:',
      '  - name: openai',
      '    base_url: ' + SERVER_URL + '/v1',
      '    api_key: ' + apiKeyId,
      '    model: ' + modelName,
      'memory:',
      '  memory_enabled: true',
      '  memory_char_limit: 12000',
      '  user_char_limit: 8000',
      '  flush_min_turns: 6',
      '  nudge_interval: 10',
      '',
    ].join('\n');
    // 如果已有配置，仅更新 model.name/provider 和 custom_providers，保留其他
    let finalYaml = configYaml;
    try {
      if (fs.existsSync(mainConfigPath)) {
        let existing = fs.readFileSync(mainConfigPath, 'utf8');
        // 替换或插入 model section
        if (existing.match(/^model:/m)) {
          existing = existing.replace(
            /^model:\n(\s+name: .+\n)(\s+provider: .+\n)?(\s+base_url: .+\n)?(\s+default: .+\n)?/m,
            'model:\n  name: ' + modelName + '\n  provider: ' + provider + '\n'
          );
        } else {
          // 没有 model section → 在开头插入
          existing = 'model:\n  name: ' + modelName + '\n  provider: ' + provider + '\n' + existing;
        }
        // 替换或插入 custom_providers
        if (existing.match(/^custom_providers:/m)) {
          existing = existing.replace(
            /^custom_providers:\n(?:  - name: .+\n    base_url: .+\n    api_key: .+\n    model: .+\n?)*/m,
            'custom_providers:\n  - name: openai\n    base_url: ' + SERVER_URL + '/v1\n    api_key: ' + apiKeyId + '\n    model: ' + modelName + '\n'
          );
        } else {
          existing += '\ncustom_providers:\n  - name: openai\n    base_url: ' + SERVER_URL + '/v1\n    api_key: ' + apiKeyId + '\n    model: ' + modelName + '\n';
        }
        finalYaml = existing;
      }
    } catch (_) {}
    // 移除平台相关配置（飞书/企微/钉钉/QQ等），这些由角色独立 Gateway 处理
    // 主 Gateway 只负责 API Server + 模型代理，否则平台消息会被重复回复
    finalYaml = finalYaml
      .replace(/^(feishu|wecom|wecom_bot|dingtalk|qq|telegram|discord|slack|whatsapp|signal|teams|line):[\s\S]*?(?=^\w+:|^\Z)/gm, '')
      .replace(/^\s*\n/gm, '');
    fs.writeFileSync(mainConfigPath, finalYaml);
    // v0.15.x requires OPENAI_API_KEY in .env for openai provider
    try { fs.writeFileSync(path.join(gwHome, '.env'), 'OPENAI_API_KEY=hermes-local-proxy\n'); } catch (_) {}
  } catch(e) {
    glog('config write error: ' + e.message);
  }
  // Windows: hermes.bat 需要通过 shell 启动（cmd.exe /c）
  if (isWindows) {
    const gatewayLogFile = path.join(gwHome, 'gateway_stderr.log');
    glog(`Windows: spawning: ${HERMES_BIN} gateway run`);
    try {
      gatewayProcess = spawn(HERMES_BIN, ['gateway', 'run', '--replace'], {
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, PYTHONUTF8: '1', HERMES_HOME: gwHome, HERMES_CONFIG_PATH: mainConfigPath, API_SERVER_PORT: String(GATEWAY_PORT), API_SERVER_ENABLED: 'true', API_SERVER_KEY: GATEWAY_API_KEY, GATEWAY_ALLOW_ALL_USERS: 'true' },
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: true,
        windowsHide: true
      });
      const stderrStream = fs.createWriteStream(gatewayLogFile, { flags: 'a' });
      gatewayProcess.stderr.pipe(stderrStream);
      gatewayProcess.unref();
      gatewayProcess.on("error", (err) => { glog("SPAWN ERROR: " + err.message); logger.reportCriticalError("gateway", err, { platform: process.platform }); });
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
        gatewayProcess.on("error", (err) => { glog("SPAWN ERROR: " + err.message); logger.reportCriticalError("gateway", err, { platform: process.platform }); });
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
        gatewayProcess.on("error", (err) => { glog("SPAWN ERROR: " + err.message); logger.reportCriticalError("gateway", err, { platform: process.platform }); });
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
  const pythonCandidates2 = isWindows
    ? [path.join(binDir2, 'python', 'python.exe')]
    : [
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
  // 清理所有使用本引擎目录的 gateway 进程（精确匹配引擎路径，避免误杀 QClaw 等）
  const engineDir = engine._engine.getEngineDir();
  if (process.platform === 'darwin' || process.platform === 'linux') {
    // 精确匹配：只杀使用本机当前用户引擎 Python 的 gateway 进程（不误伤其他用户/QClaw）
    try { execSync(`pkill -f "${engineDir}/python/bin/python3.11.*gateway run"`, { timeout: 5000 }); } catch (_) {}
  } else {
    try { execSync('taskkill /F /IM python3.11.exe /FI "WINDOWTITLE eq gateway run"', { timeout: 5000 }); } catch (_) {}
  }
}

module.exports = {
  init, setConfigPath,
  getProcess: () => gatewayProcess,
  getRoleGateways: () => _roleGateways,
  getRoleSessions: () => ROLE_SESSIONS,
  isGatewayRunning, waitForGateway,
  getPlatformEnvVars, getLatestPlatformSession,
  getPlatformRoleConfigs, getFeishuRoleConfigs,
  spawnRoleGateways, startHermesGateway, stopHermesGateway,
};
