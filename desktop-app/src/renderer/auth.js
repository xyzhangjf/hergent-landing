// Hergent Desktop — Authentication
// Extracted from app.js Phase 2
// ===== 登录认证 & 新手引导 =====
var authState = null;  // { token, user }
var smsTimer = null;
var _connFailed = 0;     // 连续失败计数
var _connCheckTimer = null;


// ===== 动态角色加载 =====
async function loadRolesFromIPC() {
  try {
    const list = await window.hermes.rolesList();
    if (Array.isArray(list) && list.length > 0) {
      _rolesList = list;
      // 同步更新 ROLES 对象（保持 ROLES[id] 兼容写法）
      const map = {};
      list.forEach(r => { map[r.id] = r; });
      ROLES = map;
      return;
    }
  } catch (e) {
    console.error('loadRolesFromIPC failed:', e);
  }
  // fallback: 使用 config.js 中的默认 ROLES
  _rolesList = Object.entries(ROLES).map(([id, r]) => ({ id, ...r }));
}

async function initAuth() {
  localStorage.removeItem('hermes_streaming');

  // 先检查是否已激活（Alpha阶段必须）
  var activated = localStorage.getItem('hermes_activated');
  if (!activated) {
    // 不等待引擎，直接显示激活码页面
    showActivationOverlay();
    return;
  }

  // 已激活：直接用本地保存的 token 进入
  var saved = localStorage.getItem('hermes_auth');
  if (!saved) {
    // Check if this is the dev machine
var isDevMachine = (localStorage.getItem('hermes_activated') === 'dev-admin-zhang');
var welcomeCredits = isDevMachine ? 99999 : 500;
authState = { token: 'alpha-token', user: { id: activated, name: '内测用户', credits: welcomeCredits } };
    saveAuth();
  } else {
    try {
      authState = JSON.parse(saved);
    } catch (e) { authState = null; }
  }

  // 进入主界面
  hideLogin();
  await waitForEngineReady();
  updateCreditsBadge();
  await loadRolesFromIPC();
  renderSidebar();
  loadSkills();
  initOnboarding();
  restoreLastState();
  startFeishuPolling();
  var rp = document.getElementById('rightPanel');
  if (rp) rp.style.visibility = 'visible';
  return;
}

