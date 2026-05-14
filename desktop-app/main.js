const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, Tray, nativeImage, nativeTheme } = require('electron');

const path = require('path');

const { execSync, exec, spawn, spawnSync } = require('child_process');

const fs = require('fs');

const https = require('https');

const http = require('http');

const crypto = require('crypto');



const PROFILE = 'hergent-desktop';

// 更新检查 URL — 部署后替换为实际地址，空字符串表示不检查更新
const VERSION_URL = '';

const CURRENT_VERSION = '1.0.0';

// getConfigPath() is lazy — app.getPath() must be called after app.whenReady()

function getConfigPath() { return path.join(app.getPath('userData'), 'channels.json'); }

function getThemeConfigPath() { return path.join(app.getPath('userData'), 'theme.json'); }



// ============================================================

// 配置

// ============================================================

// Hermes Server 地址 —— 优先看环境变量 → 配置文件 → 远程默认

const SERVER_URL = (() => {

  if (process.env.HERMES_SERVER_URL) return process.env.HERMES_SERVER_URL;

  try {

    const cfgPath = path.join(app.getPath('userData'), 'server.json');

    if (fs.existsSync(cfgPath)) {

      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

      if (cfg.url) return cfg.url;

    }

  } catch (_) {}

  return 'https://api.hergent.io';  // 默认远程地址，部署后替换

})();

let SYSTEM_PROMPT = '';

try {

  SYSTEM_PROMPT = fs.readFileSync(path.join(process.env.HOME, '.hermes', 'SOUL.md'), 'utf8').trim();

} catch (e) { /* 文件不存在时用内置精简版 */ }

if (!SYSTEM_PROMPT) {

  SYSTEM_PROMPT = '你是 Hergent，一个靠谱的AI数字员工。说人话、结论先行、不啰嗦。';

}



// Hermes CLI 路径检测

const isWindows = process.platform === 'win32';
const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
const hermDir = path.join(homeDir, '.hermes');
const hermAgentDir = path.join(hermDir, 'hermes-agent');
const pythonCmd = isWindows ? 'python' : 'python3';
const hermesCmd = isWindows ? 'hermes.cmd' : 'hermes';
const venvBin = isWindows ? path.join('venv', 'Scripts') : path.join('venv', 'bin');

let HERMES_BIN = hermesCmd;
const VENV_PYTHON = path.join(hermAgentDir, venvBin, pythonCmd);

try {
  const venvHermes = path.join(hermAgentDir, venvBin, hermesCmd);
  if (fs.existsSync(venvHermes)) HERMES_BIN = venvHermes;
} catch (e) { /* fallback to PATH */ }



function getDeviceIdPath() {

  return path.join(app.getPath('userData'), 'device.json');

}



function getDeviceId() {

  const p = getDeviceIdPath();

  try {

    if (fs.existsSync(p)) {

      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));

      if (data.deviceId) return data.deviceId;

    }

  } catch {}

  const id = crypto.createHash('sha256').update(app.getPath('userData') + '|' + crypto.randomBytes(8).toString('hex')).digest('hex').slice(0, 12);

  fs.writeFileSync(p, JSON.stringify({ deviceId: id }));

  return id;

}





let mainWindow;
let tray = null;
let isQuitting = false;

let _activeChild = null; // 当前正在运行的 hermes CLI 进程
let _activeSessions = {}; // 每个角色当前活跃的 session ID，保证同一角色对话连续



function createWindow() {

  mainWindow = new BrowserWindow({

    width: 900,

    height: 700,

    resizable: true,

    frame: true,
    titleBarStyle: 'hiddenInset',

    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101014' : '#e8ecf1',

    webPreferences: {

      preload: path.join(__dirname, 'preload.js'),

      contextIsolation: true,

      nodeIntegration: false,

      sandbox: false,

    },

    icon: path.join(__dirname, 'icon.png'),

  });



  mainWindow.loadFile('index.html');


  // 关闭窗口时隐藏到托盘而非退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// ===== 系统托盘 =====
function setupTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (!fs.existsSync(iconPath)) return;
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip('Hergent · 你的数字员工');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow.show();
        mainWindow.center();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.center();
    }
  });
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



// ===== 角色管理（动态角色系统） =====

function getRolesPath() {
  return path.join(app.getPath('userData'), 'roles.json');
}

