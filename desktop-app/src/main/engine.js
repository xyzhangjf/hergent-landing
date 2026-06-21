// Hergent Desktop — Engine management
// Extracted from main.js Phase 1 refactoring

const path = require("path");
const fs = require("fs");
const { execSync, spawn, spawnSync } = require("child_process");
const { app } = require("electron");
const {
  CURRENT_VERSION, homeDir, GATEWAY_PORT, GATEWAY_URL,
  isWindows, HERMES_CMD, SERVER_URL, ROLE_SKILLS, DEFAULT_ROLES,
} = require("./constants");
const logger = require("./logger");
const rolesMgr = require("./roles");
const licenses = require("./license");

let GATEWAY_API_KEY = "";
let HERMES_BIN = HERMES_CMD;

function init(gatewayApiKey, hermesBin) {
  GATEWAY_API_KEY = gatewayApiKey || GATEWAY_API_KEY;
  HERMES_BIN = hermesBin || HERMES_BIN;
}

function getEngineDir() {
  return path.join(app.getPath('userData'), 'hermes-engine');
}

// 递归合并目录（不覆盖已存在的文件）
function _mergeDir(src, dst) {
  if (!fs.existsSync(dst)) { fs.mkdirSync(dst, { recursive: true }); }
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name);
    const d = path.join(dst, f.name);
    if (f.isDirectory()) {
      _mergeDir(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

function extractBundledEngine() {
  const engineDir = getEngineDir();
  const versionFile = path.join(engineDir, '.extracted-version');
  const tarballPath = path.join(__dirname, '..', 'hermes.tar.gz');
  logger.startup(`extractBundledEngine: engineDir=${engineDir}, tarball=${fs.existsSync(tarballPath) ? 'found' : 'NOT FOUND'}`);
  if (!fs.existsSync(tarballPath)) return false;

  const currentVersion = CURRENT_VERSION + '|' + (fs.statSync(tarballPath).size || 0);
  // 验证关键文件是否存在（防止 sentinel 存在但解压不完整的情况，如 Gatekeeper 删除了 dylib）
  const criticalFiles = isWindows
    ? [path.join(engineDir, 'python', 'python.exe')]
    : [path.join(engineDir, 'python', 'bin', 'python3.11'), path.join(engineDir, 'python', 'lib', 'libpython3.11.dylib')];
  try {
    if (fs.existsSync(versionFile) && criticalFiles.every(f => fs.existsSync(f))) {
      const extracted = fs.readFileSync(versionFile, 'utf8').trim();
      if (extracted === currentVersion) {
        logger.startup('extractBundledEngine: already extracted, version matches');
        return true;
      }
      logger.startup(`extractBundledEngine: version mismatch, re-extracting (${extracted.slice(0,30)} vs ${currentVersion.slice(0,30)})`);
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
    logger.startup(`extractBundledEngine: running tar extract, tarball=${fs.statSync(tarballPath).size} bytes`);
    execSync(cmd, { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    // 提取后立即清除所有文件的隔离属性，防止 Gatekeeper 拦截二进制/dylib
    if (!isWindows) {
      try { spawnSync('/usr/bin/xattr', ['-cr', engineDir], { timeout: 10000 }); } catch (_) {}
    }
    // Windows: 应用引擎补丁（缺失模块、常量函数等）
    if (isWindows) {
      const patchesDir = path.join(process.resourcesPath, 'win-patches');
      logger.startup(`extractBundledEngine: Windows patches dir ${fs.existsSync(patchesDir) ? 'found' : 'NOT FOUND'} at ${patchesDir}`);
      if (fs.existsSync(patchesDir)) {
        try {
          for (const f of fs.readdirSync(patchesDir, { withFileTypes: true })) {
            const src = path.join(patchesDir, f.name);
            const dst = path.join(engineDir, f.name);
            if (f.isDirectory()) {
              _mergeDir(src, dst);
            } else if (f.name.endsWith('.py') && fs.existsSync(dst)) {
              // 追加补丁内容到引擎已有文件（不读取原文件，避免 GBK 编码错误）
              const patchBuf = fs.readFileSync(src);
              fs.appendFileSync(dst, '\n' + patchBuf.toString('utf8'));
            } else if (!fs.existsSync(dst)) {
              fs.copyFileSync(src, dst);
            }
          }
          console.log('[engine] Windows patches applied from', patchesDir);
        } catch (e2) { console.log('[engine] Windows patch error:', e2.message); }
      }
    }
    // 复制支付宝证书到用户目录（支付必需）
    try {
      const bundledCerts = path.join(process.resourcesPath || path.join(__dirname, '..'), 'certs');
      const userCerts = path.join(homeDir, '.hermes', 'certs');
      if (fs.existsSync(bundledCerts)) {
        _mergeDir(bundledCerts, userCerts);
        console.log('[engine] Certs copied to', userCerts);
      }
    } catch (_) {}
    fs.writeFileSync(versionFile, currentVersion);
    logger.startup(`extractBundledEngine: extraction complete, engineDir=${engineDir}`);
    console.log('[engine] Extracted to', engineDir);
    return true;
  } catch (e) {
    logger.reportCriticalError("engine", e, { phase: "extraction", engineDir, version: CURRENT_VERSION });
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
  const dsKey = licenses.getDeepSeekApiKey();
  set('model.name', 'deepseek-v4-flash');
  set('model.provider', 'openai');
  set('platforms.api_server.enabled', 'true');
  set('platforms.api_server.port', String(GATEWAY_PORT));
  set('platforms.api_server.key', GATEWAY_API_KEY);
  set('custom_providers.0.name', 'openai');
  set('custom_providers.0.base_url', `${SERVER_URL}/v1`);
  set('custom_providers.0.api_key', dsKey);
  set('custom_providers.0.model', 'deepseek-v4-flash');
  set('memory.memory_enabled', 'true');
  set('memory.memory_char_limit', '12000');
  set('memory.user_char_limit', '8000');
  set('memory.flush_min_turns', '6');
  set('memory.nudge_interval', '10');
}

// 从 asar 安全复制目录（asar 不支持 cpSync，需逐文件处理）
function copyDirFromAsar(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirFromAsar(src, dst);
    } else if (entry.isSymbolicLink && entry.isSymbolicLink()) {
      // asar 中不应有 symlink，但安全处理
      try { fs.copyFileSync(src, dst); } catch (_) {}
    } else {
      try {
        const content = fs.readFileSync(src);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, content);
      } catch (e) { /* skip individual file errors */ }
    }
  }
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

    if (!fs.existsSync(userPath)) {
      fs.mkdirSync(userPath, { recursive: true });
    }

    // skills: 从 Resources/skills/（磁盘，非 asar）复制到用户目录
    if (dir === 'skills') {
      const bundledSkills = path.join(process.resourcesPath, 'skills');
      if (fs.existsSync(bundledSkills)) {
        const entries = fs.readdirSync(bundledSkills, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const srcDir = path.join(bundledSkills, e.name);
          const dstDir = path.join(userPath, e.name);
          try {
            _mergeDir(srcDir, dstDir);
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
                    entry.isDirectory() ? copyDirFromAsar(s, d) : fs.copyFileSync(s, d);
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
      // Windows 普通权限不支持默认 symlink，需用 junction（目录联接）
      if (isWindows) {
        fs.symlinkSync(userPath, enginePath, 'junction');
      } else {
        fs.symlinkSync(userPath, enginePath);
      }
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
  const roles = rolesMgr.loadRoles();
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
        if (fs.existsSync(src)) fs.symlinkSync(src, dst, isWindows ? 'junction' : 'dir');
      } catch (_) {}
    }
  }
}

function ensureRoleConfigs() {
  const engineDir = getEngineDir();
  const roles = rolesMgr.loadRoles();
  // 读取主引擎模型配置，用于同步到所有角色
  const mainConfigPath = path.join(engineDir, '.hermes', 'config.yaml');
  let mainModel = 'deepseek-v4-flash', mainProvider = 'openai';
  try {
    const mc = fs.readFileSync(mainConfigPath, 'utf8');
    const mm = mc.match(/^model:\s*\n\s+name:\s*(.+)/m);
    const mp = mc.match(/^model:\s*\n(?:.+\n)*?\s+provider:\s*(.+)/m);
    if (mm) mainModel = mm[1].trim();
    if (mp) mainProvider = mp[1].trim();
  } catch (_) {}
  for (const [roleId, role] of Object.entries(roles)) {
    const roleHome = path.join(engineDir, '.hermes', 'agents', roleId);
    const reportsBase = path.join(app.getPath('documents'), 'Hergent', '成果');
    const roleWorkspace = reportsBase; // Hermes 生成的文件直接存到"我的成果"目录
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
          '  name: deepseek-v4-flash',
          '  provider: openai',
          'custom_providers:',
          '  - name: openai',
          `    base_url: ${SERVER_URL}/v1`,
          `    api_key: hermes_${licenses.getDeviceId()}`,
          '    model: deepseek-v4-flash',
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
    // 同步主引擎模型到该角色 — 整段替换 model section（不存在则插入）
    try {
      let roleCfg = fs.readFileSync(roleConfigPath, 'utf8');
      if (roleCfg.match(/^model:/m)) {
        roleCfg = roleCfg.replace(
          /^model:\n(\s+name: .+\n)(\s+provider: .+\n)?(\s+base_url: .+\n)?(\s+default: .+\n)?/m,
          'model:\n  name: ' + mainModel + '\n  provider: ' + mainProvider + '\n'
        );
      } else {
        roleCfg = 'model:\n  name: ' + mainModel + '\n  provider: ' + mainProvider + '\n' + roleCfg;
      }
      // 确保有 custom_providers
      if (!roleCfg.match(/^custom_providers:/m)) {
        roleCfg += '\ncustom_providers:\n  - name: openai\n    base_url: ' + SERVER_URL + '/v1\n    api_key: hermes_' + licenses.getDeviceId() + '\n    model: ' + mainModel + '\n';
      }
      // 同时更新 custom_providers 中 hergent provider 的 model 名 + apiKey
      // 兼容 YAML 列表格式 "- name:" 和普通格式 "name:"
      roleCfg = roleCfg.replace(
        /^(\s*-?\s*name: openai\n\s+base_url: .+\n\s+)api_key: .+(\n\s+model: ).+/m,
        '$1api_key: hermes_' + licenses.getDeviceId() + '$2' + mainModel
      );
      fs.writeFileSync(roleConfigPath, roleCfg);
      // v0.15.x requires OPENAI_API_KEY for openai provider
      try { fs.writeFileSync(path.join(roleHome, '.env'), 'OPENAI_API_KEY=hermes-local-proxy\n'); } catch (_) {}
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
  // 放宽条件：只要有 .extracted-version 就认为引擎已解压
  const engineDir = getEngineDir();
  return fs.existsSync(path.join(engineDir, '.extracted-version')) ||
         fs.existsSync(path.join(engineDir, '.hermes', '.hermes-ready'));
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

module.exports = {
  init, getEngineDir, _mergeDir, extractBundledEngine, ensureEngineConfig,
  copyDirFromAsar, ensureSharedState, syncRoleSkills, ensureRoleConfigs,
  markEngineReady, isEngineReady, ensureBuiltinSkills, resolveHermesPath,
};