async function waitForEngineReady() {
  const overlay = document.getElementById('bootstrapOverlay');
  const status = document.getElementById('bootStatus');
  const fill = document.getElementById('bootProgressFill');
  const skipBtn = document.getElementById('bootSkipBtn');
  const subtitle = document.querySelector('.bootstrap-subtitle');

  // 判断是否首次启动
  let isFirstLaunch = true;
  try {
    const cli = await window.hermes.checkCli();
    isFirstLaunch = !(cli && cli.available);
  } catch (_) {}

  if (overlay && overlay.style.display !== 'flex') { overlay.style.display = 'flex'; }
  // 隐藏登录页，避免闪现
  hideLogin();
  if (skipBtn) { skipBtn.style.display = 'none'; skipBtn.textContent = '跳过等待'; }
  let fallbackShown = false;

  const steps = isFirstLaunch
    ? [
        { pct: 20, msg: '正在解压 Hermes 引擎...' },
        { pct: 40, msg: '正在安装 Python 依赖...' },
        { pct: 60, msg: '正在配置网关...' },
        { pct: 80, msg: '正在启动网关...' },
        { pct: 95, msg: '引擎就绪，加载中...' },
      ]
    : [
        { pct: 30, msg: '正在启动引擎...' },
        { pct: 70, msg: '引擎就绪，加载中...' },
      ];

  if (subtitle) subtitle.textContent = isFirstLaunch ? '首次启动约需1-2分钟' : '';

  const estSeconds = isFirstLaunch ? 120 : 30; // 预计时间
  const start = Date.now();
  let stepIdx = 0;

  while (true) {
    // 根据已用时间推进进度（基于预估时间）
    const elapsed = (Date.now() - start) / (estSeconds * 1000);
    while (stepIdx < steps.length && elapsed >= steps[stepIdx].pct / 100) {
      if (status) status.textContent = steps[stepIdx].msg;
      if (fill) fill.style.width = steps[stepIdx].pct + '%';
      stepIdx++;
    }
    // 平滑过渡（上限95%，就绪后才到100%）
    if (stepIdx < steps.length && fill) {
      const prevPct = stepIdx > 0 ? steps[stepIdx - 1].pct : 0;
      const nextPct = steps[stepIdx].pct;
      const segElapsed = (elapsed - prevPct / 100) / ((nextPct - prevPct) / 100);
      const rawPct = prevPct + segElapsed * (nextPct - prevPct);
      fill.style.width = Math.min(rawPct, 95) + '%';
    }

    try {
      const s = await window.hermes.gatewayStatus();
      // 引擎已就绪 或 gateway 在运行 → 可以进了
      if (s && (s.ready || s.running)) {
        if (status) status.textContent = steps[steps.length - 1].msg;
        if (fill) fill.style.width = '100%';
        await new Promise(r => setTimeout(r, 800));
        if (overlay) overlay.style.display = 'none';
        if (fill) fill.style.width = '5%';
        return;
      }
    } catch (_) {}
    // 引擎已解压但 gateway 没起来 → 60秒就显示跳过
    if (!fallbackShown && Date.now() - start > 60000) {
      fallbackShown = true;
      if (status) status.textContent = '启动较慢，可跳过等待（引擎后台继续初始化）';
      if (skipBtn) { skipBtn.style.display = ''; skipBtn.onclick = function() { skipBootstrap(); }; }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  // 不会到这里——while(true) 直到引擎就绪才 return
}

function saveAuth() {
  localStorage.setItem('hermes_auth', JSON.stringify(authState));
}

function showLogin() {
  showOverlay('loginOverlay');
  loadWechatQR();
}

function hideLogin() {
  hideOverlay('loginOverlay');
  // 显示主界面（初始隐藏避免闪现）
  var rp = document.getElementById('rightPanel');
  if (rp) rp.style.visibility = 'visible';
}

async function skipLogin() {
  authState = { token: 'guest-token', user: { id: 'guest', name: '访客' } };
  saveAuth();
  hideLogin();
  document.getElementById('bootstrapOverlay').style.display = 'none';
  updateCreditsBadge();
  await loadRolesFromIPC();
  renderSidebar();
  restoreLastState();
  startFeishuPolling();
  initOnboarding();
}

function switchLoginTab(tab) {
  document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="' + tab + '"]').classList.add('active');
  document.querySelectorAll('.login-tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tab === 'phone' ? 'panelPhone' : 'panelWechat').classList.add('active');
  if (tab === 'wechat') loadWechatQR();
}

// ===== 短信验证码 =====
async function sendSmsCode() {
  const phone = document.getElementById('phoneInput').value.replace(/\s/g, '');
  const btn = document.getElementById('sendCodeBtn');
  const errEl = document.getElementById('loginError');
  if (!/^1\d{10}$/.test(phone)) {
    errEl.textContent = '请输入正确的11位手机号';
    return;
  }
  btn.disabled = true;
  errEl.textContent = '';
  try {
    const data = await hermes.authSendCode(phone);
    if (data.success) {
      let sec = 60;
      btn.textContent = sec + 's';
      smsTimer = setInterval(() => {
        sec--;
        if (sec <= 0) {
          clearInterval(smsTimer);
          btn.textContent = '重新获取';
          btn.disabled = false;
        } else {
          btn.textContent = sec + 's';
        }
      }, 1000);
    } else {
      errEl.textContent = data.detail || data.message || '发送失败';
      btn.disabled = false;
    }
  } catch (e) {
    errEl.textContent = friendlyError(e);
    btn.disabled = false;
  }
}

async function verifySmsCode() {
  const phone = document.getElementById('phoneInput').value.replace(/\s/g, '');
  const code = document.getElementById('codeInput').value.replace(/\s/g, '');
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  if (!phone || !code) {
    errEl.textContent = '请输入手机号和验证码';
    return;
  }
  btn.disabled = true;
  btn.textContent = '登录中...';
  try {
    const data = await hermes.authVerifyCode(phone, code);
    if (data.token) {
      authState = { token: data.token, user: data.user };
      saveAuth();
      updateCreditsBadge();
      hideLogin();
      document.getElementById('bootstrapOverlay').style.display = 'none';
      await loadRolesFromIPC();
      renderSidebar();
      restoreLastState();
      startFeishuPolling();
      initOnboarding();
    } else {
      errEl.textContent = data.detail || data.message || '验证码错误';
    }
  } catch (e) {
    errEl.textContent = friendlyError(e);
  }
  btn.disabled = false;
  btn.textContent = '登录';
}


// ===== 微信扫码 =====
async function loadWechatQR() {
  const hintEl = document.getElementById('qrHint');
  try {
    const data = await hermes.authWechatUrl();
    if (data.url) {
      drawQR(document.getElementById('wechatQR').querySelector('canvas'), data.url);
      hintEl.textContent = '请用微信扫描二维码';
    } else {
      hintEl.textContent = '微信登录暂不可用（需配置微信开放平台）';
    }
  } catch (e) { console.error("wechat QR failed:", e.message);
    // 微信不可用时隐藏微信登录标签页
    const wechatTab = document.querySelector('.login-tab[onclick*="wechat"]');
    if (wechatTab) wechatTab.style.display = 'none';
  }
}

function drawQR(canvas, url) {
  if (typeof QRCode !== 'undefined') {
    new QRCode(canvas, { text: url, width: 200, height: 200 });
    return;
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = '#9ca3b0';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('微信登录', 100, 70);
  ctx.fillText('需要配置开放平台', 100, 90);
  ctx.fillText('先用手机号登录', 100, 114);
}

window.addEventListener('message', (e) => {
  if (e.data?.type === 'wechat_login' && e.data?.token) {
    authState = { token: e.data.token };
    hermes.authMe(e.data.token).then(async user => {
      if (user && user.id) {
        authState.user = user;
        saveAuth();
        updateCreditsBadge();
        hideLogin();
        document.getElementById('bootstrapOverlay').style.display = 'none';
        await loadRolesFromIPC();
        renderSidebar();
        restoreLastState();
        startFeishuPolling();
        initOnboarding();
      }
    }).catch(() => {});
  }
});

// ===== 登出 =====
async function logout() {
  if (authState?.token) {
    try { await hermes.authLogout(authState.token); } catch (e) {}
  }
  localStorage.removeItem('hermes_auth');
  localStorage.removeItem('hermes_chat');
  authState = null;
  location.reload();
}