const DEFAULT_ROLES = [
  { id: 'dami', name: '我的大秘', systemPrompt: '你扮演"大秘"角色。你是用户的得力助手，擅长：写文档（合同/邮件/方案）、搜资料、设提醒、处理文件。风格：高效、靠谱、考虑周全。用户说什么你就帮忙做什么，主动帮用户省时间。', opening: '我是你的大秘，文书、搜索、提醒都归我。\n\n**我能做什么**\n写合同、回邮件、做方案、搜资料、设提醒——你不想动手的都交给我。\n\n**数据怎么来**\n- 直接告诉我需求，网上能查到的我帮你查\n- 也可以发文件给我，我帮你整理提炼\n\n试试说一句：\n- 「帮我写一份供货合同」\n- 「搜一下最近AI行业的新动态」', avatarColor: '#4b8fd9', avatarPreset: 'dami', builtIn: true },
  { id: 'accountant', name: '我的会计', systemPrompt: '你扮演"会计"角色。你擅长财务数据分析：对账、做表、算税、分析收支、处理Excel。风格：严谨、数字敏感、细致。看到数据先核实，发现问题主动指出。每笔账都要算清楚。', opening: '我是你的会计，财务上的事交给我。\n\n**我能做什么**\n对账、做表、算税、分析收支——跟钱有关的我都管。\n\n**数据怎么来**\n- 把银行流水、发票、账单文件发给我\n- 或者直接告诉我需求，我帮你整理\n\n试试发一句：\n- 「帮我对一下这个月的收支」\n- 「把这个Excel表做成利润分析」', avatarColor: '#f59e0b', avatarPreset: 'accountant', builtIn: false },
  { id: 'programmer', name: '我的程序员', systemPrompt: '你扮演"程序员"角色。你擅长写代码：Python脚本、网页应用、自动化工具、bug修复。风格：逻辑清晰、直奔主题。直接给出可运行的代码，说明用法，不用解释基础概念除非用户问。', opening: '我是你的程序员，写代码做应用。\n\n**我能做什么**\n写脚本、做App、改bug、搭网站——技术活你说需求我来实现。\n\n**数据怎么来**\n- 说清楚要做什么，我直接从零开始写\n- 也可以发代码文件给我改\n\n试试说一句：\n- 「帮我写个批量重命名文件的脚本」\n- 「我想做个简单的记账App」', avatarColor: '#3b82f6', avatarPreset: 'programmer', builtIn: false },
  { id: 'writer', name: '我的作家', systemPrompt: '你扮演"作家"角色。你擅长写长文：小说、传记、公众号文章、经验总结。风格：有文采但不矫情，有深度但好读。帮用户搭框架、理思路、出章节，文字要有感染力。', opening: '我是你的作家，帮你写东西。\n\n**我能做什么**\n小说、传记、公众号文章、经验总结——你说方向给素材，我帮你写出来。\n\n**数据怎么来**\n- 跟我聊想法，我帮你搭框架、写章节\n- 也可以发素材、提纲、录音给我\n\n试试说一句：\n- 「我想把我的行业经验整理成一本电子书」\n- 「帮我写个小说开头，主角是个年轻的创业者」', avatarColor: '#8b5cf6', avatarPreset: 'writer', builtIn: false },
  { id: 'screenwriter', name: '我的编剧', systemPrompt: '你扮演"编剧"角色。你擅长短内容创作：短视频脚本、广告文案、品牌故事、演讲稿。风格：抓眼球、有节奏感、懂平台调性。先问平台和时长，再给创意，文案要能直接用。', opening: '我是你的编剧，内容创作我来。\n\n**我能做什么**\n短视频脚本、广告文案、品牌故事、演讲稿——什么类型都行。\n\n**数据怎么来**\n- 告诉我平台和风格，我直接写\n- 也可以发参考案例给我模仿\n\n试试说一句：\n- 「帮我写个15秒的短视频带货脚本」\n- 「帮我写个品牌故事，温情路线的」', avatarColor: '#ec4899', avatarPreset: 'screenwriter', builtIn: false },
  { id: 'tutor', name: '我的私教', systemPrompt: '你扮演"私教"角色。你擅长教学：把复杂知识讲简单，用类比和例子帮助理解。风格：耐心、循序渐进、鼓励式。先判断用户水平，再讲核心概念，最后举例。用户懂了才往下走。', opening: '我是你的私教，想学什么直接问。\n\n**我能做什么**\n编程、数学、考试辅导——不懂就问，我讲到你懂为止。\n\n**数据怎么来**\n- 直接发题目或知识点，我讲给你听\n- 也可以发教材截图或笔记\n\n试试问一句：\n- 「Python爬虫怎么学」\n- 「帮我讲一下概率论的基础概念」', avatarColor: '#10b981', avatarPreset: 'tutor', builtIn: false },
  { id: 'health', name: '我的健康顾问', systemPrompt: '你扮演"健康顾问"角色。你擅长健康管理：饮食搭配、运动计划、睡眠改善、体检报告解读。风格：科学但不吓人，建议具体可执行。提醒用户"我不是医生，严重问题要看医生"但不啰嗦。', opening: '我是你的健康顾问，身体的事问我。\n\n**我能做什么**\n饮食搭配、运动计划、睡眠改善、体检指标解读——帮你把健康管起来。\n\n**数据怎么来**\n- 告诉我你的情况，我帮你分析建议\n- 也可以发体检报告给我看\n\n试试问一句：\n- 「久坐上班怎么安排饮食和运动」\n- 「帮我看一下这份体检报告」', avatarColor: '#ef4444', avatarPreset: 'health', builtIn: false },
  { id: 'investor', name: '我的投资顾问', systemPrompt: '你扮演"投资顾问"角色。你擅长理财分析：市场行情、资产配置、风险评估。风格：中立客观、数据说话。不推荐具体股票，不承诺收益，帮用户理解风险和机会。开头声明不构成投资建议。', opening: '我是你的投资顾问，钱的事帮你理清楚。\n\n**我能做什么**\n市场分析、资产配置、风险评估——不推荐具体股票，但帮你做决策参考。\n\n**数据怎么来**\n- 告诉我你想了解的方向和预算\n- 也可以发财报、研报给我分析\n\n试试问一句：\n- 「我有10万闲钱，低风险的怎么配」\n- 「帮我分析一下最近的市场行情」', avatarColor: '#c8a951', avatarPreset: 'investor', builtIn: false }
];

function loadRoles() {
  try {
    const p = getRolesPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (_) {}
  // 首次加载：写入默认角色
  saveRoles(DEFAULT_ROLES);
  return JSON.parse(JSON.stringify(DEFAULT_ROLES));
}

function saveRoles(data) {
  fs.writeFileSync(getRolesPath(), JSON.stringify(data, null, 2));
}



// ===== 网关控制 =====

// 重启指定 profile 的网关
// 默认 profile 用 launchd 服务，角色 profile 用 nohup 后台进程
async function restartGateway(profile) {

  const profileArg = profile ? ` --profile ${profile}` : '';
  // 角色 profile 用 nohup 后台启动（不依赖 launchd）
  if (profile) {
    return new Promise((resolve) => {
      const logFile = `/tmp/hermes-gw-${profile}.log`;
      const cmd = `nohup ${HERMES_CLI} --profile ${profile} gateway run > ${logFile} 2>&1 &`;
      exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, output: stderr || err.message });
        } else {
          resolve({ success: true, output: 'gateway started in background' });
        }
      });
    });
  }
  // 默认 profile 用 launchd 服务重启
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

