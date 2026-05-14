  // ===== 首启安装引导 =====
  let _bootDone = false;
  async function runBootstrap() {
    const overlay = document.getElementById('bootstrapOverlay');
    const status = document.getElementById('bootStatus');
    const fill = document.getElementById('bootProgressFill');
    const skipBtn = document.getElementById('bootSkipBtn');
    if (!overlay) return;

    // 先检查是否已安装
    try {
      const cli = await window.hermes.checkCli();
      if (cli && cli.available) {
        _bootDone = true;
        overlay.style.display = 'none';
        initAuth();
        return;
      }
    } catch(_) {}

    // 显示引导界面
    overlay.style.display = 'flex';

    // 监听进度
    window.hermes.onBootProgress((msg) => {
      const [type, text] = (msg || '准备中...').split('|');
      if (status) status.textContent = text || type;
      if (type === 'venv' && fill) fill.style.width = '15%';
      if (type === 'pip' && fill) fill.style.width = '50%';
      if (type === 'done' && fill) fill.style.width = '100%';
      if (type === 'error') {
        fill.style.background = '#ef4444';
        if (skipBtn) skipBtn.style.display = '';
      }
      if (type === 'done') {
        setTimeout(() => {
          _bootDone = true;
          overlay.style.display = 'none';
          initAuth();
        }, 800);
      }
    });

    // 开始安装
    try {
      const result = await window.hermes.bootstrapHermes();
      if (!result.success) {
        status.textContent = '安装失败：' + (result.error || '未知错误');
        skipBtn.style.display = '';
      }
    } catch(e) {
      status.textContent = '安装出错：' + (e.message || '');
      skipBtn.style.display = '';
    }
  }

  function skipBootstrap() {
    _bootDone = true;
    document.getElementById('bootstrapOverlay').style.display = 'none';
    initAuth();
  }

  // ===== textarea 自动增高 =====
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('chatInput');
    if (!input || input.tagName !== 'TEXTAREA') return;
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  });

  // 应用入口
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runBootstrap);
  } else {
    runBootstrap();
  }

  // ===== 登录认证 & 新手引导 =====
  let authState = null;  // { token, user }
  let smsTimer = null;
  let _connFailed = 0;     // 连续失败计数
  let _connCheckTimer = null;

  // ===== 覆盖层栈管理 =====
  const _overlayStack = [];
  const OVERLAY_Z_BASE = 100;

  function showOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const idx = _overlayStack.indexOf(id);
    if (idx >= 0) _overlayStack.splice(idx, 1);
    _overlayStack.push(id);
    el.style.zIndex = OVERLAY_Z_BASE + _overlayStack.length * 10;
    el.classList.add('show');
  }

  function hideOverlay(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('show');
    const idx = _overlayStack.indexOf(id);
    if (idx >= 0) _overlayStack.splice(idx, 1);
  }

  function topOverlay() {
    return _overlayStack.length > 0 ? _overlayStack[_overlayStack.length - 1] : null;
  }

  // ===== 全局键盘快捷键 =====
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    // 窗口控制
    if (mod && e.key === 'w') { e.preventDefault(); window.hermes.close(); return; }
    // Cmd+N: 新建对话
    if (mod && e.key === 'n') { e.preventDefault(); newConversation(); return; }
    // Cmd+E: 导出对话
    if (mod && e.key === 'e') { e.preventDefault(); exportChat(); return; }
    // Cmd+,: 打开设置
    if (mod && e.key === ',') { e.preventDefault(); switchPage('pageSettings'); return; }
    // Cmd+1~9: 快速切换角色
    if (mod && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (_rolesList[idx]) handleRole(_rolesList[idx].id);
      return;
    }
    // Cmd+J: 弹出角色切换菜单
    if (mod && e.key === 'j') { e.preventDefault(); toggleRoleSwitcher(); return; }

    if (e.key === 'Escape') {
      const top = topOverlay();
      if (top === 'dialogOverlay') { closeDialog(); return; }
      if (top === 'loginOverlay') { return; }
      if (top === 'modalOverlay') { hideAddTask(); return; }
      if (_streamActive) { cancelStream(); return; }
    }
  });

  // 窗口不在前台时发送系统通知
  function notifyIfAway(title, body) {
    if (document.hidden && window.hermes.notify) {
      window.hermes.notify(title, body);
    }
  }

  // 转换技术错误为友好中文提示
  function friendlyError(e) {
    const msg = (e && (e.message || String(e))) || '';
    if (/failed to fetch|networkerror|fetch error/i.test(msg)) return '无法连接服务，请检查网络';
    if (/timeout|timed ?out/i.test(msg)) return '响应超时，请稍后重试';
    if (/ECONNREFUSED|connection refused/i.test(msg)) return 'AI 引擎未就绪，请稍后重试';
    if (/退出码 1|exit code 1/i.test(msg)) return 'AI 处理失败，请重试';
    if (/退出码|exit code/i.test(msg)) return 'AI 引擎异常，请重试';
    if (/EPIPE|broken pipe/i.test(msg)) return '连接中断，请重试';
    if (/ENOENT|not found/i.test(msg)) return '未找到所需程序，请确认安装完整';
    return (e && e.message) || '未知错误，请重试';
  }

  // 连接状态提示条
  function showConnBanner(msg, isError) {
    const banner = document.getElementById('connBanner');
    if (!banner) return;
    document.getElementById('connBannerText').textContent = msg;
    banner.className = 'conn-banner' + (isError ? ' error' : '');
    banner.style.display = 'flex';
  }
  function hideConnBanner() {
    const banner = document.getElementById('connBanner');
    if (banner) banner.style.display = 'none';
    _connFailed = 0;
    if (_connCheckTimer) { clearInterval(_connCheckTimer); _connCheckTimer = null; }
  }

  // 心跳检测后端是否可用
  async function checkConnectionHealth() {
    try {
      await window.hermes.getCredits();
      _connFailed = 0;
      hideConnBanner();
    } catch (e) {
      _connFailed++;
      if (_connFailed >= 2) {
        showConnBanner('后端服务连接异常，请稍候…正在自动重连', true);
      }
    }
  }
  function startConnMonitor() {
    if (_connCheckTimer) return;
    _connCheckTimer = setInterval(checkConnectionHealth, 15000);
  }

  // 初始化：检查本地 token（DEV 模式跳过登录）
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
    const saved = localStorage.getItem('hermes_auth');
    if (saved) {
      try {
        authState = JSON.parse(saved);
        const meResp = await hermes.authMe(authState.token);
        if (meResp && meResp.id) {
          authState.user = meResp;
          updateCreditsBadge();
          await loadRolesFromIPC();
          renderSidebar();
          initOnboarding();
          restoreLastState();
          return;
        }
      } catch (e) {}
      localStorage.removeItem('hermes_auth');
      authState = null;
    }
    // DEV 模式：跳过登录直接进入
    authState = { token: 'dev-token', user: { id: 'dev', name: '开发者' } };
    saveAuth();
    hideLogin();
    updateCreditsBadge();
    await loadRolesFromIPC();
    renderSidebar();
    initOnboarding();
    restoreLastState();
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
    } catch (e) {
      document.getElementById('wechatQR').innerHTML = '<p style="color:#999;font-size:13px">微信登录需要服务器支持<br>请使用手机号登录</p>';
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
    ctx.fillStyle = '#999';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('微信登录', 100, 70);
    ctx.fillText('需要配置开放平台', 100, 90);
    ctx.fillText('先用手机号登录', 100, 114);
  }

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'wechat_login' && e.data?.token) {
      authState = { token: e.data.token };
      hermes.authMe(e.data.token).then(user => {
        if (user && user.id) {
          authState.user = user;
          saveAuth();
          updateCreditsBadge();
          hideLogin();
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

  // ===== 新手引导 =====
  function restoreLastState() {
    const lastPage = localStorage.getItem('hermes_last_page');
    const lastRole = localStorage.getItem('hermes_last_role');
    if (lastPage && lastPage !== 'pageHome') switchPage(lastPage);
    if (lastRole && lastRole !== 'dami') handleRole(lastRole);
  }

  function initOnboarding() {
    if (!currentAction) currentAction = 'dami';
    if (!localStorage.getItem('hermes_onboarding_done')) {
      localStorage.setItem('hermes_onboarding', '1');
      const existing = localStorage.getItem('hermes_chat');
      if (!existing || existing === '[]') injectOnboardingWelcome();
    }
  }

  function injectOnboardingWelcome() {
    const history = document.getElementById('chatHistory');
    const empty = history.querySelector('.chat-empty');
    if (empty) empty.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'chat-msg hermes';
    msg.innerHTML = '你好！我是 Hergent，你的 AI 数字员工团队 👋<br><br>左边是 8 位伙伴，选一个直接聊。<br>想人不在时也能用？去 <b>📱 连接手机</b> 配飞书/企微，我就能在手机上回复你。<span class="time">' + new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</span>';
    history.appendChild(msg);
    const msgs = [{ role: 'hermes', text: '你好！我是 Hergent，你的数字员工 👋\n\n我能帮你：\n📄 读文件 — PDF/Word/Excel 拖进来就能分析\n✍️ 写东西 — 周报、邮件、方案、合同\n🔍 搜信息 — 全网搜索帮你整理\n⏰ 定时干活 — 设好时间自动执行\n📱 手机遥控 — 连飞书/企微，人不在也能用\n\n💡 第一步：左边选一个数字员工\n💡 第二步：点「📱 连接手机」配飞书，手机上也能用\n\n选一个试试？或者直接跟我说你想做什么。', time: new Date().toISOString() }];
    localStorage.setItem('hermes_chat', JSON.stringify(msgs));
    scrollChat();
  }

  // ===== 积分 =====
  function updateTrialBadge() { updateCreditsBadge(); }

  async function updateCreditsBadge() {
    const badge = document.getElementById('creditsBadge');
    if (!badge) return;
    let b = authState?.user?.credits || 0;
    try {
      const cred = await hermes.getCredits();
      if (cred && cred.credits != null) {
        b = cred.credits;
        if (authState) authState.user = { ...authState.user, credits: b };
      }
    } catch (e) {}
    badge.style.display = 'inline-block';
    if (b > 0) {
      document.getElementById('creditsText').textContent = b + ' 积分';
      badge.className = b < 500 ? 'credits-badge low' : 'credits-badge';
      badge.onclick = () => showCreditsDetail(b);
    } else {
      document.getElementById('creditsText').textContent = '0 积分';
      badge.className = 'credits-badge low';
      badge.onclick = () => showDialog('🪙', '积分已用完，请充值\n\n10元起充，用多少充多少', true).then(ok => { if (ok) switchPage('pageSettings'); });
    }
  }

  async function refreshLicense() {
    try {
      const cred = await hermes.getCredits();
      if (authState) authState.user = { ...authState.user, credits: cred?.credits || 0 };
    } catch (e) {}
    updateCreditsBadge();
  }

  function showCreditsDetail(credits) {
    const daysEst = credits > 0 ? Math.max(1, Math.round(credits / 30)) : 0;
    const msg = `剩余积分：${credits} 分\n预计可用 ${daysEst} 天（按日常使用估算）\n\n每次对话消耗约 1-3 积分\n文件处理约 3-5 积分\n\n充值档位：\n10元=1000分  30元=3000分\n50元=5500分(送500)\n\n自定义金额任意充`;
    showDialog('🪙', msg);
  }
  function showActivationDialog() {
    if (!authState?.user) return;
    showCreditsDetail(authState.user.credits || 0);
  }

  async function checkCreditsBeforeSend() {
    try {
      const cred = await hermes.getCredits();
      const b = cred && cred.credits != null ? cred.credits : 0;
      if (authState) authState.user = { ...authState.user, credits: b };
      updateCreditsBadge();
      return { ok: b > 0, credits: b };
    } catch (e) {
      return { ok: true, credits: -1 };
    }
  }


  // ===== 页面切换 =====
  function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.page-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.page-item[data-page="${pageId}"]`);
    if (navItem) navItem.classList.add('active');

    // 记住最后页面
    localStorage.setItem('hermes_last_page', pageId);

    if (pageId === 'pageTasks') refreshTasks();
    if (pageId === 'pageChannels') refreshChannels();
    if (pageId === 'pageReports') refreshReports();
    if (pageId === 'pageSettings') refreshSettings();
  }

  async function getServerUrl() {
    try {
      const r = await window.hermes.getServerUrl();
      return (r && r.url) || 'https://api.hergent.io';
    } catch(_) { return 'https://api.hergent.io'; }
  }

  async function saveServerUrl() {
    const input = document.getElementById('setServerUrl');
    const url = (input.value || '').trim();
    if (!url) { showDialog('⚠️', '请输入服务器地址'); return; }
    try {
      const r = await window.hermes.saveServerUrl(url);
      if (r && r.success) {
        showDialog('✅', '服务器地址已保存，重启后生效');
      } else {
        showDialog('❌', '保存失败：' + ((r && r.error) || ''));
      }
    } catch(e) { showDialog('❌', '保存失败：' + (e.message || '')); }
  }

  async function refreshSettings() {
    document.getElementById('setVersion').textContent = 'v1.0.0';
    if (authState && authState.user && authState.user.credits != null) {
      document.getElementById('setCredits').textContent = authState.user.credits + ' 分';
    } else {
      document.getElementById('setCredits').textContent = '--';
    }
    // 同步主题选择状态
    const currentTheme = localStorage.getItem('hermes_theme') || 'system';
    document.querySelectorAll('.theme-option').forEach(o => {
      o.classList.toggle('active', o.getAttribute('data-theme') === currentTheme);
    });
  }

  async function clearAllData() {
    const confirmed = await showDialog('⚠️', '确定清除所有数据？\n\n包括聊天记录、未读数、登录状态等', true);
    if (!confirmed) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i));
    }
    keys.forEach(k => localStorage.removeItem(k));
    showDialog('✅', '已清除所有数据\n\n应用将刷新');
    setTimeout(() => location.reload(), 1500);
  }

  // ===== 定时任务 =====



  let currentFreq = 'daily';
  let prefilledTemplate = null;

  function selectFreq(freq) {
    currentFreq = freq;
    document.querySelectorAll('.freq-chip').forEach(c => c.classList.remove('active'));
    const chip = document.querySelector(`.freq-chip[data-freq="${freq}"]`);
    if (chip) chip.classList.add('active');

    // Show/hide condition fields
    document.getElementById('condWeekday').classList.toggle('show', ['weekly','altweekly'].includes(freq));
    document.getElementById('condDaysOfWeek').classList.toggle('show', ['biweekly'].includes(freq));
    document.getElementById('condDay').classList.toggle('show', ['monthly','altmonthly'].includes(freq));
    document.getElementById('condQuarter').classList.toggle('show', freq === 'quarterly');
    document.getElementById('condCron').classList.toggle('show', freq === 'custom');
  }

  function buildDaySelect() {
    const sel = document.getElementById('daySelect');
    let html = '';
    for (let d = 1; d <= 28; d++) html += `<option value="${d}">${d}号</option>`;
    sel.innerHTML = html;
  }

  function updateQuarterDay() {
    const sel = document.getElementById('quarterDay');
    let html = '';
    for (let d = 1; d <= 28; d++) html += `<option value="${d}">${d}号</option>`;
    sel.innerHTML = html;
  }

  function buildSchedule() {
    const timeStr = document.getElementById('taskTimeInput').value.trim();
    if (!timeStr || !timeStr.includes(':')) return null;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;

    switch (currentFreq) {
      case 'daily': case 'altdaily':
        return `${m} ${h} * * *`;
      case 'weekly': case 'altweekly': {
        const dow = document.getElementById('weekdaySelect').value;
        return `${m} ${h} * * ${dow}`;
      }
      case 'biweekly': {
        const sel = document.getElementById('daysOfWeekSelect');
        const dows = Array.from(sel.selectedOptions).map(o => o.value).join(',');
        return `${m} ${h} * * ${dows || '1,4'}`;
      }
      case 'monthly': case 'altmonthly': {
        const dom = document.getElementById('daySelect').value || '1';
        return `${m} ${h} ${dom} * *`;
      }
      case 'quarterly': {
        const qm = document.getElementById('quarterMonth').value || '1';
        const qd = document.getElementById('quarterDay').value || '1';
        return `${m} ${h} ${qd} ${qm},${(parseInt(qm)+3) % 12 || 12},${(parseInt(qm)+6) % 12 || 12},${(parseInt(qm)+9) % 12 || 12} *`;
      }
      case 'custom':
        return document.getElementById('cronInput').value.trim();
      default:
        return `${m} ${h} * * *`;
    }
  }

  function showAddTask(template) {
    prefilledTemplate = template || null;
    document.getElementById('modalTitle').textContent = template ? '从模板创建' : '新建定时任务';
    showOverlay('modalOverlay');

    if (template) {
      currentFreq = template.freq || 'daily';
      document.getElementById('taskNameInput').value = template.name || '';
      document.getElementById('taskTimeInput').value = template.time || '08:00';
      document.getElementById('taskPromptInput').value = template.prompt || '';
      document.getElementById('taskPromptInput').style.display = 'block';
    } else {
      currentFreq = 'daily';
      document.getElementById('taskNameInput').value = '';
      document.getElementById('taskTimeInput').value = '08:00';
      document.getElementById('taskPromptInput').value = '';
      document.getElementById('taskPromptInput').style.display = 'none';
    }

    // Reset chips
    document.querySelectorAll('.freq-chip').forEach(c => c.classList.remove('active'));
    const chip = document.querySelector(`.freq-chip[data-freq="${currentFreq}"]`);
    if (chip) chip.classList.add('active');
    selectFreq(currentFreq);
  }

  function hideAddTask() {
    hideOverlay('modalOverlay');
    prefilledTemplate = null;
  }

  async function createTask() {
    const name = document.getElementById('taskNameInput').value.trim();
    const timeStr = document.getElementById('taskTimeInput').value.trim();
    const customPrompt = document.getElementById('taskPromptInput').value.trim();

    if (!name) { showDialog('⚠️', '请输入任务名称'); return; }
    if (!timeStr || !timeStr.includes(':')) { showDialog('⚠️', '请输入正确的时间，如 08:00'); return; }

    const schedule = buildSchedule();
    if (!schedule) { showDialog('⚠️', '时间格式不对，比如 08:00'); return; }

    hideAddTask();

    const prompt = customPrompt || (prefilledTemplate ? prefilledTemplate.prompt : `执行任务: ${name}`);
    const desc = customPrompt || `${currentFreq === 'altdaily' ? '隔天' : FREQ_LABELS[currentFreq]} ${timeStr} — ${name}`;

    try {
      const result = await window.hermes.cronCreate({ name: name, action: prompt, schedule });
      if (result && result.success) {
        showDialog('✅', `定时任务「${name}」创建成功！${desc} 自动执行`);
        refreshTasks();
      } else {
        showDialog('❌', '创建失败: ' + ((result && result.output) || '请重试'));
      }
    } catch (e) {
      showDialog('❌', '创建失败: ' + (e.message || '未知错误'));
    }
  }

  async function deleteTask(id) {
    const confirmed = await showDialog('⚠️', '确定删除这个定时任务？', true);
    if (!confirmed) return;
    try {
      await window.hermes.cronRemove({ id });
      showDialog('✅', '已删除');
      refreshTasks();
    } catch (e) {
      showDialog('❌', '删除失败: ' + (e.message || '未知错误'));
    }
  }

  async function toggleTask(id, currentStatus) {
    try {
      if (currentStatus === 'active') {
        await window.hermes.cronPause(id);
      } else {
        await window.hermes.cronResume(id);
      }
      refreshTasks();
    } catch (e) {
      showDialog('❌', '操作失败: ' + (e.message || '未知错误'));
    }
  }

  async function runTaskNow(id) {
    const confirmed = await showDialog('▶️', '确定立即执行这个任务吗？', true);
    if (!confirmed) return;
    try {
      await window.hermes.cronRun(id);
      showDialog('✅', '任务已触发，稍后查看结果');
    } catch (e) {
      showDialog('❌', '执行失败: ' + (e.message || '未知错误'));
    }
  }

  function renderTaskTemplates() {
    const grid = document.getElementById('taskTemplatesGrid');
    if (!grid) return;
    grid.innerHTML = TASK_TEMPLATES.map(t => {
      const freqLabel = FREQ_LABELS[t.freq] || t.freq;
      return `<div class="task-template-card" onclick="showAddTask(${JSON.stringify(t).replace(/"/g, '&quot;')})" title="${t.desc}">
        <span class="tpl-ico">${t.ico}</span>${t.name}<span style="color:#aaa;font-size:10px;">${freqLabel}</span>
      </div>`;
    }).join('');
  }

  async function refreshTasks() {
    // render templates
    renderTaskTemplates();

    const listEl = document.getElementById('taskList');
    listEl.innerHTML = '<div class="empty-msg"><div class="spinner"></div>加载中...</div>';
    try {
      const tasks = await window.hermes.cronList();
      if (!tasks || tasks.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><div class="empty-state-title">还没有定时任务</div><div class="empty-state-desc">创建提醒或定时报告，让 Hermes 帮你自动干活</div><button class="btn" onclick="showAddTask()" style="margin-top:12px;">创建第一个任务</button></div>';
        return;
      }
      let html = '';
      tasks.forEach(t => {
        const isActive = t.status === 'active';
        const name = t.name || t.id || '(未命名)';
        const schedule = t.schedule || '';
        const nextRun = t.nextRun ? t.nextRun.replace('T', ' ').slice(0, 16) : '';
        const lastRun = t.lastRun ? t.lastRun.replace('T', ' ').slice(0, 16) : '';

        html += `<div class="task-card">
          <div class="task-info">
            <strong>${escapeHTML(name)}</strong>
            <span class="task-schedule">${escapeHTML(schedule)}</span>
            ${nextRun ? `<span class="task-schedule">下次: ${escapeHTML(nextRun)}</span>` : ''}
            ${lastRun ? `<span class="task-schedule">上次: ${escapeHTML(lastRun)}</span>` : ''}
          </div>
          <div class="task-actions">
            <span class="task-status ${isActive ? 'active' : 'paused'}">${isActive ? '运行中' : '已暂停'}</span>
            <button class="btn-task-toggle${isActive ? '' : ' paused'}" onclick="toggleTask('${escapeAttr(t.id)}', '${t.status}')" title="${isActive ? '暂停' : '恢复'}">${isActive ? '暂停' : '恢复'}</button>
            <button class="btn-task-run" onclick="runTaskNow('${escapeAttr(t.id)}')" title="立即执行"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
            <button class="btn-task-del" onclick="deleteTask('${escapeAttr(t.id)}')">删除</button>
          </div>
        </div>`;
      });
      listEl.innerHTML = html;
    } catch (e) {
      listEl.innerHTML = '<div class="empty-msg">❌ 加载失败: ' + escapeHTML(e.message || '未知错误') + '</div>';
    }
  }

  // init quarter day select

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
  }


  // ===== 渠道角色配置 =====
  var _crChannel = null, _crRole = null;

  function openChannelRoleModal(channel, role) {
    _crChannel = channel;
    _crRole = role || null;
    const card = CHANNEL_CARDS.find(c => c.key === channel);
    if (!card) return;
    document.getElementById('crModalTitle').textContent = role ? `配置 ${ROLES[role]?.name || role} · ${card.label}` : `添加员工 · ${card.label}`;

    // 渲染角色选择网格（使用动态角色列表）
    const roleGrid = document.getElementById('crRoleGrid');
    roleGrid.innerHTML = _rolesList.map(r => {
      const preset = r.avatarPreset || r.id;
      const avatarHTML = `<img src="avatar://${preset}.png" alt="${r.name}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`;
      return `<button class="rs-chip ${(_crRole || '') === r.id ? 'active' : ''}" data-role="${r.id}">
        ${avatarHTML}
        <span>${r.name}</span>
      </button>`;
    }).join('');
    // 用事件委托绑定点击
    roleGrid.querySelectorAll('.rs-chip').forEach(btn => {
      btn.addEventListener('click', function() {
        _crRole = this.getAttribute('data-role');
        roleGrid.querySelectorAll('.rs-chip').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
      });
    });

    // 渲染凭据字段（预填已有配置）
    getChannels().then(channels => {
      const existing = (channels[channel] && _crRole && channels[channel][_crRole]) || {};
      const fieldsDiv = document.getElementById('crFields');
      fieldsDiv.innerHTML = (card.fields || []).map(f => {
        const val = existing[f.id] || '';
        const isSecret = f.id.toLowerCase().includes('secret');
        return `<div class="csc-field">
          <label>${f.label}</label>
          <input type="${isSecret ? 'password' : 'text'}" id="cr_field_${f.id}" value="${escapeAttr(val)}" placeholder="${f.placeholder}" />
        </div>`;
      }).join('');
    });

    showOverlay('channelRoleModal');
  }

  function closeChannelRoleModal() {
    hideOverlay('channelRoleModal');
    _crChannel = null;
    _crRole = null;
  }

  async function saveChannelRole() {
    if (!_crChannel || !_crRole) { showDialog('⚠️', '请选择角色'); return; }
    const card = CHANNEL_CARDS.find(c => c.key === _crChannel);
    if (!card || !card.fields) return;

    const data = {};
    let empty = true;
    card.fields.forEach(f => {
      const el = document.getElementById('cr_field_' + f.id);
      if (el) { const v = el.value.trim(); if (v) empty = false; data[f.id] = v; }
    });
    if (empty) { showDialog('⚠️', '请填写凭据信息'); return; }

    try {
      await window.hermes.saveChannel(_crChannel, _crRole, data);
      closeChannelRoleModal();
      showDialog('✅', `${ROLES[_crRole]?.name || _crRole} · ${card.label} 已保存`);
      refreshChannels();
    } catch(e) { showDialog('❌', '保存失败: ' + (e.message || '')); }
  }

  async function promptPairingCode(channel, role) {
    const rName = ROLES[role]?.name || role;
    // 创建一个带输入框的对话框
    const overlay = document.getElementById('dialogOverlay');
    document.getElementById('dialogIcon').innerHTML = DIALOG_ICONS['💭'];
    document.getElementById('dialogMsg').innerHTML = `输入 ${rName} 的配对码：<br><input id="pairingCodeInput" type="text" placeholder="如 9TN42MXA" style="margin-top:8px;width:100%;padding:8px 10px;border:1px solid var(--border-default);border-radius:6px;font-size:14px;text-align:center;letter-spacing:2px;background:var(--bg-input);color:var(--text-primary);" />`;
    const cancelBtn = document.getElementById('dialogBtnCancel');
    const okBtn = document.getElementById('dialogBtnOk');
    cancelBtn.style.display = '';
    okBtn.textContent = '审批';
    overlay.classList.add('show');

    okBtn.onclick = async () => {
      const code = document.getElementById('pairingCodeInput')?.value?.trim();
      if (!code) return;
      overlay.classList.remove('show');
      try {
        const result = await window.hermes.approvePairing(channel, role, code);
        if (result && result.success) {
          showDialog('✅', `${rName} 审批成功`);
        } else {
          showDialog('❌', '审批失败: ' + ((result && result.output) || '未知错误'));
        }
      } catch(e) { showDialog('❌', '审批失败: ' + (e.message || '')); }
    };
    cancelBtn.onclick = () => { overlay.classList.remove('show'); };
  }

  async function removeChannelRole(channel, role) {
    const confirmed = await showDialog('⚠️', `确定移除 ${ROLES[role]?.name || role} 在 ${channel} 的配置？`, true);
    if (!confirmed) return;
    try {
      await window.hermes.removeChannel(channel, role);
      showDialog('✅', '已移除');
      refreshChannels();
    } catch(e) { showDialog('❌', '移除失败: ' + (e.message || '')); }
  }

  async function getChannels() {
    try { return await window.hermes.getChannels(); } catch(_) { return {}; }
  }

  async function refreshChannels() {
    const gridEl = document.getElementById('channelCardsGrid');
    gridEl.innerHTML = '<div class="empty-msg"><div class="spinner"></div>加载中...</div>';

    const channels = await getChannels();

    gridEl.innerHTML = CHANNEL_CARDS.map(c => {
      const platformRoles = channels[c.key] || {};
      // 只取真正的角色配置（排除 _connected 等内部标记）
      const roleKeys = Object.keys(platformRoles).filter(k => !k.startsWith('_'));

      const roleRows = roleKeys.length > 0
        ? roleKeys.map(role => {
            const cfg = platformRoles[role] || {};
            const isConnected = cfg.connected === true;
            return `<div class="chn-role-row">
              <img class="chn-role-avatar" src="avatar://${role}.png" alt="" onerror="this.style.display='none'" />
              <span class="chn-role-name">${ROLES[role]?.name || role}</span>
              <span class="chn-role-status ${isConnected ? 'online' : 'saved'}">${isConnected ? '已连接' : '已保存'}</span>
              <button class="chn-role-edit" onclick="openChannelRoleModal('${c.key}','${role}')" title="编辑">编辑</button>
              <button class="chn-role-pair" onclick="promptPairingCode('${c.key}','${role}')" title="审批配对"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></button>
              <button class="chn-role-del" onclick="removeChannelRole('${c.key}','${role}')" title="移除">×</button>
            </div>`;
          }).join('')
        : '<div class="chn-role-empty">暂无配置，点击下方添加员工</div>';

      return `<div class="channel-card-new" id="chCard_${c.key}">
        <div class="chn-icon-wrap"><img src="avatar://${c.icon}.png" alt="${c.label}" style="width:42px;height:42px;border-radius:8px;object-fit:cover;" /></div>
        <div class="chn-body">
          <div class="chn-name">${c.label}</div>
        </div>
        <div class="chn-roles-wrapper">${roleRows}</div>
        <button class="chn-add-role-btn" onclick="openChannelRoleModal('${c.key}')">
          + 添加员工
        </button>
      </div>`;
    }).join('');
  }

  function toggleChannelSetup(key) {} // 不再需要，保留空函数避免报错
  function startChannelSetup(channel) {
    openChannelRoleModal(channel);
  }

  async function testChannel(channel) {
    try {
      showDialog('💭', '正在测试连接...');
      const result = await window.hermes.testChannel(channel);
      if (result && result.success) {
        showDialog('✅', channel + ' 连接正常！');
      } else {
        showDialog('❌', '连接失败: ' + ((result && result.output) || '请检查配置'));
      }
    } catch (e) {
      showDialog('❌', '测试出错: ' + (e.message || '未知错误'));
    }
  }

  // 切换密码字段可见性
  function toggleSecret(fieldId, eyeEl) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      eyeEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    } else {
      input.type = 'password';
      eyeEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
  }

  // ===== 通道凭据保存（从卡片输入框读取） =====
  async function testChannelConnection(channel) {
    // 已弃用，保留空函数
  }

  // ===== 网关状态 & 控制 =====
  async function checkGatewayStatus() {
    const dot = document.getElementById('gwDot');
    const msg = document.getElementById('gwMsg');
    const btn = document.getElementById('gwRestartBtn');
    try {
      const status = await window.hermes.gatewayStatus();
      if (status.running) {
        dot.style.background = '#52c41a';
        msg.textContent = '网关运行中 — ' + (status.message || '');
        btn.style.display = 'inline-block';
        // 检查各平台连接
        if (status.platforms) {
          const conn = Object.entries(status.platforms).filter(([k,v]) => v.state === 'connected').map(([k]) => k);
          const fail = Object.entries(status.platforms).filter(([k,v]) => v.state !== 'connected');
          if (conn.length > 0) msg.textContent += ' | 已连: ' + conn.join(', ');
          if (fail.length > 0) msg.textContent += ' | 待连: ' + fail.map(([k]) => k).join(', ');
        }
      } else {
        dot.style.background = '#faad14';
        msg.textContent = status.message || '网关未运行';
        btn.style.display = 'inline-block';
      }
    } catch (e) {
      dot.style.background = '#ff4d4f';
      msg.textContent = '状态检查失败: ' + (e.message || '');
      btn.style.display = 'inline-block';
    }
  }

  async function restartGatewayFromUI(silent) {
    const msg = document.getElementById('gwMsg');
    const btn = document.getElementById('gwRestartBtn');
    if (!silent) showDialog('💭', '正在重启网关...');
    try {
      msg.textContent = '🔄 正在重启网关...';
      btn.style.display = 'none';
      const result = await window.hermes.gatewayRestart();
      if (result.success) {
        if (!silent) showDialog('✅', '网关已重启');
      } else {
        if (!silent) showDialog('⚠️', '重启结果: ' + (result.output || '未知'));
      }
    } catch (e) {
      if (!silent) showDialog('❌', '重启失败: ' + (e.message || ''));
    }
    // 等2秒再检查状态
    await new Promise(r => setTimeout(r, 2000));
    await checkGatewayStatus();
    refreshChannels();
  }

  // ===== 状态弹窗 =====
  const DIALOG_ICONS = {
    '✅': '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    '❌': '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    '⚠️': '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    '💭': '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    '🪙': '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>',
    '🔄': '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  };
  let _dialogResolve = null;
  function showDialog(icon, msg, confirmMode) {
    document.getElementById('dialogIcon').innerHTML = DIALOG_ICONS[icon] || icon;
    document.getElementById('dialogMsg').textContent = msg;
    const cancelBtn = document.getElementById('dialogBtnCancel');
    const okBtn = document.getElementById('dialogBtnOk');
    if (confirmMode) {
      cancelBtn.style.display = '';
      okBtn.textContent = '确定';
      return new Promise((resolve) => {
        _dialogResolve = resolve;
        okBtn.onclick = () => { hideOverlay('dialogOverlay'); _dialogResolve = null; resolve(true); };
        cancelBtn.onclick = () => { hideOverlay('dialogOverlay'); _dialogResolve = null; resolve(false); };
        showOverlay('dialogOverlay');
      });
    }
    cancelBtn.style.display = 'none';
    okBtn.textContent = '知道了';
    okBtn.onclick = closeDialog;
    _dialogResolve = null;
    showOverlay('dialogOverlay');
  }
  function closeDialog() {
    hideOverlay('dialogOverlay');
    _dialogResolve = null;
  }



  // 问卷调查状态
  let questionnaireHistory = '';  // 累积的对话历史

  // ===== 交互面板 =====
  const chatFilePaths = [];

  // ===== 3个快捷入口 =====
  async function quickReadFile() {
    await handleFileSelect();
    if (chatFilePaths.length > 0) {
      document.getElementById('chatInput').value = '帮我分析一下这个文件的内容';
      document.getElementById('chatInput').focus();
    }
  }
  function quickSearch() {
    document.getElementById('chatInput').value = '帮我搜一下：';
    document.getElementById('chatInput').focus();
    document.getElementById('chatInput').setSelectionRange(6, 6);
  }
  function quickReminder() {
    switchPage('pageTasks');
    showAddTask();
  }

  // ➕按钮：通过 electron dialog 选文件
  async function handleFileSelect() {
    console.log('[handleFileSelect] called');
    try {
      const result = await window.hermes.selectFile();
      console.log('[handleFileSelect] result:', JSON.stringify(result));
      if (!result.canceled && result.filePath) {
        chatFilePaths.push({ name: result.filePath.split('/').pop(), path: result.filePath });
        addFileTag(result.filePath.split('/').pop());
      }
    } catch(err) {
      console.error('[handleFileSelect] error:', err);
      showDialog('❌', '文件选择失败：' + (err.message || err));
    }
  }

  // === 文件拖拽 ===
  function initDragDrop() {
    const panel = document.getElementById('chatPanel');
    const overlay = document.getElementById('dropOverlay');
    if (!panel) return;
    let dragCounter = 0;
    panel.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        panel.classList.add('drag-over');
        // 尝试读取文件信息更新覆盖层
        updateDropOverlay(e.dataTransfer);
      }
    });
    panel.addEventListener('dragleave', (e) => {
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; panel.classList.remove('drag-over'); }
    });
    panel.addEventListener('dragover', (e) => {
      e.preventDefault();
      updateDropOverlay(e.dataTransfer);
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      panel.classList.remove('drag-over');
      if (overlay) overlay.textContent = '📂 释放文件';
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const filePath = f.path || f.name;
        if (!chatFilePaths.find(x => x.path === filePath)) {
          chatFilePaths.push({ name: f.name, path: filePath });
          addFileTag(f.name);
        }
      }
    });
  }

  function updateDropOverlay(dataTransfer) {
    const overlay = document.getElementById('dropOverlay');
    if (!overlay) return;
    if (dataTransfer.items && dataTransfer.items.length) {
      const count = dataTransfer.items.length;
      const exts = [];
      for (let i = 0; i < Math.min(count, 3); i++) {
        const item = dataTransfer.items[i];
        if (item.kind === 'file') {
          const ext = (item.type || '').split('/').pop() || '文件';
          exts.push(ext);
        }
      }
      const detail = exts.length ? exts.join('/') : '文件';
      overlay.textContent = `📂 释放以添加 ${count} 个${detail}`;
    } else {
      overlay.textContent = '📂 释放文件';
    }
  }
  function fileIconFor(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const iconMap = {
      pdf: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      xlsx: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      xls: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      csv: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      docx: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      jpg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      jpeg: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      png: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
      md: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      txt: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    };
    return iconMap[ext] || iconMap['txt'];
  }

  function addFileTag(name) {
    const card = document.createElement('div');
    card.className = 'file-attach-card';
    const escName = name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const iconHTML = fileIconFor(name);
    card.innerHTML = `<span class="fa-icon">${iconHTML}</span><span class="fa-name">${escName}</span><span class="fa-remove" onclick="event.stopPropagation();this.parentElement.remove();removeFileByName('${escName.replace(/'/g,"\\'")}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
    document.getElementById('chatFiles').appendChild(card);
  }

  function removeFileByName(name) {
    const idx = chatFilePaths.findIndex(f => f.name === name);
    if (idx >= 0) chatFilePaths.splice(idx, 1);
  }

  // 侧边栏功能按钮点击（包装 fillPrompt + 页面切换）
  function handleSidebarFunc(action) {
    _switchingRole = true;
    // 保存当前对话
    saveChatHistoryNow();
    // 取消所有页面项高亮
    document.querySelectorAll('.page-item').forEach(n => n.classList.remove('active'));
    // 确保在主页
    if (!document.getElementById('pageHome').classList.contains('active')) {
      switchPage('pageHome');
    }
    // 切换上下文
    currentAction = action;
    questionnaireHistory = '';
    // 强清残留 streaming 状态
    _clearPendingTimer();
    _streamActive = false;
    toggleCancelButton(false);
    _streamTarget = null;
    localStorage.removeItem('hermes_streaming');
    document.getElementById('chatHistory').innerHTML = '';
    loadChatHistory();
    _switchingRole = false;
    // 没有历史则显示开场白
    const q = questionnaires[action];
    if (q && document.getElementById('chatHistory').querySelectorAll('.chat-msg').length === 0) {
      questionnaireHistory = `[对话引导模式 - ${q.name}]\n`;
      addChatMessage('hermes', q.opening);
    }
    document.getElementById('chatInput').value = '';
    document.getElementById('chatInput').focus();
  }

  // 给 Hermes 回复追加声明
  function wrapResponse(html) {
    // 检测文件路径并转为可点击链接（点击在 Finder 中打开）
    // 匹配: /Users/... , ~/... 开头的路径
    const pathRegex = /(\/(?:Users|tmp|var|etc|opt|usr|Library|Applications|System|Volumes|private|\.hermes)\/[^\s<>"]+|~\/[^\s<>"]+)/g;
    const linked = html.replace(pathRegex, (match) => {
      const escaped = match.replace(/'/g, "\\'");
      return `<a href="#" onclick="event.preventDefault();window.hermes.openFolder('${escaped}')" style="color:#3370FF;text-decoration:underline;cursor:pointer;" title="在 Finder 中打开">${match}</a>`;
    });
    return linked;
  }

  // === Markdown 渲染器（零依赖） ===
  function renderMarkdown(text) {
    if (!text) return '';
    // 1. 转义 HTML
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 2. 提取代码块 → 占位
    const codeBlocks = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre><code class="language-${lang || ''}">${code.replace(/\n+$/, '').replace(/^\n+/, '')}</code></pre>`);
      return `\u0000CB${idx}\u0000`;
    });

    // 3. 行级元素处理
    const lines = html.split('\n');
    const result = [];
    let i = 0;
    let inList = null, inTable = false, tableHtml = [];

    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trim();

      // 表格检测
      if (inTable) {
        if (line.startsWith('|') && line.endsWith('|')) {
          // 跳过分隔行
          if (!/^\|[\s\-:]+\|$/.test(line)) {
            const cells = line.split('|').slice(1, -1).map(c => `<td>${c.trim()}</td>`).join('');
            tableHtml.push(`<tr>${cells}</tr>`);
          }
          i++; continue;
        } else {
          // 表格结束
          result.push(`<table>${tableHtml.join('')}</table>`);
          inTable = false; tableHtml = [];
          continue;
        }
      }
      if (line.startsWith('|') && line.endsWith('|') && raw.indexOf('|') !== raw.lastIndexOf('|')) {
        const cells = line.split('|').slice(1, -1).map(c => `<th>${c.trim()}</th>`).join('');
        tableHtml.push(`<tr>${cells}</tr>`);
        // 看下一行是不是分隔行
        const nextLine = (lines[i+1] || '').trim();
        if (nextLine.startsWith('|') && /^\|[\s\-:]+\|$/.test(nextLine)) {
          inTable = true; i += 2; continue;
        } else {
          tableHtml = []; // 不是表格，回退
        }
      }

      // 标题
      if (/^#{1,4}\s/.test(line)) {
        if (inList) { result.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }
        const m = line.match(/^(#{1,4})\s+(.+)/);
        result.push(`<h${m[1].length}>${m[2]}</h${m[1].length}>`);
        i++; continue;
      }

      // 引用
      if (raw.startsWith('>')) {
        if (inList) { result.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }
        const content = raw.replace(/^>\s?/, '');
        result.push(`<blockquote>${content}</blockquote>`);
        i++; continue;
      }

      // 水平线
      if (/^[-*_]{3,}$/.test(line)) {
        if (inList) { result.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }
        result.push('<hr>');
        i++; continue;
      }

      // 无序列表
      if (/^[-*]\s/.test(raw)) {
        if (inList !== 'ul') {
          if (inList) result.push('</ol>');
          result.push('<ul>');
          inList = 'ul';
        }
        result.push(`<li>${raw.replace(/^[-*]\s+/, '')}</li>`);
        i++; continue;
      }

      // 有序列表
      if (/^\d+\.\s/.test(raw)) {
        if (inList !== 'ol') {
          if (inList) result.push('</ul>');
          result.push('<ol>');
          inList = 'ol';
        }
        result.push(`<li>${raw.replace(/^\d+\.\s+/, '')}</li>`);
        i++; continue;
      }

      // 退出列表
      if (inList) { result.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }

      // 空行 → 段落分隔
      if (line === '') {
        result.push('<br>');
        i++; continue;
      }

      // 普通段落
      result.push(`<p>${line}</p>`);
      i++;
    }
    if (inList) { result.push(inList === 'ul' ? '</ul>' : '</ol>'); }
    if (inTable && tableHtml.length) { result.push(`<table>${tableHtml.join('')}</table>`); }

    html = result.join('\n');

    // 4. 行内格式 (在非代码区域)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');  // 斜体用 _
    html = html.replace(/(?<!\*)\*(.+?)\*(?!\*)/g, '<em>$1</em>'); // 跳过 **
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // 5. 链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-link" target="_blank">$1</a>');

    // 6. 自动链接裸 URL
    html = html.replace(/(https?:\/\/[^\s<>\[\]()]+)/g, '<a href="$1" class="chat-link" target="_blank">$1</a>');

    // 7. 还原代码块
    html = html.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlocks[parseInt(i)]);

    return html;
  }

  function renderFinal(cleanText) {
    return wrapResponse(renderMarkdown(cleanText));
  }

  // 填充话术（对话引导模式：开场白→用户打字→Hermes自然追问）
  let currentAction = null;
  let _rolesList = []; // 动态角色列表（数组，保持顺序）
  let _switchingRole = false;  // 切角色中，阻断事件写入
  function fillPrompt(action) {
    const q = questionnaires[action];
    if (!q) return;
    currentAction = action;

    // 只有侧边栏有的功能才高亮侧边栏按钮
    if (!action.startsWith('channel_')) {
      document.querySelectorAll('.func-item, .role-item').forEach(b => b.classList.remove('active'));
      const btn = document.querySelector(`.func-item[data-action="${action}"]`);
      if (btn) btn.classList.add('active');
    }

    // 确保在主页
    if (!document.getElementById('pageHome').classList.contains('active')) {
      switchPage('pageHome');
    }

    updateToolbarTitle(q.name);
    // 初始化对话上下文
    questionnaireHistory = `[对话引导模式 - ${q.name}]\n`;
    // 只发开场白，接下来的追问交给 Hermes
    addChatMessage('hermes', q.opening);
    document.getElementById('chatInput').value = '';
    document.getElementById('chatInput').focus();
  }


  // ===== 未读消息角标 =====
  let _unreadCounts = {};
  try {
    _unreadCounts = JSON.parse(localStorage.getItem('hermes_unread') || '{}');
  } catch(e) { _unreadCounts = {}; }

  function saveUnread() {
    try { localStorage.setItem('hermes_unread', JSON.stringify(_unreadCounts)); } catch(e) {}
  }

  function renderUnreadBadge(role) {
    const badge = document.querySelector('.unread-badge[data-role="' + role + '"]');
    if (!badge) return;
    const count = _unreadCounts[role] || 0;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
      badge.textContent = '';
    }
  }

  function renderAllUnread() {
    Object.keys(_unreadCounts).forEach(renderUnreadBadge);
  }

  function bumpUnread(role) {
    if (!role) return;
    _unreadCounts[role] = (_unreadCounts[role] || 0) + 1;
    saveUnread();
    renderUnreadBadge(role);
  }

  function clearUnread(role) {
    _unreadCounts[role] = 0;
    saveUnread();
    renderUnreadBadge(role);
  }
  function handleRole(role) {
    if (!role || _switchingRole) return;
    _switchingRole = true;
    // 立即停掉旧角色的流，防止数据串到新角色面板
    _clearPendingTimer();
    _streamActive = false;
    _streamTarget = null;
    _streamRole = null;
    localStorage.removeItem('hermes_streaming');
    try {
      // 保存当前角色的聊天记录
      saveChatHistoryNow();
      document.querySelectorAll('.func-item, .role-item').forEach(b => b.classList.remove('active'));
      const btn = document.querySelector('.role-item[data-role="'+role+'"]');
      if (btn) btn.classList.add('active');
      if (!document.getElementById('pageHome').classList.contains('active')) {
        switchPage('pageHome');
      }
      currentAction = role;
      localStorage.setItem('hermes_last_role', role);
      clearUnread(role);
      questionnaireHistory = '';
      const chatHistory = document.getElementById('chatHistory');
      if (chatHistory) chatHistory.innerHTML = '';
      loadChatHistory();
      const rd = ROLES[role];
      if (rd && chatHistory && chatHistory.querySelectorAll('.chat-msg').length === 0) {
        const opening = rd.systemPrompt ? `我是${rd.name}。${rd.systemPrompt.replace(/你是"|"/g, '').split('。')[0]}。\n\n有什么需要帮忙的？` : `我是${rd.name}，有什么需要帮忙的？`;
        addChatMessage('hermes', opening);
      }
      const input = document.getElementById('chatInput');
      if (input) { input.value = ''; input.focus(); }
      updateToolbarTitle(getRoleTitle(role));
      updateRoleIndicator(role);
    } finally {
      _switchingRole = false;
    }
  }

  function updateToolbarTitle(title) {
    const el = document.getElementById('chatToolbarTitle');
    if (el && title) el.textContent = title;
  }

  // ===== 角色指示器 & 切换弹出菜单 =====
  function updateRoleIndicator(role) {
    const r = ROLES[role];
    if (!r) return;
    const indicator = document.getElementById('roleIndicator');
    if (!indicator) return;
    indicator.querySelector('.ri-name').textContent = r.name;
    const avatar = indicator.querySelector('.ri-avatar');
    // 优先使用 avatarPreset
    const preset = r.avatarPreset || '';
    avatar.src = preset ? `avatar://${preset}.png?t=${Date.now()}` : `avatar://${role}.png?t=${Date.now()}`;
    avatar.alt = r.name;
    avatar.style.display = '';
    // 移除旧 fallback
    const fb = indicator.querySelector('.ri-avatar-fb');
    if (fb) fb.remove();
    // onerror fallback: 隐藏图片，显示颜色圆形
    avatar.onerror = function() {
      avatar.src = 'avatar://dami.png'; // fallback to dami
    };
  }

  // ===== 动态侧边栏渲染 =====
  function renderSidebar() {
    const container = document.getElementById('sidebarRoles');
    if (!container) return;
    // 大秘单独显示在顶部
    const dami = _rolesList.find(r => r.id === 'dami');
    const others = _rolesList.filter(r => r.id !== 'dami');
    let html = '';
    // 大秘
    if (dami) {
      html += renderRoleItem(dami);
      html += '<div class="sidebar-divider"></div>';
    }
    // 标签
    html += '<div class="sidebar-section"><div class="sidebar-label">我的团队</div>';
    others.forEach(r => { html += renderRoleItem(r); });
    html += '</div>';
    // 添加员工按钮
    html += `<button class="sidebar-add-role-btn" onclick="openRoleEditor()" title="添加员工">
      <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>添加员工</span>
    </button>`;
    container.innerHTML = html;
    // 高亮当前选中
    if (currentAction) {
      const btn = container.querySelector(`.role-item[data-role="${currentAction}"]`);
      if (btn) btn.classList.add('active');
    }
  }

  function renderRoleItem(r) {
    const preset = r.avatarPreset || r.id;
    const avatarHTML = `<img class="si-avatar" src="avatar://${preset}.png" alt="${r.name}" />`;
    return `<button class="sidebar-item role-item" data-role="${r.id}" onclick="handleRole('${r.id}')">
      <span class="unread-badge" data-role="${r.id}"></span>
      ${avatarHTML}
      <span class="si-label">${r.name}</span>
      <span class="si-edit-btn" onclick="event.stopPropagation();openRoleEditor('${r.id}')" title="编辑员工">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </span>
    </button>`;
  }

  // ===== 角色编辑器 =====
  const AVATAR_PRESETS = [
    'dami', 'accountant', 'programmer', 'writer', 'screenwriter', 'tutor', 'health', 'investor',
    'health-advisor', 'manager', 'secretary', 'teacher'
  ];

  function openRoleEditor(roleId) {
    const overlay = document.getElementById('roleEditorOverlay');
    if (!overlay) return;
    const title = document.getElementById('reTitle');
    const nameInput = document.getElementById('reName');
    const promptInput = document.getElementById('rePrompt');
    const avatarGrid = document.getElementById('reAvatarGrid');
    const deleteBtn = document.getElementById('reDeleteBtn');

    let role = null;
    if (roleId) {
      role = _rolesList.find(r => r.id === roleId);
    }

    if (title) title.textContent = role ? '编辑员工' : '新建员工';
    if (nameInput) nameInput.value = role ? role.name : '';
    if (promptInput) promptInput.value = role ? (role.systemPrompt || '') : '';

    // 预设头像网格
    const currentPreset = role?.avatarPreset || AVATAR_PRESETS[0];
    if (avatarGrid) {
      avatarGrid.innerHTML = AVATAR_PRESETS.map(p =>
        `<span class="re-avatar-swatch${p === currentPreset ? ' selected' : ''}" data-preset="${p}" onclick="selectRoleAvatar('${p}')">
          <img src="avatar://${p}.png" alt="${p}" onerror="this.parentElement.style.display='none'" />
        </span>`
      ).join('');
      avatarGrid.dataset.selected = currentPreset;
    }

    // 删除按钮：仅非内置角色可删
    if (deleteBtn) {
      deleteBtn.style.display = (role && !role.builtIn) ? '' : 'none';
    }

    // 存储当前编辑的角色 ID
    overlay.dataset.roleId = roleId || '';
    overlay.dataset.avatarPreset = currentPreset;
    showOverlay('roleEditorOverlay');
  }

  function closeRoleEditor() {
    hideOverlay('roleEditorOverlay');
  }

  function selectRoleAvatar(preset) {
    const overlay = document.getElementById('roleEditorOverlay');
    const avatarGrid = document.getElementById('reAvatarGrid');
    if (!overlay || !avatarGrid) return;
    overlay.dataset.avatarPreset = preset;
    avatarGrid.dataset.selected = preset;
    avatarGrid.querySelectorAll('.re-avatar-swatch').forEach(s => {
      s.classList.toggle('selected', s.dataset.preset === preset);
    });
  }

  async function saveRole() {
    const overlay = document.getElementById('roleEditorOverlay');
    if (!overlay) return;
    const roleId = overlay.dataset.roleId;
    const name = document.getElementById('reName')?.value?.trim();
    const systemPrompt = document.getElementById('rePrompt')?.value?.trim();
    const avatarPreset = overlay.dataset.avatarPreset || AVATAR_PRESETS[0];

    if (!name) { showDialog('⚠️', '请输入员工名称'); return; }

    try {
      if (roleId) {
        // 编辑已有角色
        await window.hermes.rolesUpdate(roleId, { name, systemPrompt, avatarPreset });
      } else {
        // 新建角色
        await window.hermes.rolesAdd({ name, systemPrompt, avatarPreset });
      }
      // 重新加载
      await loadRolesFromIPC();
      renderSidebar();
      closeRoleEditor();
    } catch (e) {
      showDialog('⚠️', '保存失败: ' + (e.message || ''));
    }
  }

  async function deleteRole() {
    const overlay = document.getElementById('roleEditorOverlay');
    if (!overlay) return;
    const roleId = overlay.dataset.roleId;
    const role = _rolesList.find(r => r.id === roleId);
    if (!role) return;
    if (role.builtIn) { showDialog('⚠️', '默认员工不可删除'); return; }
    const confirmed = await showDialog('⚠️', `确定删除「${role.name}」？删除后无法恢复。`, true);
    if (!confirmed) return;
    try {
      await window.hermes.rolesDelete(roleId);
      await loadRolesFromIPC();
      // 如果删除的是当前角色，切回大秘
      if (currentAction === roleId) {
        handleRole('dami');
      }
      renderSidebar();
      closeRoleEditor();
    } catch (e) {
      showDialog('⚠️', '删除失败: ' + (e.message || ''));
    }
  }

  function toggleRoleSwitcher() {
    const popup = document.getElementById('roleSwitcher');
    const isOpen = popup.classList.contains('show');
    if (isOpen) { popup.classList.remove('show'); return; }

    // 构建角色列表（使用动态角色）
    const list = document.getElementById('rsList');
    list.innerHTML = _rolesList.map(r => {
      const preset = r.avatarPreset || r.id;
      const avatarHTML = `<img src="avatar://${preset}.png" alt="${r.name}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`;
      return `<button class="rs-item${currentAction === r.id ? ' active' : ''}" onclick="event.stopPropagation();switchRole('${r.id}')">
        ${avatarHTML}
        <span>${r.name}</span>
      </button>`;
    }).join('');

    // 定位在角色指示器上方
    const btn = document.getElementById('roleIndicator');
    const rect = btn.getBoundingClientRect();
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    popup.style.left = (rect.left - 6) + 'px';
    popup.classList.add('show');

    // 点击外部关闭（先移除旧监听防止泄漏）
    if (popup._closeHandler) document.removeEventListener('click', popup._closeHandler);
    setTimeout(() => {
      popup._closeHandler = function closeRS(e) {
        if (!popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
          popup.classList.remove('show');
          document.removeEventListener('click', closeRS);
          popup._closeHandler = null;
        }
      };
      document.addEventListener('click', popup._closeHandler);
    }, 10);
  }

  function switchRole(role) {
    document.getElementById('roleSwitcher').classList.remove('show');
    handleRole(role);
    updateRoleIndicator(role);
  }

  // 场景卡片 HTML
  function getSceneCardsHTML() {
    const r = currentAction || 'dami';
    const name = (ROLES[r] && ROLES[r].name) || '大秘';
    return `<div class="home-scene-cards">
      <div class="scene-cards-role-hint">${name} 可以帮你——</div>
      <div class="scene-card" onclick="handleSceneCard('${r}','帮我把这个PDF总结成3个要点')"><span class="scene-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span><span class="scene-text">把PDF总结成要点</span><span class="scene-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>
      <div class="scene-card" onclick="handleSceneCard('${r}','帮我写一份这周的工作周报')"><span class="scene-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><span class="scene-text">写一份工作周报</span><span class="scene-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>
      <div class="scene-card" onclick="handleSceneCard('${r}','帮我分析这个Excel表格的数据')"><span class="scene-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span><span class="scene-text">分析Excel表格数据</span><span class="scene-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>
      <div class="scene-card" onclick="handleSceneCard('${r}','帮我搜一下最近AI行业的新动态')"><span class="scene-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span><span class="scene-text">搜索最新行业动态</span><span class="scene-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>
      <div class="scene-card" onclick="handleSceneCard('${r}','帮我起草一份租房合同')"><span class="scene-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span><span class="scene-text">起草一份租房合同</span><span class="scene-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>
      <div class="scene-card" onclick="handleSceneCard('${r}','帮我规划下周的健身和饮食计划')"><span class="scene-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span><span class="scene-text">规划健身饮食计划</span><span class="scene-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>
      <div class="home-hint">或直接打字，说说你想做什么</div>
    </div>`;
  }

  function handleSceneCard(role, text) {
    // 切到对应角色
    if (typeof handleRole === 'function') {
      handleRole(role);
    }
    // 预填输入框
    const inp = document.getElementById('chatInput');
    if (inp) {
      inp.value = text;
      inp.focus();
    }
  }

  function goHome() {
    _switchingRole = true;
    saveChatHistoryNow();
    document.querySelectorAll('.func-item, .role-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page-item').forEach(b => b.classList.remove('active'));
    const damiBtn = document.querySelector('.page-item[data-page="pageHome"]');
    if (damiBtn) damiBtn.classList.add('active');
    switchPage('pageHome');
    currentAction = 'chat';
    clearUnread('chat');
    questionnaireHistory = '';
    // 切回主页时强清残留 streaming 状态
    _clearPendingTimer();
    _streamActive = false;
    toggleCancelButton(false);
    _streamTarget = null;
    localStorage.removeItem('hermes_streaming');
    document.getElementById('chatHistory').innerHTML = '';
    loadChatHistory();
    updateToolbarTitle('我的大秘');
    _switchingRole = false;
    if (document.getElementById('chatHistory').querySelectorAll('.chat-msg').length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.innerHTML = getSceneCardsHTML();
      document.getElementById('chatHistory').appendChild(empty);
    }
  }

  // ===== 头像上传 — 存文件，不依赖 localStorage =====
  async function uploadAvatar(role) {
    const img = document.querySelector(`img.si-avatar[alt="${getRoleTitle(role)}"]`)
             || document.querySelector(`.role-item[data-role="${role}"] img.si-avatar`);
    if (img) { img.style.opacity = '0.5'; img.style.transition = 'opacity 0.2s'; }
    try {
      const res = await window.hermes.uploadAvatar(role);
      if (!res.success) {
        if (res.reason !== 'canceled') showDialog('❌', '上传失败：' + (res.reason || '未知错误'));
        return;
      }
      if (img) {
        clearAvatarFallback(img);
        img.src = `avatar://${role}.png?t=${Date.now()}`;
      }
    } catch (e) {
      showDialog('❌', '上传失败：' + (e.message || '网络错误'));
    } finally {
      if (img) img.style.opacity = '1';
    }
  }

  // 删除自定义头像，恢复为默认
  async function resetAvatar(role) {
    try {
      await window.hermes.removeAvatar(role);
      const img = document.querySelector(`img.si-avatar[alt="${getRoleTitle(role)}"]`)
               || document.querySelector(`.role-item[data-role="${role}"] img.si-avatar`);
      if (img) {
        clearAvatarFallback(img);
        img.src = `avatar://${role}.png?t=${Date.now()}`;
        // 文件已删除，重新检查是否需要 fallback
        try {
          const r = await window.hermes.getCustomAvatar(role);
          if (!r.exists) applyAvatarFallback(img, role);
        } catch (e) {}
      }
    } catch (e) {
      console.error('重置头像失败:', e);
    }
  }

  function getRoleTitle(role) {
    const r = ROLES[role];
    return r ? r.name : role;
  }

  function applyAvatarFallback(img, role) {
    if (img._fbApplied) return;
    img._fbApplied = true;
    img.src = 'avatar://dami.png';
  }

  function clearAvatarFallback(img) {
    if (img._fbEl) { img._fbEl.remove(); img._fbEl = null; }
    img._fbApplied = false;
    img.style.display = '';
  }

  async function initCustomAvatars() {
    for (const img of document.querySelectorAll('img.si-avatar')) {
      const role = getRoleFromAvatarImg(img);
      if (!role) continue;
      // 优先使用预设头像
      const roleData = _rolesList.find(x => x.id === role);
      const preset = roleData?.avatarPreset || '';
      if (preset) {
        img.src = `avatar://${preset}.png?t=${Date.now()}`;
      } else {
        img.src = `avatar://${role}.png?t=${Date.now()}`;
      }
      // 通过 IPC 确认自定义头像是否存在
      try {
        const r = await window.hermes.getCustomAvatar(role);
        if (r.exists) {
          // 有自定义头像，使用 data URL
          img.src = r.dataUrl;
          clearAvatarFallback(img);
        } else if (!preset) {
          // 无预设也无自定义，显示颜色 fallback
          applyAvatarFallback(img, role);
        }
      } catch (e) {
        // IPC 失败，不做 fallback
      }
    }
  }

  function getRoleFromAvatarImg(img) {
    // 从 alt 属性反查 role
    const alt = img.alt || '';
    for (const r of _rolesList) {
      if (alt === r.name || alt.includes(r.name)) return r.id;
    }
    // fallback to keyword matching
    const roleMap = [
      ['dami', '大秘'], ['accountant', '会计'], ['programmer', '程序员'],
      ['writer', '作家'], ['screenwriter', '编剧'], ['tutor', '私教'], ['health', '健康顾问'], ['investor', '投资顾问']
    ];
    for (const [role, keyword] of roleMap) {
      if (alt.includes(keyword)) return role;
    }
    return null;
  }


  function resetMode() {
    currentAction = 'chat';
    questionnaireHistory = '';
    document.querySelectorAll('.func-item').forEach(b => b.classList.remove('active'));
    // 清空对话历史
    const hist = document.getElementById('chatHistory');
    hist.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.innerHTML = getSceneCardsHTML();
    hist.appendChild(empty);
    localStorage.removeItem(chatStorageKey());
    document.getElementById('chatInput').value = '';
    document.getElementById('chatInput').focus();
  }

  function scrollChat() {
    const h = document.getElementById('chatHistory');
    if (!h) return;
    requestAnimationFrame(() => {
      h.scrollTop = h.scrollHeight;
    });
  }

  // 当前流式步骤收集器
  let _streamSteps = [];
  let _streamStepEl = null;
  let _streamStartTime = 0;

  // 接收后端流式推送的实时步骤
  window.hermes_on.stream((data) => {
    if (!_streamActive || !_streamTarget || _switchingRole) return;
    // 只处理当前角色的流，忽略旧角色的残留数据
    if (_streamRole && _streamRole !== (currentAction || 'chat')) return;
    const step = (data && data.text) ? data.text.trim() : '';
    if (!step || step.startsWith('│') || step.startsWith('╭') || step.startsWith('╰')) return;

    _streamSteps.push(step);
    _renderStreamSteps();
  });

  function _renderStreamSteps() {
    if (!_streamStepEl || !_streamTarget) return;
    const steps = _streamSteps.slice(-5); // 只显示最近 5 步
    _streamStepEl.innerHTML = steps.map((s, i) => {
      const isLast = i === steps.length - 1;
      return `<div class="stream-step ${isLast ? 'active' : 'done'}">
        <span class="stream-step-dot">${isLast ? '●' : '✓'}</span>
        <span class="stream-step-text">${s.replace(/^┊\s*/, '')}</span>
      </div>`;
    }).join('');
  }

  function _initStreamSteps(loadingMsg) {
    _streamSteps = [];
    _streamStartTime = Date.now();
    _streamStepEl = document.createElement('div');
    _streamStepEl.className = 'stream-steps';
    loadingMsg.appendChild(_streamStepEl);
  }

  function addChatMessage(role, text, fileNames, msgTime, platform) {
    const history = document.getElementById('chatHistory');
    const empty = history.querySelector('.chat-empty');
    if (empty) empty.style.display = 'none';

    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;

    const now = new Date();
    const time = msgTime || `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    let inner = '';
    if (platform) {
      inner += `<span class="platform-badge">📱 来自${platform}</span> `;
    }
    inner += renderMarkdown(text);
    if (fileNames && fileNames.length > 0) {
      fileNames.forEach(f => { inner += `<br><span class="files-badge">📎 ${f}</span>`; });
    }
    inner += `<span class="time">${time}</span>`;

    div.setAttribute('data-text', text);
    div.innerHTML = inner;
    // Hermes 回复加操作栏
    if (role === 'hermes' && text !== '思考中') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = '<button class="msg-action-btn" title="复制" onclick="event.stopPropagation();copyMsgReply(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
        '<button class="msg-action-btn" title="重新生成" onclick="event.stopPropagation();retryMsg(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>' +
        '<button class="msg-action-btn feedback-btn" title="有用" onclick="event.stopPropagation();feedbackMsg(this,\'up\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg></button>' +
        '<button class="msg-action-btn feedback-btn" title="没用" onclick="event.stopPropagation();feedbackMsg(this,\'down\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V4H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/></svg></button>';
      div.appendChild(actions);
    }
    history.appendChild(div);
    scrollChat();

    return div;
  }

  // ===== 消息快捷操作 =====
  function copyMsgReply(btn) {
    const msg = btn.closest('.chat-msg');
    const text = msg ? msg.getAttribute('data-text') || msg.textContent : '';
    navigator.clipboard.writeText(text.trim()).then(() => {
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      }, 1500);
    }).catch(() => {});
  }

  function retryMsg(btn) {
    const msg = btn.closest('.chat-msg');
    if (!msg) return;
    // 找到这条回复之前的用户消息
    const userMsg = msg.previousElementSibling;
    if (userMsg && userMsg.classList.contains('user')) {
      const input = document.getElementById('chatInput');
      const userText = userMsg.getAttribute('data-text') || userMsg.textContent || '';
      if (userText && input) {
        input.value = userText.trim();
        input.focus();
        sendMessage();
      }
    }
  }

  function feedbackMsg(btn, type) {
    const wasActive = btn.classList.contains('active');
    // 清除同组其他按钮状态
    btn.parentElement.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('active'));
    if (!wasActive) btn.classList.add('active');
    // TODO: 上报反馈数据
  }

  // 聊天区域点击链接 → 用系统浏览器打开
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.chat-link');
    if (a && a.href) {
      e.preventDefault();
      window.hermes.openExternal(a.href).catch(() => {});
    }
  });

  // 发送消息（对话引导模式：累积Q&A上下文，Hermes自然追问）
  // 重置流式状态
  function _resetStreamState() {
    _streamActive = false;
    toggleCancelButton(false);
    localStorage.removeItem('hermes_streaming');
  }

  // 渲染成功响应到 loading 消息
  function _renderSuccess(loadingMsg, cleanText, result) {
    const cost = (result && result.cost) ? result.cost : 0;
    const balance = (result && result.balance != null) ? result.balance : null;
    const costLine = cost > 0 ? `\n\n<span class="cost-tag">消耗 ${cost} 积分${balance != null ? ' · 剩余 ' + balance : ''}</span>` : '';

    // 思考耗时指示
    let durHTML = '';
    if (_streamStartTime > 0) {
      const dur = Math.round((Date.now() - _streamStartTime) / 1000);
      durHTML = `<span class="duration-tag">${dur}秒</span>`;
    }

    const timeStr = new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
    loadingMsg.innerHTML = renderFinal(cleanText) + costLine + `<span class="time">${durHTML} ${timeStr}</span>`;
    loadingMsg.removeAttribute('data-pending');
    scrollChat();
    updateCreditsBadge();
  }

  // 渲染失败响应到 loading 消息
  function _renderError(loadingMsg, err, sendingRole) {
    const errMsg = friendlyError(err);
    loadingMsg.innerHTML = `❌ 发送失败：${errMsg}<span class="time">${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span>`;
    showConnBanner(errMsg, true);
    startConnMonitor();
    saveResponseToRole(sendingRole, `❌ 发送失败：${errMsg}`);
  }

  async function sendMessage() {
    // 防重复发送
    if (_streamActive) return;

    _streamStartTime = Date.now();

    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    const fileNames = chatFilePaths.map(f => f.name);

    if (!text && fileNames.length === 0) return;

    // 防御：IPC 桥丢失
    if (!window.hermes || !window.hermes.execute) {
      addChatMessage('hermes', '⚠️ 连接中断，请按 Cmd+R 刷新页面');
      return;
    }

    // 积分预检查
    const creditsCheck = await checkCreditsBeforeSend();
    if (!creditsCheck.ok) {
      addChatMessage('hermes', '🪙 积分不足，请充值后继续使用。\n\n当前余额：' + creditsCheck.credits + ' 分');
      input.value = text;
      input.focus();
      showActivationDialog();
      return;
    }

    // 保存文件路径，清空 UI
    const sendPaths = chatFilePaths.map(f => f.path);
    addChatMessage('user', text || '(已选文件)', fileNames.length > 0 ? fileNames : null);
    input.value = '';
    chatFilePaths.length = 0;
    document.getElementById('chatFiles').innerHTML = '';

    const effectiveAction = currentAction || 'chat';
    const sendingRole = effectiveAction;
    const sendingKey = chatStorageKey();

    // === 对话引导模式 ===
    if (effectiveAction !== 'chat' && questionnaires[effectiveAction]) {
      const q = questionnaires[effectiveAction];
      questionnaireHistory += `用户回答：${text}\n`;

      const fullPrompt = `[对话引导模式 - ${q.name}]

你是 Hergent，正在和用户聊${q.name}。说话风格像多年老友——懂行、利索、不啰嗦。

你的任务：通过自然聊天了解用户的实际需求和偏好。不是填表，是聊天。

你需要了解的关键信息：
${q.knowledge.map(k => `· ${k}`).join('\n')}

聊天原则：
- 一次只聊一个话题，顺着对话自然推进
- 多用开放式提问
- 不要审问语气，不要列问题清单，不要客套话
- 保持老友口吻

${q.wrap_up}

对话记录：
${questionnaireHistory}`;

      const loadingMsg = addChatMessage('hermes', '思考中');
      _initStreamSteps(loadingMsg);
      loadingMsg.setAttribute('data-pending', 'true');
      _streamTarget = loadingMsg;
      _streamActive = true;
      _streamRole = currentAction || 'chat';
      toggleCancelButton(true);
      _startPendingTimer(loadingMsg);
      _streamKey = sendingKey;
      localStorage.setItem('hermes_streaming', sendingRole || 'chat');

      if (!window.hermes || !window.hermes.execute) {
        _resetStreamState();
        loadingMsg.innerHTML = '⚠️ 连接中断，请按 Cmd+R 刷新页面';
        return;
      }

      try {
        const result = await window.hermes.execute('chat:send', { action: 'chat', text: fullPrompt, files: sendPaths });
        if (result && result.requestId) loadingMsg.setAttribute('data-reqid', result.requestId);
        _resetStreamState();

        if (sendingRole !== (currentAction || 'chat') || !document.getElementById('pageHome').classList.contains('active')) bumpUnread(sendingRole);

        const resp = ((result && result.output) ? result.output : '✅ 已提交处理')
          .replace(/^session_id:.*\n?/gm, '').replace(/\n{2,}/g, '\n');
        _renderSuccess(loadingMsg, resp, result);

        const roleTitle = ROLES[sendingRole] ? ROLES[sendingRole].name : '大秘';
        notifyIfAway(`${roleTitle} 的回复`, resp.slice(0, 80) + (resp.length > 80 ? '...' : ''));
        questionnaireHistory += `Hermes：${resp}\n`;

        // 持久化到对应角色的 localStorage
        (() => {
          const msgs = JSON.parse(localStorage.getItem(sendingKey) || '[]');
          const last = msgs[msgs.length - 1];
          if (last && last.text === '思考中') {
            last.text = resp; last.time = new Date().toISOString();
          } else {
            msgs.push({ role: 'hermes', text: resp, time: new Date().toISOString() });
          }
          localStorage.setItem(sendingKey, JSON.stringify(msgs));
          if (!loadingMsg.isConnected) loadChatHistory();
        })();
      } catch (e) {
        localStorage.setItem('_dbg_qerr', e.message + '|' + (e.stack||'').slice(0,100));
        _resetStreamState();
        if (sendingRole !== (currentAction || 'chat') || !document.getElementById('pageHome').classList.contains('active')) bumpUnread(sendingRole);
        _renderError(loadingMsg, e, sendingRole);
        // 持久化错误
        (() => {
          const msgs = JSON.parse(localStorage.getItem(sendingKey) || '[]');
          const last = msgs[msgs.length - 1];
          const errText = loadingMsg.querySelector('.time') ? loadingMsg.textContent.replace(/\d{2}:\d{2}$/, '').trim() : '❌ 发送失败';
          if (last && last.text === '思考中') { last.text = errText; last.time = new Date().toISOString(); }
          else { msgs.push({ role: 'hermes', text: errText, time: new Date().toISOString() }); }
          localStorage.setItem(sendingKey, JSON.stringify(msgs));
          if (!loadingMsg.isConnected) loadChatHistory();
        })();
      }
      return;
    }

    // === 普通聊天模式 ===
    localStorage.setItem('hermes_streaming', sendingRole || 'chat');
    const loadingMsg = addChatMessage('hermes', '思考中');
      _initStreamSteps(loadingMsg);
    loadingMsg.setAttribute('data-pending', 'true');
    _streamTarget = loadingMsg;
    _streamActive = true;
    _streamRole = currentAction || 'chat';
    toggleCancelButton(true);
    _startPendingTimer(loadingMsg);
    _streamKey = sendingKey;

    if (!window.hermes || !window.hermes.execute) {
      _resetStreamState();
      loadingMsg.innerHTML = '⚠️ 连接中断，请按 Cmd+R 刷新页面';
      return;
    }

    try {
      const isRole = ROLES[effectiveAction];
      const isOnboarding = localStorage.getItem('hermes_onboarding') === '1';
      let sendText = text;
      if (isRole) {
        sendText = `[系统指令：${isRole.systemPrompt} 你现在以"${isRole.name}"的身份回复用户。]\n\n${text}`;
      }
      if (isOnboarding) {
        sendText = `[引导模式——用户第一次使用Hergent。请回复：先友好地问候，然后问用户"你平时主要做什么工作/学什么？"，根据回复推荐1-2个合适的数字员工角色。简洁自然，像朋友聊天。]\n\n[用户消息]${text}`;
      }

      const result = await window.hermes.execute('chat:send', { action: isRole ? 'chat' : effectiveAction, text: sendText, files: sendPaths, role: sendingRole });
      if (result && result.requestId) loadingMsg.setAttribute('data-reqid', result.requestId);
      _resetStreamState();

      const outClean = ((result && result.output) ? result.output : '✅ 已提交处理')
        .replace(/^session_id:.*\n?/gm, '').replace(/\n{2,}/g, '\n');
      _renderSuccess(loadingMsg, outClean, result);

      saveResponseToRole(sendingRole, outClean);

      if (isOnboarding) {
        localStorage.removeItem('hermes_onboarding');
        localStorage.setItem('hermes_onboarding_done', '1');
      }
      if (!loadingMsg.isConnected) loadChatHistory();
    } catch (e) {
      localStorage.setItem('_dbg_err', e.message + '|' + (e.stack||'').slice(0,100));
      _resetStreamState();
      _renderError(loadingMsg, e, sendingRole);
      if (!loadingMsg.isConnected) loadChatHistory();
    }
  }

  // 统一：将角色名映射到存储 key（dami/chat/null 都归到 hermes_chat）
  function roleStorageKey(role) {
    const normalized = (!role || role === 'chat' || role === 'null' || role === 'dami') ? 'chat' : role;
    return normalized === 'chat' ? 'hermes_chat' : `hermes_chat_${normalized}`;
  }

  // 将 Hermes 回复存入指定角色的 localStorage（跨角色切换时用）
  function saveResponseToRole(role, text) {
    // 回复的不是当前正在看的角色对话，加未读
    const _viewing = currentAction || 'chat';
    const _homeActive = document.getElementById('pageHome').classList.contains('active');
    // 用统一的 key 映射比较（dami 和 chat 是同一个角色）
    const viewingKey = roleStorageKey(_viewing);
    const sendingKey = roleStorageKey(role);
    if (sendingKey !== viewingKey || !_homeActive) bumpUnread(role);
    const storageKey = sendingKey;
    try {
      const msgs = JSON.parse(localStorage.getItem(storageKey) || '[]');
      // 如果最后一条是“思考中”就替换，否则追加
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'hermes' && last.text === '思考中') {
        last.text = text;
        last.time = new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}).replace(/^0/,'');
      } else {
        msgs.push({ role: 'hermes', text, files: [], time: new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}).replace(/^0/,'') });
        if (msgs.length > 200) msgs = msgs.slice(-150);
      }
      localStorage.setItem(storageKey, JSON.stringify(msgs));
    } catch(e) {}
  }

  // ===== 聊天持久化 =====
  let _loadingHistory = false;
  let pendingSaveChat = false;

  function debounceSaveChat() {
    if (!pendingSaveChat) return;
    pendingSaveChat = false;
    setTimeout(() => saveChatHistoryNow(), 300);
  }

  function chatStorageKey() {
    return roleStorageKey(currentAction);
  }

  function saveChatHistoryNow() {
    // 直接保存当前 localStorage 数据（addChatMessage 已在每次消息时实时写入）
    // 不再从 DOM 序列化，避免 DOM 状态与存储不一致导致消息丢失
    try {
      const key = chatStorageKey();
      const msgs = JSON.parse(localStorage.getItem(key) || '[]');
      // 过滤掉思考中占位
      const clean = msgs.filter(m => m.text !== '思考中' && !(m.text || '').includes('stream-status'));
      if (clean.length !== msgs.length) {
        localStorage.setItem(key, JSON.stringify(clean));
      }
    } catch (e) { /* localStorage 满了，忽略 */ }
  }

  // ===== 新建对话 =====
  async function newConversation() {
    const msgs = document.querySelectorAll('#chatHistory .chat-msg');
    if (msgs.length > 0) {
      const confirmed = await showDialog('💭', '新建对话会清空当前聊天记录\nHermes 对你的了解不会丢失', true);
      if (!confirmed) return;
    }
    _switchingRole = true;
    saveChatHistoryNow();
    localStorage.removeItem(chatStorageKey());
    window.hermes.sessionClear(currentAction || 'dami'); // 清除 main.js 缓存的旧会话
    document.getElementById('chatHistory').innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.innerHTML = getSceneCardsHTML();
    document.getElementById('chatHistory').appendChild(empty);
    document.getElementById('chatInput').value = '';
    document.getElementById('chatInput').focus();
    _switchingRole = false;
  }

  // ===== 对话导出 =====
  async function exportChat() {
    const history = document.getElementById('chatHistory');
    const msgs = history.querySelectorAll('.chat-msg');
    if (msgs.length === 0) {
      showDialog('📥', '当前没有对话内容可导出');
      return;
    }
    const role = currentAction || 'chat';
    const roleLabel = getRoleTitle(role) || '对话';
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + (now.getMonth()+1).toString().padStart(2,'0') + '-' + now.getDate().toString().padStart(2,'0');
    let md = '# ' + roleLabel + ' 对话记录\n> 导出时间：' + now.toLocaleString('zh-CN') + '\n\n---\n\n';
    msgs.forEach(div => {
      const isUser = div.classList.contains('user');
      const fromLabel = isUser ? '**你**' : '**' + roleLabel + '**';
      const timeSpan = div.querySelector('.time');
      const time = timeSpan ? ' ' + timeSpan.textContent : '';
      let text = div.getAttribute('data-text') || div.textContent || '';
      if (text === '思考中' || text.includes('stream-status') || text.includes('stream-response')) return;
      md += '### ' + fromLabel + time + '\n\n' + text + '\n\n---\n\n';
    });
    try {
      const result = await window.hermes.exportChat({ content: md, defaultName: 'chat_export_' + dateStr + '.md' });
      if (result.success) {
        showDialog('✅', '已导出到：\n' + result.filePath);
      } else if (!result.cancelled) {
        showDialog('❌', '导出失败：' + (result.error || '未知错误'));
      }
    } catch (e) {
      showDialog('❌', '导出失败：' + e.message);
    }
  }

  // 恢复流式进度占位（切回有活跃请求的角色时）
  function restoreStreamPlaceholder() {
    const streaming = localStorage.getItem('hermes_streaming');
    if (streaming && streaming === String(currentAction)) {
      const ph = addChatMessage('hermes', '思考中');
      ph.setAttribute('data-pending', 'true');
      _streamTarget = ph;
      _streamActive = true;
      _streamRole = currentAction || 'chat';
      toggleCancelButton(true);
      _startPendingTimer(ph);
      _streamKey = chatStorageKey();
      // 安全超时：30秒后还没收到响应则自动清除
      setTimeout(() => {
        if (ph.hasAttribute('data-pending')) {
          _clearPendingTimer();
          ph.removeAttribute('data-pending');
          ph.innerHTML = '思考超时，请重试<span class="time">' + new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</span>';
          _streamActive = false;
          toggleCancelButton(false);
          _streamTarget = null;
          localStorage.removeItem('hermes_streaming');
        }
      }, 30000);
    }
  }

  // 加载历史对话（按当前角色）
  function loadChatHistory() {
    const key = chatStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        _loadingHistory = true;
        const msgs = JSON.parse(saved);
        msgs.forEach(m => addChatMessage(m.role, m.text, m.files, m.time));
        _loadingHistory = false;
      } catch {
        _loadingHistory = false;
        localStorage.removeItem(key);
      }
    }
  }

  // 我的成果：加载三列卡片
  async function refreshReports() {
    const baseDir = window.hermes.reportsDir;
    const categories = [
      { folder: '业务报表', id: 'biz', empty: '对话中生成的报表、<br>数据分析等' },
      { folder: '我的创作', id: 'creative', empty: '帮你写的文案、方案、<br>邮件等创作内容' },
      { folder: '我的工具', id: 'tools', empty: '帮你做的App、脚本、<br>自动化工具等' }
    ];

    const results = await Promise.all(categories.map(cat =>
      window.hermes.execute('fs:list', { dir: `${baseDir}/${cat.folder}` }).catch(() => ({ files: [] }))
    ));

    let totalFiles = 0;
    categories.forEach((cat, i) => {
      const res = results[i];
      const files = (res && res.files || []).filter(f => f.endsWith('.md') || f.endsWith('.csv') || f.endsWith('.xlsx'));
      totalFiles += files.length;
      const cntEl = document.getElementById(`cnt_${cat.id}`);
      const fileDiv = document.getElementById(`files_${cat.id}`);

      if (cntEl) cntEl.textContent = files.length;

      if (files.length === 0) {
        fileDiv.innerHTML = `<div class="result-empty">${cat.empty}</div>`;
      } else {
        const sorted = files.sort().reverse().slice(0, 5);
        fileDiv.innerHTML = sorted.map(f => {
          const safe = f.replace(/'/g, "\\'").replace(/"/g, '&quot;');
          return `<div class="result-file-item" onclick="openReportFile('${cat.folder}/${safe}')" title="${f}"><span class="result-file-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>${f}</div>`;
        }).join('');
      }
    });

    // 整体空状态
    const gridEl = document.getElementById('reportsGrid');
    if (totalFiles === 0 && gridEl) {
      gridEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg><div class="empty-state-title">还没有成果</div><div class="empty-state-desc">让 Hermes 帮你写文档、做报表、生成工具，<br>产出会自动保存在这里</div></div>';
    }
  }

  // 打开成果文件
  async function openReportFile(relPath) {
    const fullPath = `${window.hermes.reportsDir}/${relPath}`;
    try {
      await window.hermes.execute('shell:open', { path: fullPath });
    } catch(e) {
      showDialog('❌', '无法打开文件：' + e.message);
    }
  }

  // 格式化实时步骤（保留图标，提取可读文本）
  function formatStreamStep(raw) {
    let s = raw.replace(/^┊\s*/, '').trim();
    // 去除耗时后缀如 " 0.6s"
    s = s.replace(/\s+\d+\.?\d*s$/, '');
    // 图标识别
    const iconMap = {
      '💻': '💻', '📄': '📄', '🌐': '🌐', '🔍': '🔍',
      '📊': '📊', '📝': '📝', '🔧': '🔧', '💰': '💰',
      '📁': '📁', '⚙️': '⚙️', '📋': '📋', '✅': '✅',
      '🧠': '🧠', '⌨️': '⌨️'
    };
    let icon = '';
    let text = s;
    for (const [emoji, _] of Object.entries(iconMap)) {
      if (s.startsWith(emoji)) {
        icon = emoji;
        text = s.replace(emoji, '').trim();
        break;
      }
    }
    // $ 命令
    if (s.startsWith('$')) {
      icon = '⌨️';
      const cmd = s.replace(/^\$\s*/, '');
      text = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    return { icon, text: text || s || '处理中' };
  }

  // 实时步骤流（飞书式逐行更新）
  let _streamTarget = null;
  let _streamActive = false;
  let _streamKey = null; // 异步回调时知道写哪个角色的 localStorage

  // 思考中计时器
  let _pendingTimer = null;
  function _startPendingTimer(targetEl) {
    if (_pendingTimer) { clearInterval(_pendingTimer); _pendingTimer = null; }
    targetEl.removeAttribute('data-stream-acc');
    targetEl.innerHTML = '<span class="pending-text">思考中</span>' +
      '<span class="pending-dot"></span><span class="pending-dot"></span><span class="pending-dot"></span>' +
      '<span class="pending-elapsed"></span>' +
      '<span class="time">' + (new Date()).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</span>';
    const startTime = Date.now();
    const elapsedEl = targetEl.querySelector('.pending-elapsed');
    _pendingTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      elapsedEl.textContent = '· ' + sec + 's';
    }, 1000);
  }
  function _clearPendingTimer() {
    if (_pendingTimer) { clearInterval(_pendingTimer); _pendingTimer = null; }
  }
  if (window.hermes_on && window.hermes_on.stream) {
    window.hermes_on.stream((data) => {
      if (_switchingRole || !_streamActive || !_streamTarget || !data.text) return;
      if (data.type === 'response') {
        // 流式响应：逐行累积 + 打字机效果
        _clearPendingTimer();
        let acc = _streamTarget.getAttribute('data-stream-acc') || '';
        acc += data.text + '\n';
        _streamTarget.setAttribute('data-stream-acc', acc);
        const fullHtml = wrapResponse(acc.replace(/\n/g, '<br>'));
        _streamTarget.setAttribute('_fullHtml', fullHtml);
        // 启动打字机（如未运行）
        if (!_streamTarget._twRunning) {
          _streamTarget._twRunning = true;
          let pos = parseInt(_streamTarget.getAttribute('_twPos') || '0');
          function twTick() {
            if (!_streamActive || !_streamTarget || !_streamTarget.isConnected) {
              if (_streamTarget) _streamTarget._twRunning = false;
              return;
            }
            const html = _streamTarget.getAttribute('_fullHtml') || '';
            pos += 3;
            _streamTarget.setAttribute('_twPos', pos);
            const partial = html.substring(0, pos);
            const hasMore = pos < html.length;
            _streamTarget.innerHTML = '<div class="stream-response">' + partial
              + (hasMore ? '<span class="tw-cursor">|</span>' : '')
              + '</div><span class="time">' + new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</span>';
            if (hasMore) {
              setTimeout(twTick, 18);
            } else {
              _streamTarget._twRunning = false;
            }
          }
          twTick();
        }
      } else {
        const { icon, text } = formatStreamStep(data.text);
        const iconHtml = icon ? '<span class="stream-icon">' + icon + '</span>' : '';
        _streamTarget.innerHTML = '<div class="stream-status">' +
          iconHtml + '<span class="stream-step">' + text + '</span>' +
          '</div><span class="time">' + new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</span>';
      }
      scrollChat();
    });
  }

  // 停止按钮：取消当前流式生成
  async function cancelStream() {
    try { await window.hermes.cancelStream(); } catch(e) {}
    _clearPendingTimer();
    _streamActive = false;
    if (_streamTarget) {
      _streamTarget.removeAttribute('data-pending');
      if (_streamTarget._twRunning) _streamTarget._twRunning = false;
      const acc = _streamTarget.getAttribute('data-stream-acc') || '';
      if (acc) {
        _streamTarget.innerHTML = '<div class="stream-response">' +
          wrapResponse(acc.replace(/\n/g, '<br>')) +
          '<br><span style="color:#999;font-size:11px;">（已停止生成）</span>' +
          '</div><span class="time">' + new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</span>';
        const saveKey = _streamKey || chatStorageKey();
        const msgs = JSON.parse(localStorage.getItem(saveKey) || '[]');
        const lastIdx = msgs.length - 1;
        const partialText = acc + '\n（已停止生成）';
        if (lastIdx >= 0 && msgs[lastIdx].text === '思考中') {
          msgs[lastIdx] = { role: 'hermes', text: partialText, time: new Date().toISOString() };
        } else {
          msgs.push({ role: 'hermes', text: partialText, time: new Date().toISOString() });
        }
        localStorage.setItem(saveKey, JSON.stringify(msgs));
      } else {
        _streamTarget.innerHTML = '已取消<span class="time">' + new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) + '</span>';
      }
      _streamTarget = null;
    }
    _streamKey = null;
    localStorage.removeItem('hermes_streaming');
    toggleCancelButton(false);
  }

  function toggleCancelButton(show) {
    const sendBtn = document.getElementById('chatSendBtn');
    const cancelBtn = document.getElementById('chatCancelBtn');
    if (!sendBtn || !cancelBtn) return;
    sendBtn.style.display = show ? 'none' : '';
    cancelBtn.style.display = show ? '' : 'none';
  }

  // 监听系统主题变化（仅"跟随系统"模式时生效）
  if (window.hermes_on && window.hermes_on.themeChanged) {
    window.hermes_on.themeChanged((isDark) => {
      const saved = localStorage.getItem('hermes_theme') || 'system';
      if (saved === 'system') {
        applyThemeClass(isDark);
      }
    });
  }

  // 监听后端推送的处理结果
  if (window.hermes_on && window.hermes_on.result) {
    window.hermes_on.result((data) => {
      if (_switchingRole || !data || !data.output) return;  // 切角色中或无效数据，跳过
      // 找到最后一个 pending 的 hermes 消息替换
      const history = document.getElementById('chatHistory');
      const pending = history.querySelectorAll('.hermes[data-pending]');
      const target = pending[pending.length - 1];
      if (target && data.output) {
        _clearPendingTimer();
        target.removeAttribute('data-pending');
        const clean = data.output.replace(/^session_id:.*\n?/gm, '').replace(/\n{2,}/g, '\n');
        target.innerHTML = renderFinal(clean) + `<span class="time">${new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}</span>`;
        scrollChat();
        // 持久化到 localStorage（异步回调，未知来源归默认）
        const saveKey = _streamKey || 'hermes_chat';
        {
          const msgs = JSON.parse(localStorage.getItem(saveKey) || '[]');
          // 直接替换最后一条（可能是占位文案或"思考中"）
          if (msgs.length > 0) {
            msgs[msgs.length - 1] = { role: 'hermes', text: clean, time: new Date().toISOString() };
          } else {
            msgs.push({ role: 'hermes', text: clean, time: new Date().toISOString() });
          }
          localStorage.setItem(saveKey, JSON.stringify(msgs));
        }
      } else if (data.error) {
        _clearPendingTimer();
        if (target) {
          target.removeAttribute('data-pending');
          target.innerHTML = '❌ ' + data.error + `<span class="time">${new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}</span>`;
          // 持久化错误（未知来源归默认）
          const errSaveKey = _streamKey || 'hermes_chat';
          {
            const msgs = JSON.parse(localStorage.getItem(errSaveKey) || '[]');
            const errText = '❌ ' + data.error;
            if (msgs.length > 0) {
              msgs[msgs.length - 1] = { role: 'hermes', text: errText, time: new Date().toISOString() };
            } else {
              msgs.push({ role: 'hermes', text: errText, time: new Date().toISOString() });
            }
            localStorage.setItem(errSaveKey, JSON.stringify(msgs));
          }
        }
      }
    });
  }

  // 自动保存对话（按当前角色）
  const origAdd = addChatMessage;
  addChatMessage = function(role, text, files, msgTime) {
    const div = origAdd(role, text, files, msgTime);
    // 批量加载时跳过保存
    if (_loadingHistory) return div;
    // 跳过占位消息（sendMessage 回调负责保存真实回复）
    if (text === '思考中') return div;
    const key = chatStorageKey();
    const msgs = JSON.parse(localStorage.getItem(key) || '[]');
    const msg = { role, text, files: files || [] };
    if (msgTime) msg.time = msgTime;
    msgs.push(msg);
    if (msgs.length > 200) msgs.shift();
    localStorage.setItem(key, JSON.stringify(msgs));
    return div;
  };


  // 右键弹出复制粘贴菜单
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.hermes && window.hermes.showContextMenu) {
      window.hermes.showContextMenu();
    }
  });

