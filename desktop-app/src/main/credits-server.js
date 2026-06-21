// Hergent Desktop — Credits/Payment Server
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const { isWindows, homeDir } = require("./constants");
const logger = require("./logger");

let _engineDir = null;

function init(engineDirFn) { _engineDir = engineDirFn; }

let serverProcess = null;

function getServerProcess() { return serverProcess; }

function startCreditsServer(app) {
  const candidates = [
    path.join(__dirname, "..", "..", "server.py"),
    path.join(app.getPath("home"), "Documents", "laozhangai-product", "server", "server.py"),
  ];
  let scriptPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) { scriptPath = c; break; }
  }
  if (!scriptPath) {
    logger.startup('startCreditsServer: server.py NOT FOUND, skipping');
    console.log('[credits-server] server.py not found, skipping');
    return;
  }
  logger.startup(`startCreditsServer: found server.py at ${scriptPath}`);
  // 优先用引擎自带的 Python（libs 里有 fastapi/uvicorn/httpx 等全套依赖）
  const home = app.getPath('home');
  const engineDir = _engineDir ? _engineDir() : path.join(app.getPath("userData"), "hermes-engine");
  const agentPython = isWindows
    ? path.join(home, '.hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe')
    : path.join(home, '.hermes', 'hermes-agent', 'python', 'bin', 'python3.11');
  const agentVenvPython = isWindows
    ? path.join(home, '.hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe')
    : path.join(home, '.hermes', 'hermes-agent', 'venv', 'bin', 'python3.11');
  const enginePython = isWindows
    ? path.join(engineDir, 'python', 'python.exe')
    : path.join(engineDir, 'python', 'bin', 'python3.11');
  const agentLibs = path.join(home, '.hermes', 'hermes-agent', 'libs');
  const engineLibs = path.join(engineDir, 'libs');
  let pythonPath = isWindows ? 'python' : 'python3';
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
  if (!deepseekKey || deepseekKey === 'hermes-local-proxy') deepseekKey = '';
  console.log(`[credits-server] Starting: ${pythonPath} ${scriptPath}`);
  const spawnEnv = { ...process.env, PYTHONUNBUFFERED: '1', DEEPSEEK_API_KEY: deepseekKey, BAILIAN_API_KEY: '' };
  if (pythonLibs) {
    spawnEnv.PYTHONPATH = pythonLibs;
    spawnEnv.PYTHONHOME = '';
  }
  serverProcess = spawn(pythonPath, [scriptPath], { env: spawnEnv });
  logger.startup(`startCreditsServer: spawned, pid=${serverProcess.pid}, python=${pythonPath}`);
  serverProcess.on("error", (err) => {
    logger.reportCriticalError("credits-server", err, { pythonPath });
  });
  serverProcess.stdout?.on('data', d => console.log(`[credits-server] ${d.toString().trim()}`));
  serverProcess.stderr?.on('data', d => console.error(`[credits-server] ${d.toString().trim()}`));
}
function stopCreditsServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    console.log("[credits-server] stopped");
  }
}

module.exports = { startCreditsServer, stopCreditsServer, getServerProcess };