// 获取所有 profile 的网关状态
function getProfileGatewayStates() {
  const states = {};
  const profilesDir = path.join(hermDir, 'profiles');
  try {
    // 读取默认 profile（当前运行中的），key 映射为 dami
    const statePath = path.join(hermDir, 'gateway_state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.platforms) {
        for (const [platform, ps] of Object.entries(state.platforms)) {
          if (!states[platform]) states[platform] = {};
          states[platform]['dami'] = ps;
        }
      }
    }
    // 读取各 profile 的网关状态
    if (fs.existsSync(profilesDir)) {
      for (const profile of fs.readdirSync(profilesDir)) {
        const profileStatePath = path.join(profilesDir, profile, 'gateway_state.json');
        if (fs.existsSync(profileStatePath)) {
          const state = JSON.parse(fs.readFileSync(profileStatePath, 'utf-8'));
          if (state.platforms) {
            for (const [platform, ps] of Object.entries(state.platforms)) {
              if (!states[platform]) states[platform] = {};
              states[platform][profile] = ps;
            }
          }
        }
      }
    }
  } catch (_) {}
  return states;
}

// Hermes profile 管理（角色与 profile 1:1 对应）

// 确保角色的 Hermes profile 存在
function ensureRoleProfile(role, channel, config) {
  const profileDir = path.join(hermDir, 'profiles', role);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  // 写入角色专属 SOUL.md（从 roles.json 动态读取）
  const soulPath = path.join(profileDir, 'SOUL.md');
  const roles = loadRoles();
  const roleData = roles.find(r => r.id === role);
  const rolePrompt = (roleData && roleData.systemPrompt) || `你是"${roleData?.name || role || '助手'}"。说人话，不啰嗦。`;
  const fullSoul = `# Hermes AI — ${role} 角色\n\n${rolePrompt}\n\n## 工作原则\n- 先干活再说话\n- 做了错事就认、马上改\n- 用户没问的不多嘴，但该提醒的主动说\n`;
  fs.writeFileSync(soulPath, fullSoul);
  // 写入/更新 .env 文件
  const envPath = path.join(profileDir, '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }
  const envMap = {};

  // 从 auth.json 复制 API keys（DeepSeek 等）
  try {
    const authPath = path.join(hermDir, 'auth.json');
    if (fs.existsSync(authPath)) {
      const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      const pool = authData.credential_pool || {};
      // DeepSeek
      const dsKeys = pool.deepseek || [];
      if (dsKeys.length > 0 && dsKeys[0].access_token) {
        envMap['DEEPSEEK_API_KEY'] = dsKeys[0].access_token;
      }
    }
  } catch (_) {}

  // 解析已有 .env 内容
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) envMap[match[1]] = match[2];
  }

  // 写入平台凭据
  if (channel && config) {
    const prefix = channel.toUpperCase();
    for (const [key, value] of Object.entries(config)) {
      if (!value) continue;
      envMap[`${prefix}_${key.toUpperCase()}`] = value;
    }
  }

  // 写回 .env
  const lines = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
  return profileDir;
}



// ===== Hermes CLI 帮助函数 =====

const HERMES_CLI = HERMES_BIN;