// ===== 初始化 =====
// Phase 1: DOM-dependent one-time setup
updateQuarterDay();
buildDaySelect();

// ===== 主题管理 =====
async function initTheme() {
  try {
    const t = await window.hermes.getTheme();
    applyThemeClass(t.effectiveIsDark);
    // 同步 localStorage（供 settings 页读取）
    localStorage.setItem('hermes_theme', t.userPreference || 'system');
  } catch(e) {
    // preload 未就绪，从 localStorage 读取兜底
    const saved = localStorage.getItem('hermes_theme') || 'system';
    if (saved === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (saved === 'light') {
      document.documentElement.classList.remove('dark');
    }
    // 'system' 时无法判断，不加 dark class（默认浅色）
  }
}

function applyThemeClass(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

async function setTheme(mode) {
  // mode: 'system' | 'light' | 'dark'
  localStorage.setItem('hermes_theme', mode);
  try {
    const r = await window.hermes.setTheme(mode);
    applyThemeClass(r.effectiveIsDark);
  } catch(e) {
    // IPC 未就绪，仅在本地生效
    if (mode === 'dark') {
      applyThemeClass(true);
    } else if (mode === 'light') {
      applyThemeClass(false);
    }
    // mode === 'system' 时无法判断，不做变更
  }
  // 刷新设置页中的激活状态
  const opts = document.querySelectorAll('.theme-option');
  opts.forEach(o => {
    o.classList.toggle('active', o.getAttribute('data-theme') === mode);
  });
}

// Phase 2: Register DOM event listeners
function _initDomEvents() {
  const ci = document.getElementById('codeInput');
  if (ci) ci.addEventListener('keydown', e => { if (e.key === 'Enter') verifySmsCode(); });
  initDragDrop();
  initCustomAvatars();
  initTheme();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initDomEvents);
} else {
  _initDomEvents();
}

// Phase 3: Restore chat state from localStorage
renderAllUnread();
loadChatHistory();
localStorage.removeItem('hermes_streaming');

// 平台消息同步监听（飞书/企微消息 → App 显示）
if (window.hermes_on && window.hermes_on.gatewayMessage) {
  window.hermes_on.gatewayMessage((sessions) => {
    if (!Array.isArray(sessions)) return;
    sessions.forEach(sess => {
      const roleId = sess.role || 'dami';
      const platform = sess.source || 'feishu';
      const platformLabel = platform === 'feishu' ? '飞书' : (platform === 'wecom' ? '企业微信' : platform);
      const storageKey = roleStorageKey(roleId);
      let msgs = [];
      try { msgs = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch(_) {}

      sess.messages.forEach(m => {
        const content = (m.content || '').trim();
        if (!content) return;
        const time = new Date(m.ts * 1000).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});

        if (m.role === 'user') {
          // 平台用户消息
          msgs.push({ role: 'user', text: content, time: new Date(m.ts * 1000).toISOString(), platform: platformLabel });
          // 如果当前正在看该角色，实时显示
          if (currentAction === roleId && document.getElementById('pageHome').classList.contains('active')) {
            addChatMessage('user', content, time, platformLabel);
          } else {
            bumpUnread(roleId);
          }
        } else if (m.role === 'assistant') {
          // AI 回复
          msgs.push({ role: 'hermes', text: content, time: new Date(m.ts * 1000).toISOString(), platform: platformLabel });
          if (currentAction === roleId && document.getElementById('pageHome').classList.contains('active')) {
            addChatMessage('hermes', content, time, platformLabel);
          } else {
            bumpUnread(roleId);
          }
        }
      });

      localStorage.setItem(storageKey, JSON.stringify(msgs));
    });
    renderAllUnread();
  });
}

// Phase 4: Auth check
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