function hermesCLI(args, timeout = 30000) {

  const cmd = `${HERMES_CLI} ${args}`;

  const result = execSync(cmd, { timeout, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

  return result.trim();

}



// ===== HTTP 帮助函数 =====

function httpGet(url, opts = {}) {

  return new Promise((resolve, reject) => {

    const lib = url.startsWith('https') ? https : http;

    const parsed = new URL(url);

    const options = {

      hostname: parsed.hostname,

      port: parsed.port,

      path: parsed.pathname + (parsed.search || ''),

      timeout: opts.timeout || 8000,

      headers: {

        'User-Agent': 'Hergent-Desktop/1.0',

        'Accept-Language': 'zh-CN,zh;q=0.9',

        ...(opts.headers || {})

      }

    };

    lib.get(options, (res) => {

      let data = '';

      res.on('data', chunk => data += chunk);

      res.on('end', () => resolve(data));

    }).on('error', reject);

  });

}

function httpPost(url, bodyStr, opts = {}) {

  return new Promise((resolve, reject) => {

    const parsed = new URL(url);

    const headers = {

      'Content-Type': 'application/json',

      'Content-Length': Buffer.byteLength(bodyStr),

      ...(opts.headers || {})

    };

    const options = {

      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,

      method: 'POST',

      headers,

      timeout: opts.timeout || 5000

    };

    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.request(options, (res) => {

      let data = '';

      res.on('data', chunk => data += chunk);

      res.on('end', () => resolve(data));

    });

    req.on('error', reject);

    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });

    req.write(bodyStr);

    req.end();

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

  const logFile = path.join(process.env.HOME, '.hermes', 'app_debug.log');

  fs.appendFileSync(logFile, `[${new Date().toISOString()}] IPC hermes:execute received: action=${action}\n`);

  try {

    if (action === 'chat:send') {

      fs.appendFileSync(logFile, `[${new Date().toISOString()}] chat:send received: action=${args?.action}, text=${(args?.text||'').slice(0,50)}

`);

      // 交互面板发送消息 — 结果推回 App 面板

      // 交互面板发送消息 — 结果推回 App 面板

      const { action, text, files: filePaths, role } = args || {};

      const cronDir = path.join(process.env.HOME, '.hermes', 'cron_input');

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



        // --- 查找活跃会话：app 内已建立的会话优先，否则交给 --continue 自动找最近的 ---
        const roleKey = role || 'dami';
        const activeSessionId = _activeSessions[roleKey] || null;
        if (role && role !== 'dami') ensureRoleProfile(role);

        // --- 调用本地 Hermes CLI ---

        try {

          const result = await new Promise((resolve, reject) => {

            const spawnArgs = activeSessionId
              ? ['chat', '--resume', activeSessionId, '-q', fullText, '--max-turns', '60', '--source', 'tool']
              : ['chat', '--continue', '-q', fullText, '--max-turns', '60', '--source', 'tool'];
            if (role && role !== 'dami') {
              spawnArgs.unshift('--profile', role);
            }
            const child = spawn(HERMES_BIN, spawnArgs);

            _activeChild = child;

            let stdout = '';

            let stderr = '';

            let inBanner = true;           // 跳过前面的 banner

            let inResponseBox = false;     // 是否已进入最终回复框

            let finalLines = [];           // 最终回复的行

            const timer = setTimeout(() => { child.kill(); reject(new Error('回复时间较长，请重试')); }, 600000);

            child.stdout.on('data', (d) => {

              const chunk = d.toString();

              stdout += chunk;

              // 逐行解析，推送实时步骤到前端

              const lines = chunk.split('\n');

              for (const raw of lines) {

                const line = raw.trim();

                if (!line) continue;

                // 跳过 banner（Query: 之前的所有输出）

                if (inBanner) {

                  if (line.startsWith('Query:')) { inBanner = false; }

                  continue;

                }

                // 检测最终回复框的开始

                if (line.includes('╭─') || line.startsWith('│')) {

                  inResponseBox = true;

                  continue;

                }

                if (inResponseBox) {

                  if (line.startsWith('╰─')) { inResponseBox = false; continue; }

                  finalLines.push(line);

                  // 流式推送响应内容到前端

                  try { event.sender.send('hermes:stream', { text: line, type: 'response' }); } catch(_) {}

                  continue;

                }

                // 工具执行步骤（┊ 开头）

                if (line.startsWith('┊')) {

                  try { event.sender.send('hermes:stream', { text: line }); } catch(_) {}

                }

              }

            });

            child.stderr.on('data', (d) => { stderr += d.toString(); });

            child.on('close', (code) => {

              clearTimeout(timer);

              if (_activeChild === child) _activeChild = null;

              // --resume 或 --continue 失败时自动回退重试
              const hasSessionFlag = spawnArgs.includes('--resume') || spawnArgs.includes('--continue');
              if (code !== 0 && hasSessionFlag) {
                const retryArgs = spawnArgs.filter(a => a !== '--continue' && a !== '--resume' && a !== (spawnArgs[spawnArgs.indexOf('--resume') + 1] || ''));
                // 清理掉 --resume <id> 对
                const resumeIdx = retryArgs.indexOf('--resume');
                if (resumeIdx >= 0) retryArgs.splice(resumeIdx, 2);
                const continueIdx = retryArgs.indexOf('--continue');
                if (continueIdx >= 0) retryArgs.splice(continueIdx, 1);
                if (retryArgs.length < spawnArgs.length) {
                  _activeSessions[roleKey] = null; // 旧会话失效，清除
                  const retryChild = spawn(HERMES_BIN, retryArgs);
                  _activeChild = retryChild;
                  let retryOut = '';
                  let retryErr = '';
                  let retryLines = [];
                  let retryInBanner = true, retryInBox = false;
                  const retryTimer = setTimeout(() => { retryChild.kill(); reject(new Error('回复时间较长，请重试')); }, 600000);
                  retryChild.stdout.on('data', (d) => {
                    const chunk = d.toString(); retryOut += chunk;
                    chunk.split('\n').forEach(raw => {
                      const line = raw.trim(); if (!line) return;
                      if (retryInBanner) { if (line.startsWith('Query:')) retryInBanner = false; return; }
                      if (line.includes('╭─') || line.startsWith('│')) { retryInBox = true; return; }
                      if (retryInBox) { if (line.startsWith('╰─')) { retryInBox = false; return; } retryLines.push(line); try { event.sender.send('hermes:stream', { text: line, type: 'response' }); } catch(_) {} return; }
                      if (line.startsWith('┊')) { try { event.sender.send('hermes:stream', { text: line }); } catch(_) {} }
                    });
                  });
                  retryChild.stderr.on('data', (d) => { retryErr += d.toString(); });
                  retryChild.on('close', (rc) => {
                    clearTimeout(retryTimer);
                    if (_activeChild === retryChild) _activeChild = null;
                    if (rc === 0) resolve({ stdout: retryOut, stderr: retryErr, finalLines: retryLines });
                    else reject(new Error(retryErr || "AI 处理失败，请重试"));
                  });
                  retryChild.on('error', (e) => { clearTimeout(retryTimer); if (_activeChild === retryChild) _activeChild = null; reject(e); });
                  return;
                }
              }

              if (code === 0) resolve({ stdout, stderr, finalLines });

              else reject(new Error(stderr || "AI 处理失败，请重试"));

            });

            child.on('error', (e) => {

              clearTimeout(timer);

              if (_activeChild === child) _activeChild = null;

              reject(e);

            });

          });



          // 从 stdout 中提取 AI 回复文本（两种策略）
          let responseText = '';
          // 策略1: 正则提取 Hermes 响应框内的内容（兼容 default 和 --profile 两种格式）
          const boxMatch = result.stdout.match(/Hermes[^\n]*\n([\s\S]*?)\n\s*[╰─][─\s]*(?:╯)?\s*\n/);
          if (boxMatch) {
            responseText = boxMatch[1].split('\n')
              .map(l => l.trim()).filter(Boolean).join('\n').trim();
          }
          // 策略2: fallback 到逐行解析的 finalLines
          if (!responseText && result.finalLines && result.finalLines.length > 0) {
            responseText = result.finalLines.join('\n').trim();
          }
          // 策略3: 最后兜底，去掉已知噪音行
          if (!responseText) {
            responseText = result.stdout.split('\n')
              .filter(l => {
                const t = l.trim();
                return t && !t.startsWith('Query:') && !t.startsWith('Initializing')
                  && !t.startsWith('session_id:') && !t.startsWith('─')
                  && !t.startsWith('┊') && !t.startsWith('↻')
                  && !t.includes('╭') && !t.includes('╰')
                  && !t.startsWith('Resume this session')
                  && !t.startsWith('hermes --resume')
                  && !t.startsWith('Session:') && !t.startsWith('Duration:')
                  && !t.startsWith('Messages:') && !t.startsWith('⚠');
              })
              .map(l => l.trim()).join('\n').trim();
          }



          // 提取会话 ID，存入活跃会话表，保证下一轮对话连续
          const sidMatch = result.stdout.match(/Session:\s+(\S+)/);
          if (sidMatch) {
            _activeSessions[roleKey] = sidMatch[1];

            // --- 自动打通飞书/App 消息（首次发消息后自动 handoff 当前会话）---
            if (!_activeSessions._handoffDone) _activeSessions._handoffDone = {};
            if (!_activeSessions._handoffDone[roleKey]) {
              try {
                const channels = loadChannels();
                if (channels.feishu && channels.feishu[roleKey]) {
                  const channelDir = path.join(hermDir, 'channel_directory.json');
                  if (fs.existsSync(channelDir)) {
                    const dir = JSON.parse(fs.readFileSync(channelDir, 'utf-8'));
                    const feishuChannels = dir.platforms?.feishu || [];
                    if (feishuChannels.length > 0) {
                      const homeId = feishuChannels[0].id;
                      const setCmd = (roleKey === 'dami')
                        ? `config set feishu.home_channel "${homeId}"`
                        : `--profile ${roleKey} config set feishu.home_channel "${homeId}"`;
                      execSync(`${HERMES_CLI} ${setCmd}`, { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
                      const dbPath = (roleKey === 'dami')
                        ? path.join(hermDir, 'state.db')
                        : path.join(hermDir, 'profiles', roleKey, 'state.db');
                      if (fs.existsSync(dbPath)) {
                        const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : pythonCmd;
                        spawnSync(pythonBin, ['-c',
                          `import sqlite3;db=sqlite3.connect('${dbPath}');sid='${sidMatch[1]}';db.execute("UPDATE sessions SET handoff_state='pending',handoff_platform='feishu' WHERE id=? AND handoff_state IS NULL",(sid,));db.commit();db.close()`
                        ], { timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
                      }
                      _activeSessions._handoffDone[roleKey] = true; // 成功后才标记，失败下次重试
                    }
                  }
                }
              } catch (_) {}
            }
          }

          fs.appendFileSync(logFile, `[${new Date().toISOString()}] hermes done: ${responseText.length} chars\n`);



          // 估算积分消耗（按字符数粗略估算，1分≈500字符）

          const charsTotal = fullText.length + responseText.length;

          const creditsUsed = Math.max(1, Math.min(Math.ceil(charsTotal / 500), currentCredits));

          const newBalance = currentCredits - creditsUsed;



          // 扣减积分（失败不返回结果，防止绕过付费）
          let deductOK = false;
          try {
            await httpPost(`${SERVER_URL}/api/credits/deduct`,
              JSON.stringify({ credits: creditsUsed, model: 'hermes', requestId }),
              { timeout: 5000, headers: { 'User-Agent': 'Hergent-Desktop/1.0', 'Accept-Language': 'zh-CN,zh;q=0.9' } }
            );
            deductOK = true;
          } catch (de) {
            fs.appendFileSync(logFile, `[${new Date().toISOString()}] deduct failed: ${de.message}\n`);
          }
          if (!deductOK) {
            return { requestId, success: false, output: '积分扣减失败，请检查网络后重试' };
          }



          return {

            requestId, success: true,

            output: responseText.slice(0, 8000),

            cost: creditsUsed, balance: newBalance

          };

        } catch (e) {

          fs.appendFileSync(logFile, `[${new Date().toISOString()}] hermes error: ${e.message}\n`);

          return { requestId, success: false, output: `执行失败：${e.message}` };

        }

      }

    }



  

  if (action === 'fs:list') {

    const dir = (args && args.dir) || path.join(process.env.HOME, 'Documents');

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

      shell.openPath(target);

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

      { name: '支持的文件', extensions: ['xlsx', 'xls', 'csv', 'docx', 'doc', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'pdf', 'md', 'txt'] },

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

const AVATARS_DIR = path.join(__dirname, 'avatars');



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
    if (process.platform === 'darwin') {
      try {
        execSync(`sips -Z 256 --cropToHeightWidth 256 256 "${srcPath}" --out "${dstPath}"`, { timeout: 5000 });
      } catch (_) {
        execSync(`sips -Z 256 "${srcPath}" --out "${dstPath}"`, { timeout: 5000 });
      }
    } else {
      // Windows: just copy the file as-is
      fs.copyFileSync(srcPath, dstPath);
    }
    if (!fs.existsSync(dstPath)) {
      fs.copyFileSync(srcPath, dstPath);
    }
    return { success: true };
  } catch (e) {
    console.error('[avatar:upload] error:', e.message);
    return { success: false, reason: e.message };
  }
});


// ===== IPC: 删除自定义头像 =====

ipcMain.handle('avatar:remove', async (event, role) => {

  const p = path.join(AVATARS_DIR, `${role}.png`);

  try {

    if (fs.existsSync(p)) fs.unlinkSync(p);

    return { success: true };

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



// ===== IPC: 取消流式生成 =====

ipcMain.handle('hermes:cancel', async () => {

  if (_activeChild) {

    try { _activeChild.kill('SIGTERM'); } catch(e) {}

    _activeChild = null;

    return { cancelled: true };

  }

  return { cancelled: false };

});



// ===== IPC: 对话导出 =====

ipcMain.handle('chat:export', async (event, { content, defaultName }) => {

  const result = await dialog.showSaveDialog(mainWindow, {

    title: '导出对话记录',

    defaultPath: path.join(app.getPath('documents'), defaultName),

    filters: [

      { name: 'Markdown 文件', extensions: ['md'] },

      { name: '文本文件', extensions: ['txt'] },

      { name: '所有文件', extensions: ['*'] }

    ]

  });

  if (result.canceled || !result.filePath) {

    return { success: false, cancelled: true };

  }

  try {

    fs.writeFileSync(result.filePath, content, 'utf8');

    return { success: true, filePath: result.filePath };

  } catch (e) {

    return { success: false, error: e.message };

  }

})
// ===== IPC: 桌面通知 =====
ipcMain.handle('notify:send', async (event, { title, body }) => {
  const { Notification } = require('electron');
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: path.join(__dirname, 'tray-icon.png') });
    n.on('click', () => {
      mainWindow.show();
      mainWindow.center();
    });
    n.show();
    return { success: true };
  }
  return { success: false };
});

;



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

    morning: '查询今天天气和主要新闻，推送到飞书',

    report: '生成今日工作总结，整理关键进展，推送到飞书',

    reminder: '检查并提醒今天的待办事项，推送到飞书',

    backup: '整理最近一周的文件和文档，生成索引报告，推送到飞书',

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



// ===== IPC: 通道配置（Bot模式——按角色嵌套） =====

ipcMain.handle('channels:get', async () => {

  const channels = loadChannels();

  // 兼容旧格式：将扁平配置迁移到嵌套结构（默认归给大秘 dami）
  for (const [key, cfg] of Object.entries(channels)) {
    if (cfg && (cfg.app_id || cfg.bot_id || cfg.client_id)) {
      channels[key] = { dami: cfg };
    }
  }

  // 合并各角色 profile 的网关连接状态
  const profileStates = getProfileGatewayStates();
  for (const [platformKey, roleStates] of Object.entries(profileStates)) {
    if (!channels[platformKey]) continue;
    for (const [role, ps] of Object.entries(roleStates)) {
      if (channels[platformKey][role] && typeof channels[platformKey][role] === 'object') {
        channels[platformKey][role].connected = (ps.state === 'connected');
      }
    }
  }

  return channels;
});



ipcMain.handle('channels:save', async (event, channel, role, config) => {

  // 1. 确保角色 profile 存在，写入 config.yaml + .env
  const profileDir = ensureRoleProfile(role, channel, config);
  try {
    for (const [key, value] of Object.entries(config)) {
      if (!value) continue;
      const escaped = value.replaceAll('"', '\\"');
      hermesCLI(`--profile ${role} config set ${channel}.${key} "${escaped}"`, 5000);
    }
    hermesCLI(`--profile ${role} config set ${channel}.enabled true`, 5000);
  } catch (e) {
    console.error('hermes config set failed:', e.message);
  }

  // 2. 保存到 channels.json（嵌套结构）
  const data = loadChannels();
  if (!data[channel]) data[channel] = {};
  data[channel][role] = config;
  saveChannels(data);

  // 3. 重启该角色 profile 的网关
  try { await restartGateway(role); } catch (_) {}

  return { success: true };
});

ipcMain.handle('channels:pairing-approve', async (event, channel, role, code) => {
  try {
    const result = hermesCLI(`--profile ${role} pairing approve ${channel} ${code}`, 10000);
    return { success: true, output: result };
  } catch (e) {
    return { success: false, output: e.stderr || e.message };
  }
});

ipcMain.handle('channels:remove', async (event, channel, role) => {
  const data = loadChannels();
  if (data[channel] && data[channel][role]) {
    delete data[channel][role];
    if (Object.keys(data[channel]).length === 0) delete data[channel];
    saveChannels(data);
  }
  try { hermesCLI(`--profile ${role} config unset ${channel}`, 5000); } catch (_) {}
  try { await restartGateway(role); } catch (_) {}
  return { success: true };
});



ipcMain.handle('channels:test', async (event, params) => {

  const { channel } = params || {};

  const gatewayPath = path.join(process.env.HOME, '.hermes', 'gateway_state.json');



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

    const gatewayPath = path.join(process.env.HOME, '.hermes', 'gateway_state.json');

    if (!fs.existsSync(gatewayPath)) {

      return { running: false, message: '网关未启动' };

    }

    const state = JSON.parse(fs.readFileSync(gatewayPath, 'utf-8'));

    const platforms = {};

    if (state.platforms) {

      for (const [key, p] of Object.entries(state.platforms)) {

        platforms[key] = { state: p.state, updated: p.updated_at, error: p.error_message };

      }

    }

    return {

      running: state.gateway_state === 'running',

      pid: state.pid,

      platforms,

      message: state.gateway_state === 'running' ? '网关运行中' : '网关已停止'

    };

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



// ===== IPC: 角色管理（动态角色系统） =====

ipcMain.handle('session:clear', async (event, role) => {
  const key = role || 'dami';
  delete _activeSessions[key];
  return { success: true };
});

ipcMain.handle('roles:list', async () => {
  return loadRoles();
});

ipcMain.handle('roles:save', async (event, roles) => {
  if (!Array.isArray(roles)) return { success: false, error: 'Invalid roles data' };
  saveRoles(roles);
  return { success: true };
});

ipcMain.handle('roles:add', async (event, roleData) => {
  const roles = loadRoles();
  const newRole = {
    id: 'custom-' + Date.now(),
    name: (roleData.name || '新员工').slice(0, 20),
    systemPrompt: (roleData.systemPrompt || '').slice(0, 2000),
    opening: '',
    avatarColor: roleData.avatarColor || '#22d3ee',
    avatarPreset: roleData.avatarPreset || '',
    builtIn: false
  };
  roles.push(newRole);
  saveRoles(roles);
  return { success: true, role: newRole };
});

ipcMain.handle('roles:delete', async (event, roleId) => {
  const roles = loadRoles();
  const target = roles.find(r => r.id === roleId);
  if (!target) return { success: false, error: '员工不存在' };
  if (target.builtIn) return { success: false, error: '默认员工不可删除' };
  const filtered = roles.filter(r => r.id !== roleId);
  saveRoles(filtered);
  return { success: true };
});

ipcMain.handle('roles:update', async (event, roleId, updates) => {
  const roles = loadRoles();
  const target = roles.find(r => r.id === roleId);
  if (!target) return { success: false, error: '员工不存在' };
  if (updates.name !== undefined) target.name = String(updates.name).slice(0, 20);
  if (updates.systemPrompt !== undefined) target.systemPrompt = String(updates.systemPrompt).slice(0, 2000);
  if (updates.avatarColor !== undefined) target.avatarColor = updates.avatarColor;
  if (updates.avatarPreset !== undefined) target.avatarPreset = updates.avatarPreset;
  if (updates.opening !== undefined) target.opening = updates.opening;
  saveRoles(roles);
  return { success: true, role: target };
});

// ===== 平台消息轮询（飞书/企微 → App 同步） =====

let _lastGatewayCheck = Date.now() / 1000; // Unix timestamp
let _gatewayPollTimer = null;

function pollGatewayMessages() {
  const now = Date.now() / 1000;
  const since = _lastGatewayCheck;
  _lastGatewayCheck = now;

  const dbPaths = [{ path: path.join(hermDir, 'state.db'), role: 'dami' }];
  // 添加各 profile 的 state.db
  const profilesDir = path.join(hermDir, 'profiles');
  try {
    if (fs.existsSync(profilesDir)) {
      for (const p of fs.readdirSync(profilesDir)) {
        const dbPath = path.join(profilesDir, p, 'state.db');
        if (fs.existsSync(dbPath)) {
          dbPaths.push({ path: dbPath, role: p });
        }
      }
    }
  } catch (_) {}

  // 用 Python 查询所有 state.db，找出平台来源的新消息
  const dbList = dbPaths.map(d => `'${d.path.replace(/'/g, "\\'")}'`).join(', ');
  const roleMap = dbPaths.map(d => `'${d.path.replace(/'/g, "\\'")}':'${d.role}'`).join(',');
  const pyScript = `
import sqlite3, json, sys
dbs = [${dbList}]
role_map = {${roleMap}}
since = ${since}
results = []
for db_path in dbs:
    try:
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        role = role_map.get(db_path, 'unknown')
        sessions = db.execute(
            "SELECT id, source, title FROM sessions WHERE source IN ('feishu','wecom') AND started_at > ? - 300",
            (since,)
        ).fetchall()
        for s in sessions:
            msgs = db.execute(
                "SELECT role, content, timestamp FROM messages WHERE session_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT 10",
                (s['id'], since)
            ).fetchall()
            if msgs:
                results.append({
                    'role': role,
                    'sessionId': s['id'],
                    'source': s['source'],
                    'title': s['title'] or '',
                    'messages': [{'role': m['role'], 'content': m['content'] or '', 'ts': m['timestamp']} for m in msgs]
                })
        db.close()
    except: pass
print(json.dumps(results, ensure_ascii=False))
`.replace(/\n/g, ' ').trim();

  const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : pythonCmd;
  try {
    const result = spawnSync(pythonBin, ['-c', pyScript], {
      timeout: 5000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']
    });
    const output = (result.stdout || '').trim();
    if (!output) return;
    const messages = JSON.parse(output);
    if (messages.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hermes:gateway-message', messages);
    }
  } catch (e) {
    // Python query failed silently (e.g., no venv yet)
  }
}

function startGatewayPolling() {
  if (_gatewayPollTimer) return;
  _gatewayPollTimer = setInterval(pollGatewayMessages, 5000);
}

function stopGatewayPolling() {
  if (_gatewayPollTimer) {
    clearInterval(_gatewayPollTimer);
    _gatewayPollTimer = null;
  }
}

// ===== IPC: 在 Finder 中打开文件/文件夹 =====

ipcMain.handle('shell:openFolder', async (event, filePath) => {

  try {

    const resolved = filePath.replace(/^~/, process.env.HOME);

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

  const tmpFile = `/tmp/hergent-update.tar.gz`;

  try {

    await downloadFile(downloadUrl, tmpFile);

    const result = execSync(

      `hermes profile import ${tmpFile} --profile hergent-desktop`,

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

    }).on('error', (err) => { try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch(_) {} reject(err); });

  });

}



// ===== IPC: 状态 =====

ipcMain.handle('get:status', async () => {

  const profileDir = path.join(process.env.HOME, '.hermes', 'profiles', PROFILE);

  const profileExists = fs.existsSync(profileDir);

  const channels = loadChannels();

  return {

    hermesInstalled: true,

    profileExists,

    channels,

    version: CURRENT_VERSION,

    profile: PROFILE,

  };

});

// ===== IPC: 服务端地址配置 =====
ipcMain.handle('server:get-url', async () => {
  return { url: SERVER_URL };
});

ipcMain.handle('server:save-url', async (event, url) => {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'server.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ url }, null, 2));
    return { success: true, url };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===== IPC: 记忆系统 =====
ipcMain.handle('memory:list', async () => {
  const memDir = path.join(process.env.HOME, '.hermes', 'memories');
  try {
    if (!fs.existsSync(memDir)) return { memories: [] };
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
    const items = [];
    for (const file of files.slice(0, 20)) {
      const content = fs.readFileSync(path.join(memDir, file), 'utf8');
      const title = content.split('\n')[0].replace(/^#\s*/, '').trim() || file.replace('.md', '');
      items.push({ id: file.replace('.md', ''), title: title.slice(0, 60) });
    }
    return { memories: items };
  } catch (e) {
    return { memories: [], error: e.message };
  }
});

// ===== IPC: 积分查询 =====

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



// ===== IPC: 检查 hermes CLI 是否可用 =====

ipcMain.handle('hermes:check-cli', async () => {

  try {

    const result = execSync(`${HERMES_CLI} --version 2>/dev/null || echo "not found"`, { timeout: 5000, encoding: 'utf-8' });

    return { available: !result.includes('not found'), path: HERMES_CLI };

  } catch (e) {

    return { available: false, path: HERMES_CLI };

  }

});

// ===== IPC: Hermes CLI 引导安装 =====
ipcMain.handle('hermes:bootstrap', async (event) => {
  const log = (msg) => {
    try { event.sender.send('hermes:boot-progress', msg); } catch(_) {}
    console.log('[bootstrap]', msg);
  };

  const HERMES_DIR = path.join(homeDir, '.hermes', 'hermes-agent');
  const VENV_PYTHON = path.join(HERMES_DIR, venvBin, pythonCmd);
  const HERMES_BIN_PATH = path.join(HERMES_DIR, venvBin, hermesCmd);

  if (fs.existsSync(HERMES_BIN_PATH)) {
    HERMES_BIN = HERMES_BIN_PATH;
    log('done|Hermes 引擎已就绪');
    return { success: true, path: HERMES_BIN_PATH };
  }

  try {
    log('check|检查 Python 环境...');
    try { execSync(`${pythonCmd} --version`, { timeout: 5000, encoding: 'utf-8' }); } catch(_) {
      return { success: false, error: '需要 Python 3.11+，请先安装 Python' };
    }

    log('mkdir|创建安装目录...');
    fs.mkdirSync(HERMES_DIR, { recursive: true });

    log('venv|创建虚拟环境（约 2 分钟）...');
    execSync(`"${pythonCmd}" -m venv "${path.join(HERMES_DIR, 'venv')}"`, { timeout: 120000, encoding: 'utf-8', shell: true });
    

    log('pip|安装 Hermes Agent 核心组件（需要网络，约 3-5 分钟）...');
    execSync(`"${VENV_PYTHON}" -m pip install --quiet hermes-agent 2>&1`, { timeout: 300000, encoding: 'utf-8' });

    if (fs.existsSync(HERMES_BIN_PATH)) {
      HERMES_BIN = HERMES_BIN_PATH;
      log('done|安装完成！');
      return { success: true, path: HERMES_BIN_PATH };
    } else {
      return { success: false, error: '安装后未找到 hermes 命令' };
    }
  } catch (e) {
    log('error|安装失败: ' + (e.stderr || e.message || '未知错误'));
    return { success: false, error: e.stderr || e.message || '安装失败' };
  }
});



// ===== IPC: 查询积分余额 =====

ipcMain.handle('activation:credits', async () => {

  try {

    const body = await httpGet(`${SERVER_URL}/api/credits`);

    return JSON.parse(body);

  } catch (e) {

    return { credits: 0, message: '无法连接服务' };

  }

});



// ===== 认证登录 =====

ipcMain.handle('auth:send-code', async (event, phone) => {

  try {

    const body = await httpPost(`${SERVER_URL}/api/auth/send-code`, JSON.stringify({ phone }));

    return JSON.parse(body);

  } catch (e) {

    return { success: false, message: '无法连接服务' };

  }

});

ipcMain.handle('auth:verify-code', async (event, phone, code) => {

  try {

    const body = await httpPost(`${SERVER_URL}/api/auth/verify-code`, JSON.stringify({ phone, code }));

    return JSON.parse(body);

  } catch (e) {

    return { success: false, message: '无法连接服务' };

  }

});

ipcMain.handle('auth:wechat-url', async () => {

  try {

    const body = await httpGet(`${SERVER_URL}/api/auth/wechat/login-url`);

    return JSON.parse(body);

  } catch (e) {

    return { success: false, message: '无法连接服务' };

  }

});

ipcMain.handle('auth:me', async (event, token) => {

  try {

    const body = await httpGet(`${SERVER_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });

    return JSON.parse(body);

  } catch (e) {

    return { valid: false };

  }

});

ipcMain.handle('auth:logout', async (event, token) => {

  try {

    const body = await httpPost(`${SERVER_URL}/api/auth/logout`, JSON.stringify({ token }));

    return JSON.parse(body);

  } catch (e) {

    return { success: false };

  }

});



// 打开外部链接

ipcMain.handle('shell:open', async (event, url) => {

  require('electron').shell.openExternal(url);

  return true;

});



// ===== 窗口控制 =====

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window:close', () => mainWindow.hide());

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



// ===== 主题管理 =====
ipcMain.handle('theme:get', async () => {
  const configPath = getThemeConfigPath();
  let userPreference = 'system';
  if (fs.existsSync(configPath)) {
    try { userPreference = JSON.parse(fs.readFileSync(configPath, 'utf-8')).theme || 'system'; } catch(e) {}
  }
  const systemIsDark = nativeTheme.shouldUseDarkColors;
  const effectiveIsDark = userPreference === 'dark' ? true : (userPreference === 'light' ? false : systemIsDark);
  return { userPreference, systemIsDark, effectiveIsDark };
});

ipcMain.handle('theme:set', async (event, theme) => {
  // theme: 'system' | 'light' | 'dark'
  fs.writeFileSync(getThemeConfigPath(), JSON.stringify({ theme }, null, 2));
  if (theme === 'dark') {
    nativeTheme.themeSource = 'dark';
  } else if (theme === 'light') {
    nativeTheme.themeSource = 'light';
  } else {
    nativeTheme.themeSource = 'system';
  }
  const effectiveIsDark = nativeTheme.shouldUseDarkColors;
  mainWindow.webContents.send('theme:changed', effectiveIsDark);
  return { effectiveIsDark };
});

app.whenReady().then(() => {

  // 监听系统主题变化 → 推送到渲染进程（仅当用户选择"跟随系统"时生效）
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors);
    }
  });

  // 设置 Dock 图标（开发模式下 app.dock.setIcon 生效）
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, 'icon.png');
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(iconPath);
    }
  }

  // 自定义协议：avatar:// — 从 Resources/avatars/ 加载头像（锁死在 App 目录）

  protocol.handle('avatar', (request) => {

    const fileName = request.url.replace('avatar://', '').split('?')[0];

    const filePath = path.join(AVATARS_DIR, fileName);

    if (fs.existsSync(filePath)) {

      return net.fetch(`file://${filePath}`);

    }

    // 返回 1x1 透明 PNG 占位（无自定义头像时用 CSS fallback 绘制）

    return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), {

      status: 200,

      headers: { 'content-type': 'image/png' }

    });

  });




  createWindow();

  setupTray();

  // 启动平台消息轮询（飞书/企微消息 → App 同步）
  startGatewayPolling();

});



app.on('before-quit', () => {
  isQuitting = true;
  stopGatewayPolling();
});

app.on('window-all-closed', () => {
  // macOS 上关闭所有窗口不退出，保持后台运行
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
