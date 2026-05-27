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
      const [type, text] = (msg || '检查环境…').split('|');
      const messages = {
        check: '检查系统环境…',
        'python-dl': '正在下载 Python 运行环境（首次使用需等待）…',
        'python-extract': '正在安装 Python 运行环境…',
        'python-ok': 'Python 运行环境就绪 ✓',
        mkdir: '创建安装目录…',
        venv: '配置运行环境…',
        pip: '安装 AI 引擎（约 3-5 分钟）…',
        done: '准备就绪！',
        error: '安装遇到问题'
      };
      if (status) status.textContent = messages[type] || text || type;
      if (type === 'check' && fill) fill.style.width = '5%';
      if ((type === 'python-dl' || type === 'python-ok') && fill) fill.style.width = '10%';
      if (type === 'python-extract' && fill) fill.style.width = '15%';
      if (type === 'mkdir' && fill) fill.style.width = '20%';
      if (type === 'venv' && fill) fill.style.width = '40%';
      if (type === 'pip' && fill) fill.style.width = '75%';
      if (type === 'done' && fill) fill.style.width = '100%';
      if (type === 'error') {
        fill.style.background = '#ef4444';
        if (status) status.textContent = text || '安装遇到问题';
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
    // Cmd+M: 弹出模型切换菜单
    if (mod && e.key === 'm') { e.preventDefault(); toggleModelSwitcher(); return; }

    if (e.key === 'Escape') {
      const top = topOverlay();
      if (top === 'dialogOverlay') { closeDialog(); return; }
      if (top === 'loginOverlay') { return; }
      if (top === 'modalOverlay') { hideAddTask(); return; }
      if (top === 'rechargeOverlay') { closeRecharge(); return; }
      if (top === 'memoryEditorOverlay') { closeMemoryEditor(); return; }
      if (top === 'pipelineConfigOverlay') { closePipelineConfig(); return; }
      if (top === 'filePreviewOverlay') { closeFilePreview(); return; }
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
    if (/429|rate.?limit/i.test(msg)) return '请求太频繁，请稍后重试';
    if (/401|unauthorized/i.test(msg)) return '登录已过期，请重新登录';
    if (/500|internal.?server/i.test(msg)) return '服务器异常，请稍后重试';
    if (/503|service.?unavailable/i.test(msg)) return '服务暂不可用，请稍后重试';
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
    const dot = document.getElementById('connDot');
    const label = document.getElementById('connLabel');
    try {
      await window.hermes.getCredits();
      _connFailed = 0;
      if (dot) dot.className = 'conn-dot online';
      if (label) label.textContent = '在线';

      // 检查网关 + 引擎就绪状态
      try {
        const gw = await window.hermes.gatewayStatus();
        if (gw && gw.running && !gw.ready) {
          showConnBanner('AI 引擎准备中，请稍候...');
        } else {
          hideConnBanner();
        }
      } catch (_) {}
    } catch (e) {
      _connFailed++;
      if (dot) dot.className = 'conn-dot offline';
      if (label) label.textContent = '离线';
      if (_connFailed >= 2) {
        showConnBanner('服务器连接异常，已切换离线模式', true);
      }
    }
  }
  function startConnMonitor() {
    if (_connCheckTimer) return;
    checkConnectionHealth();
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
          await waitForEngineReady();
          updateCreditsBadge();
          await loadRolesFromIPC();
          renderSidebar();
          loadSkills();
          initOnboarding();
          restoreLastState();
          startFeishuPolling();
          return;
        }
      } catch (e) { console.error("auth check failed:", e.message); }
      localStorage.removeItem('hermes_auth');
      authState = null;
    }
    // DEV 模式：跳过登录直接进入
    authState = { token: 'dev-token', user: { id: 'dev', name: '开发者' } };
    saveAuth();
    hideLogin();
    // 等待引擎就绪（首次启动需要解压+安装依赖，约1-2分钟）
    await waitForEngineReady();
    updateCreditsBadge();
    await loadRolesFromIPC();
    renderSidebar();
    loadSkills(); // 引擎就绪后重新加载技能
    initOnboarding();
    restoreLastState();
    startFeishuPolling();
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

    if (overlay) { overlay.style.display = 'flex'; }
    if (skipBtn) { skipBtn.style.display = 'none'; }

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
        if (s && s.running) {
          if (status) status.textContent = steps[steps.length - 1].msg;
          if (fill) fill.style.width = '100%';
          await new Promise(r => setTimeout(r, 2000));
          if (overlay) overlay.style.display = 'none';
          if (fill) fill.style.width = '5%';
          return;
        }
      } catch (_) {}
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
  let _onboardingStep = 0;

  function restoreLastState() {
    const lastPage = localStorage.getItem('hermes_last_page');
    const lastRole = localStorage.getItem('hermes_last_role');
    if (lastPage && lastPage !== 'pageHome') switchPage(lastPage);
    if (lastRole && lastRole !== 'dami') handleRole(lastRole);
  }

  function initOnboarding() {
    if (!currentAction) currentAction = 'dami';
    if (!localStorage.getItem('hermes_onboarding_done')) {
      _onboardingStep = 0;
      _renderOnboardingStep(0);
    }
  }

  function _renderOnboardingStep(step) {
    const guide = document.getElementById('onboardingGuide');
    if (!guide) return;
    _onboardingStep = step;

    const steps = [
      { icon: '👥', title: '选择一位数字员工', desc: '左侧有不同的 AI 角色，每位都有专属技能。点击头像切换，找到最适合你任务的那位。', btn: '选好了，下一步 →' },
      { icon: '💬', title: '直接告诉 AI 你想做什么', desc: '像跟同事说话一样，把任务发给它就行。', btn: '知道了，下一步 →', chips: true },
      { icon: '🚀', title: '还有更多玩法', desc: '', btn: '开始使用 🎉', features: true },
    ];

    const s = steps[step];
    const dots = [0, 1, 2].map(i =>
      `<span class="og-dot${i === step ? ' active' : i < step ? ' done' : ''}"></span>`
    ).join('');

    let extra = '';
    if (s.chips) {
      const role = currentAction || 'dami';
      const actions = QUICK_ACTIONS[role] || QUICK_ACTIONS['dami'];
      extra = `<div class="og-chips">${actions.map(a =>
        `<button class="og-chip" onclick="event.stopPropagation();var inp=document.getElementById('chatInput');if(inp){inp.value='${a.replace(/'/g, "\\'")}';inp.focus();}">${a}</button>`
      ).join('')}</div>`;
    }
    if (s.features) {
      extra = `<div class="og-features">
        <div class="og-feat" onclick="skipOnboarding();switchPage('pageTasks')">
          <span class="og-feat-icon">⏰</span>
          <span class="og-feat-name">定时任务</span>
          <span class="og-feat-desc">让 AI 定时帮你查数据、发消息</span>
        </div>
        <div class="og-feat" onclick="skipOnboarding();switchPage('pageChannels')">
          <span class="og-feat-icon">📱</span>
          <span class="og-feat-name">连接手机</span>
          <span class="og-feat-desc">连飞书/企微，手机遥控 AI</span>
        </div>
        <div class="og-feat" onclick="skipOnboarding();switchPage('pageReports')">
          <span class="og-feat-icon">📂</span>
          <span class="og-feat-name">我的成果</span>
          <span class="og-feat-desc">查看 AI 帮你生成的文件</span>
        </div>
      </div>`;
    }

    guide.innerHTML = `<div class="og-card">
      <div class="og-steps">${dots}</div>
      <div class="og-icon">${s.icon}</div>
      <div class="og-title">${s.title}</div>
      <div class="og-desc">${s.desc}</div>
      ${extra}
      <div class="og-actions">
        <button class="og-skip" onclick="skipOnboarding()">跳过引导</button>
        <button class="og-next" onclick="nextOnboardingStep()">${s.btn}</button>
      </div>
    </div>`;
    guide.style.display = '';

    // Step 0: highlight sidebar
    const sidebar = document.getElementById('sidebarRoles');
    if (sidebar) sidebar.classList.toggle('onboarding-highlight', step === 0);

    // Hide empty state
    const empty = document.querySelector('#chatHistory .chat-empty');
    if (empty) empty.style.display = 'none';
  }

  function nextOnboardingStep() {
    if (_onboardingStep >= 2) {
      skipOnboarding();
      return;
    }
    _renderOnboardingStep(_onboardingStep + 1);
  }

  function skipOnboarding() {
    localStorage.setItem('hermes_onboarding_done', '1');
    const guide = document.getElementById('onboardingGuide');
    if (guide) { guide.style.display = 'none'; guide.innerHTML = ''; }
    const sidebar = document.getElementById('sidebarRoles');
    if (sidebar) sidebar.classList.remove('onboarding-highlight');
    // Restore empty state if no messages
    const history = document.getElementById('chatHistory');
    if (history && history.querySelectorAll('.chat-msg').length === 0) {
      const empty = history.querySelector('.chat-empty');
      if (empty) empty.style.display = '';
    }
  }

  // ===== 积分 =====
  function updateTrialBadge() { updateCreditsBadge(); }

  let _lowCreditsDismissTimer = null;
  function dismissLowCreditsBanner() {
    const banner = document.getElementById('lowCreditsBanner');
    if (banner) banner.style.display = 'none';
    // 5分钟后自动恢复显示
    if (_lowCreditsDismissTimer) clearTimeout(_lowCreditsDismissTimer);
    _lowCreditsDismissTimer = setTimeout(() => {
      _lowCreditsDismissTimer = null;
      updateCreditsBadge(); // 重新检查并显示横幅
    }, 300000);
  }

  async function updateCreditsBadge() {
    const badge = document.getElementById('creditsBadge');
    if (!badge) return;
    let b = authState?.user?.credits || 0;
    let errMsg = '';
    try {
      const cred = await hermes.getCredits();
      if (cred && cred.credits != null) {
        b = cred.credits;
        if (authState) authState.user = { ...authState.user, credits: b };
      }
      if (cred && cred.message && cred.message.includes('无法连接')) {
        errMsg = cred.message;
      }
    } catch (e) {
      errMsg = '网络异常: ' + (e.message || '');
    }
    badge.style.display = 'inline-block';
    if (errMsg) {
      // 服务器连接异常时，显示错误信息
      document.getElementById('creditsText').textContent = errMsg;
      badge.className = 'credits-badge critical';
      badge.title = errMsg;
      badge.onclick = () => showRecharge();
    } else if (b > 0) {
      document.getElementById('creditsText').textContent = b + ' 积分';
      if (b < 50) {
        badge.className = 'credits-badge critical';
        badge.title = '积分即将用完，请尽快充值';
      } else if (b < 200) {
        badge.className = 'credits-badge low';
        badge.title = '积分偏低，建议充值';
      } else {
        badge.className = 'credits-badge';
        badge.title = '剩余积分：' + b;
      }
      badge.onclick = () => showRecharge();
    } else {
      document.getElementById('creditsText').textContent = '积分已用完';
      badge.className = 'credits-badge critical';
      badge.title = '积分已用完，请充值';
      badge.onclick = () => showRecharge();
    }
    updateCostEstimate();
    // 控制低余额横幅（如果用户手动关闭了，5分钟内不重复显示，积分=0时除外）
    const banner = document.getElementById('lowCreditsBanner');
    if (banner) {
      if (b <= 0) {
        banner.style.display = 'flex';
        banner.className = 'low-credits-banner';
        document.getElementById('lcbText').textContent = '积分已用完，请充值后继续使用';
        // 积分用完时清除dismiss计时器，强制显示
        if (_lowCreditsDismissTimer) { clearTimeout(_lowCreditsDismissTimer); _lowCreditsDismissTimer = null; }
      } else if (b < 50) {
        if (!_lowCreditsDismissTimer) banner.style.display = 'flex';
        banner.className = 'low-credits-banner';
        document.getElementById('lcbText').textContent = `积分仅剩 ${b} 分，建议立即充值`;
      } else if (b < 200) {
        if (!_lowCreditsDismissTimer) banner.style.display = 'flex';
        banner.className = 'low-credits-banner warn';
        document.getElementById('lcbText').textContent = `积分偏低（${b} 分），建议充值`;
      } else {
        banner.style.display = 'none';
      }
    }
  }

  async function refreshLicense() {
    try {
      const cred = await hermes.getCredits();
      if (authState) authState.user = { ...authState.user, credits: cred?.credits || 0 };
    } catch (e) {}
    updateCreditsBadge();
  }

  // ===== 充值 =====
  let _selectedRechargeAmount = 10;

  const RECHARGE_TIERS = {
    10: { credits: 1000, label: '1,000' },
    30: { credits: 3200, label: '3,200' },
    50: { credits: 6000, label: '6,000' }
  };

  function showCreditsDetail(credits) {
    showRecharge();
  }

  function showActivationDialog() {
    showRecharge();
  }

  function showRecharge() {
    _selectedRechargeAmount = 10;
    const tier = RECHARGE_TIERS[10];
    document.getElementById('rechargePrice').textContent = '10';
    document.getElementById('rechargeCredits').textContent = tier.label;
    document.getElementById('rechargeError').textContent = '';
    document.getElementById('rechargeSuccess').style.display = 'none';
    document.getElementById('rechargeSubmitBtn').style.display = '';
    document.querySelectorAll('.recharge-tier').forEach(t => t.classList.remove('selected'));
    document.querySelector('.recharge-tier[data-amount="10"]').classList.add('selected');
    _updateTierHint(10);
    showOverlay('rechargeOverlay');
  }

  function _updateTierHint(amount) {
    const el = document.getElementById('rechargeTierHint');
    if (!el) return;
    const avg = _getAvgCost();
    if (avg) {
      const approx = Math.floor(RECHARGE_TIERS[amount].credits / avg.high);
      el.textContent = `约可进行 ${approx} 次对话（基于近期平均消耗）`;
      el.style.display = '';
    } else {
      el.textContent = '使用越多，预估越准确';
      el.style.display = '';
    }
  }

  function selectRechargeTier(amount) {
    _selectedRechargeAmount = parseInt(amount);
    document.querySelectorAll('.recharge-tier').forEach(t => t.classList.remove('selected'));
    document.querySelector(`.recharge-tier[data-amount="${amount}"]`).classList.add('selected');
    const tier = RECHARGE_TIERS[amount];
    document.getElementById('rechargeCredits').textContent = tier.label;
    document.getElementById('rechargePrice').textContent = amount;
    document.getElementById('rechargeError').textContent = '';
    _updateTierHint(amount);
  }

  function _renderUsageHistory() {
    const list = document.getElementById('rechargeUsageList');
    if (!list) return;
    try {
      const records = JSON.parse(localStorage.getItem('hermes_cost_records') || '[]');
      if (records.length === 0) {
        list.innerHTML = '<div class="usage-empty">暂无消费记录</div>';
        return;
      }
      const recent = records.slice(-20).reverse();
      list.innerHTML = recent.map(r => {
        const d = new Date(r.time);
        const ts = `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        return `<div class="usage-item">
          <div class="usage-item-left">
            <span>${ts} · ${r.model || 'deepseek'}</span>
          </div>
          <span class="usage-item-credits">-${r.cost} 分</span>
        </div>`;
      }).join('');
    } catch (_) {
      list.innerHTML = '<div class="usage-empty">暂无消费记录</div>';
    }
  }

  function closeRecharge() {
    hideOverlay('rechargeOverlay');
    refreshCredits();
  }

  // ===== 账单 =====
  let _billingTab = 'recharge';

  async function showBillingHistory() {
    hideOverlay('rechargeOverlay');
    showOverlay('billingOverlay');
    _billingTab = 'recharge';
    document.querySelectorAll('.billing-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    await loadBillingData();
  }

  function closeBillingHistory() {
    hideOverlay('billingOverlay');
  }

  function switchBillingTab(tab) {
    _billingTab = tab;
    document.querySelectorAll('.billing-tab').forEach((t, i) => {
      t.classList.toggle('active', (i === 0 && tab === 'recharge') || (i === 1 && tab === 'usage'));
    });
    loadBillingData();
  }

  async function loadBillingData() {
    const list = document.getElementById('billingList');
    const summary = document.getElementById('billingSummary');
    if (!list) return;
    list.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

    try {
      const data = await (window.hermes.getBillingHistory ? window.hermes.getBillingHistory() : { recharges: [], usage: [], balance: 0 });
      if (summary) {
        summary.innerHTML = `余额 <b>${data.balance || 0}</b> 分 · 累计充值 <b>${data.total_recharged || 0}</b> 分 · 累计消费 <b>${data.total_used || 0}</b> 分`;
      }

      if (_billingTab === 'recharge') {
        if (!data.recharges || data.recharges.length === 0) {
          list.innerHTML = '<div class="usage-empty">暂无充值记录</div>';
          return;
        }
        list.innerHTML = data.recharges.map(r => {
          const d = new Date(r.time); const ts = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          return `<div class="usage-item"><div class="usage-item-left"><span>${ts} · 充值</span></div><span class="usage-item-credits" style="color:#22c55e;">+${r.credits} 分</span></div>`;
        }).join('');
      } else {
        if (!data.usage || data.usage.length === 0) {
          list.innerHTML = '<div class="usage-empty">暂无消费记录</div>';
          return;
        }
        list.innerHTML = data.usage.map(r => {
          const d = new Date(r.time); const ts = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          return `<div class="usage-item"><div class="usage-item-left"><span>${ts} · ${r.model || 'AI对话'}</span></div><span class="usage-item-credits">-${r.credits} 分</span></div>`;
        }).join('');
      }
    } catch (_) {
      list.innerHTML = '<div class="usage-empty">加载失败</div>';
    }
  }

  async function submitRecharge() {
    const btn = document.getElementById('rechargeSubmitBtn');
    const errEl = document.getElementById('rechargeError');
    btn.disabled = true;
    btn.textContent = '充值中...';
    errEl.textContent = '';

    try {
      const result = await hermes.recharge(_selectedRechargeAmount);
      if (result.success) {
        document.getElementById('rechargeSubmitBtn').style.display = 'none';
        document.getElementById('rechargeSuccess').style.display = '';
        document.getElementById('rechargeSuccessDetail').textContent =
          `到账 ${result.credits_added} 积分 · 余额 ${result.balance} 分`;
        if (authState) authState.user = { ...authState.user, credits: result.balance };
        updateCreditsBadge();
        setTimeout(() => { closeRecharge(); }, 2000);
      } else {
        errEl.textContent = result.message || '充值失败，请稍后重试';
      }
    } catch (e) {
      errEl.textContent = '网络错误，请检查连接后重试';
    }
    btn.disabled = false;
    btn.textContent = '确认充值';
  }
  async function checkCreditsBeforeSend() {
    try {
      const cred = await hermes.getCredits();
      const b = cred && cred.credits != null ? cred.credits : 0;
      if (authState) authState.user = { ...authState.user, credits: b };
      updateCreditsBadge();
      const avg = _getAvgCost();
      const avgHigh = avg ? avg.high : 5;
      return { ok: b >= 10, credits: b, low: b < avgHigh, avgCost: avgHigh };
    } catch (e) {
      return { ok: true, credits: -1 };
    }
  }

  // 费用预估：基于历史消息的平均消耗
  function _recordMessageCost(cost, model) {
    if (!cost || cost <= 0) return;
    try {
      const records = JSON.parse(localStorage.getItem('hermes_cost_records') || '[]');
      records.push({ cost, model: model || 'deepseek-v4-pro', time: Date.now() });
      if (records.length > 100) records.splice(0, records.length - 100);
      localStorage.setItem('hermes_cost_records', JSON.stringify(records));
      // 同时维护简单数组用于平均计算
      const costs = JSON.parse(localStorage.getItem('hermes_msg_costs') || '[]');
      costs.push(cost);
      if (costs.length > 50) costs.shift();
      localStorage.setItem('hermes_msg_costs', JSON.stringify(costs));
    } catch (_) {}
  }

  function _getAvgCost() {
    try {
      const costs = JSON.parse(localStorage.getItem('hermes_msg_costs') || '[]');
      if (costs.length === 0) return null;
      const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
      const low = Math.max(1, Math.floor(avg * 0.4));
      const high = Math.max(2, Math.ceil(avg * 1.6));
      return { low, high };
    } catch (_) { return null; }
  }

  function updateCostEstimate() {
    const el = document.getElementById('costEstimate');
    if (!el) return;
    const avg = _getAvgCost();
    if (avg) {
      document.getElementById('costEstimateNum').textContent = `${avg.low}-${avg.high}`;
      el.style.display = '';
    } else {
      el.style.display = 'none';
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

    // 首次进入页面显示提示
    _checkPageTip(pageId);

    if (pageId === 'pageTasks') refreshTasks();
    if (pageId === 'pageChannels') refreshChannels();
    if (pageId === 'pageReports') refreshReports();
    if (pageId === 'pageSettings') refreshSettings();
    if (pageId === 'pageSkills') loadSkills();
  }

  function _checkPageTip(pageId) {
    // 主页不需要提示
    if (pageId === 'pageHome' || pageId === 'pageSettings') return;
    const key = `hermes_page_tip_done_${pageId}`;
    if (localStorage.getItem(key)) return;
    const tipMap = {
      pageTasks: 'tipTasks',
      pageChannels: 'tipChannels',
      pageReports: 'tipReports',
      pageSkills: 'tipSkills',
    };
    const tipId = tipMap[pageId];
    if (!tipId) return;
    const tip = document.getElementById(tipId);
    if (tip) tip.style.display = '';
  }

  function dismissPageTip(pageId) {
    localStorage.setItem(`hermes_page_tip_done_${pageId}`, '1');
    const tipMap = {
      pageTasks: 'tipTasks',
      pageChannels: 'tipChannels',
      pageReports: 'tipReports',
      pageSkills: 'tipSkills',
    };
    const tipId = tipMap[pageId];
    if (tipId) {
      const tip = document.getElementById(tipId);
      if (tip) tip.style.display = 'none';
    }
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
    try {
      const v = await window.hermes.getVersion();
      document.getElementById('setVersion').textContent = 'Hergent v' + v;
    } catch (_) {}
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
    // 加载记忆
    loadMemories();
    // 加载用量明细
    loadUsageHistory();
    // 加载模型配置
    loadModelConfig();
    // 检查引擎更新
    checkEngineUpdate();
  }

  async function checkEngineUpdate() {
    const el = document.getElementById('setEngineVersion');
    const row = document.getElementById('engineUpdateRow');
    const btn = document.getElementById('engineUpdateBtn');
    if (!el) return;

    try {
      // 快速获取版本号
      const info = await window.hermes.checkCli();
      if (info.available && info.version) {
        el.textContent = info.version;
        el.style.color = '';
        // 异步检查更新（git fetch 可能比较慢）
        try {
          const up = await window.hermes.checkEngineUpdate();
          if (up.updateAvailable && up.commitsBehind > 0) {
            el.textContent = info.version + ' (落后 ' + up.commitsBehind + ' 个提交)';
            el.style.color = 'var(--warning, #f59e0b)';
            if (row) row.style.display = '';
            if (btn) { btn.textContent = '更新引擎 (' + up.commitsBehind + ' commits)'; btn.disabled = false; }
          } else {
            if (row) row.style.display = 'none';
          }
        } catch (_) {}
      } else {
        el.textContent = '未安装';
      }
    } catch (_) {
      el.textContent = '--';
    }
  }

  async function updateEngine() {
    const btn = document.getElementById('engineUpdateBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '更新中...';
    try {
      const result = await window.hermes.updateEngine();
      if (result.success) {
        btn.textContent = '已更新';
        btn.style.background = 'var(--brand-500, #06b6d4)';
        btn.style.color = '#fff';
        setTimeout(() => checkEngineUpdate(), 2000);
      } else {
        btn.textContent = '更新失败: ' + (result.error || '未知错误');
        btn.style.background = 'var(--danger, #ef4444)';
        btn.style.color = '#fff';
        btn.disabled = false;
      }
    } catch (e) {
      btn.textContent = '更新失败';
      btn.style.background = 'var(--danger, #ef4444)';
      btn.style.color = '#fff';
      btn.disabled = false;
    }
  }

  async function loadUsageHistory() {
    const container = document.getElementById('usageHistory');
    if (!container) return;
    try {
      const data = await hermes.usageHistory(20);
      if (!data.records || data.records.length === 0) {
        container.innerHTML = '<div class="usage-empty">暂无使用记录</div>';
        return;
      }
      container.innerHTML = data.records.map(r => {
        const d = new Date(r.time);
        const timeStr = d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const desc = r.model === 'hermes-cli' ? 'AI对话' : (r.model || 'AI对话');
        const tokens = (r.prompt_tokens || r.completion_tokens) 
          ? `${(r.prompt_tokens + r.completion_tokens)}+ tokens` 
          : '';
        return `<div class="usage-item">
          <div class="usage-item-left">
            <span>${desc}</span>
            <span class="usage-item-time">${timeStr}${tokens ? ' · ' + tokens : ''}</span>
          </div>
          <span class="usage-item-credits">-${r.credits} 分</span>
        </div>`;
      }).join('');
    } catch (e) {
      container.innerHTML = '<div class="usage-empty">加载失败</div>';
    }
  }

  // ===== 记忆系统 =====
  let _memories = [];
  let _memoryFilterType = 'all';
  const MEMORY_TYPE_INFO = {
    preference: { label: '偏好习惯', icon: '💝', order: 1 },
    fact:       { label: '重要事实', icon: '📌', order: 2 },
    pattern:    { label: '工作模式', icon: '🔄', order: 3 },
    style:      { label: '个人风格', icon: '🎨', order: 4 },
  };

  function _trackMemoryGrowth(total) {
    try {
      const history = JSON.parse(localStorage.getItem('hermes_memory_growth') || '[]');
      const now = Date.now();
      // 每天最多记录一个点
      const today = new Date().toISOString().slice(0, 10);
      const last = history[history.length - 1];
      if (!last || last.date !== today) {
        history.push({ date: today, count: total });
        if (history.length > 60) history.shift();
        localStorage.setItem('hermes_memory_growth', JSON.stringify(history));
      } else if (last.count !== total) {
        last.count = total;
        localStorage.setItem('hermes_memory_growth', JSON.stringify(history));
      }
      return history;
    } catch (_) { return []; }
  }

  function _renderMemoryTimeline(history) {
    const container = document.getElementById('memoryTimeline');
    const bars = document.getElementById('mtBars');
    if (!container || !bars) return;
    if (history.length < 2) { container.style.display = 'none'; return; }
    container.style.display = '';
    // 取最近 14 个数据点
    const recent = history.slice(-14);
    const maxCount = Math.max(1, ...recent.map(p => p.count));
    bars.innerHTML = recent.map(p => {
      const h = Math.round((p.count / maxCount) * 100);
      const label = p.date.slice(5); // MM-DD
      return `<div class="mt-bar-col">
        <div class="mt-bar-val">${p.count}</div>
        <div class="mt-bar" style="height:${Math.max(h, 4)}%;"></div>
        <div class="mt-bar-label">${label}</div>
      </div>`;
    }).join('');
  }

  async function loadMemories() {
    const list = document.getElementById('memoryList');
    const empty = document.getElementById('memoryEmpty');
    if (!list) return;
    const role = currentAction || 'dami';
    try {
      const resp = await window.hermes.listMemories(role);
      _memories = resp.memories || [];
      const stats = resp.stats || { total: 0, byType: {}, mtime: null };

      // 了解程度
      _renderMemoryLevel(stats.total);

      // 统计行
      document.getElementById('memCount').textContent = `共 ${stats.total} 条`;
      const mtimeEl = document.getElementById('memMtime');
      if (mtimeEl && stats.mtime) {
        const ms = Date.now() - new Date(stats.mtime).getTime();
        const ago = ms < 60000 ? '刚刚更新' : ms < 3600000 ? Math.floor(ms/60000)+'分钟前更新' :
                    ms < 86400000 ? Math.floor(ms/3600000)+'小时前更新' : Math.floor(ms/86400000)+'天前更新';
        mtimeEl.textContent = ago;
      }

      // 类型筛选芯片上的数量
      const chips = document.querySelectorAll('#memoryTypeFilters .mem-type-chip');
      chips.forEach(c => {
        const t = c.dataset.type;
        const cnt = t === 'all' ? stats.total : (stats.byType && stats.byType[t]) || 0;
        // 更新芯片上的数字
        const label = c.textContent.replace(/\d+$/, '').trim();
        c.textContent = cnt > 0 ? `${label} ${cnt}` : label;
      });

      // 成长时间线
      const history = _trackMemoryGrowth(stats.total);
      _renderMemoryTimeline(history);

      // 渲染记忆列表
      _renderMemoryList();
    } catch (e) {
      list.innerHTML = '<div class="memory-empty">加载失败</div>';
    }
  }

  function _renderMemoryLevel(total) {
    let level = 0, levelLabel = '初始';
    if (total >= 31) { level = 4; levelLabel = '非常了解'; }
    else if (total >= 16) { level = 3; levelLabel = '比较熟悉'; }
    else if (total >= 6) { level = 2; levelLabel = '逐渐了解'; }
    else if (total >= 1) { level = 1; levelLabel = '初步认识'; }
    document.getElementById('mlLevelName').textContent = levelLabel;
    const pct = Math.min(100, Math.round((total / 30) * 100));
    document.getElementById('mlBarFill').style.width = pct + '%';
    // 高亮当前阶段
    document.querySelectorAll('.ml-stage').forEach(s => {
      s.classList.toggle('active', parseInt(s.dataset.lv) === level);
    });
  }

  function _renderMemoryList() {
    const list = document.getElementById('memoryList');
    const empty = document.getElementById('memoryEmpty');
    if (!list) return;
    const filtered = _memoryFilterType === 'all'
      ? _memories
      : _memories.filter(m => m.type === _memoryFilterType);
    if (filtered.length === 0) {
      list.innerHTML = '';
      const msg = _memoryFilterType === 'all'
        ? '还没有记忆。多聊聊，Hermes 会慢慢了解你。'
        : '该类型下暂无记忆';
      const el = empty ? empty.cloneNode(true) : document.createElement('div');
      el.className = 'memory-empty';
      el.textContent = msg;
      list.appendChild(el);
      return;
    }
    const now = Date.now();
    list.innerHTML = filtered.map(m => {
      const ms = now - new Date(m.updated).getTime();
      const ago = ms < 60000 ? '刚刚' : ms < 3600000 ? Math.floor(ms/60000)+'分钟前' :
                  ms < 86400000 ? Math.floor(ms/3600000)+'小时前' : Math.floor(ms/86400000)+'天前';
      const ti = MEMORY_TYPE_INFO[m.type] || MEMORY_TYPE_INFO['fact'];
      return `<div class="memory-item">
        <span class="mem-type-badge" data-type="${m.type}">${ti.icon} ${ti.label}</span>
        <div class="memory-item-title">${escapeHtml(m.title)}</div>
        ${m.preview ? '<div class="memory-item-preview">'+escapeHtml(m.preview)+'</div>' : ''}
        <div class="memory-item-time">${ago}</div>
        <div class="memory-item-actions">
          <button class="mem-item-btn" onclick="openMemoryEditor('${m.id}')" title="编辑">✎</button>
          <button class="mem-item-btn mem-item-del" onclick="deleteMemory('${m.id}')" title="删除">×</button>
        </div>
      </div>`;
    }).join('');
  }

  function filterMemoriesByType(type) {
    _memoryFilterType = type;
    document.querySelectorAll('#memoryTypeFilters .mem-type-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.type === type);
    });
    _renderMemoryList();
  }

  let _editingMemoryId = null;

  function openMemoryEditor(id) {
    _editingMemoryId = id || null;
    const overlay = document.getElementById('memoryEditorOverlay');
    const titleEl = document.getElementById('memEditorTitle');
    const titleInput = document.getElementById('memEditorTitleInput');
    const typeSel = document.getElementById('memEditorType');
    const contentInput = document.getElementById('memEditorContent');
    const msg = document.getElementById('memEditorMsg');
    if (!overlay) return;
    if (msg) msg.textContent = '';
    if (id) {
      const m = _memories.find(mem => mem.id === id);
      if (titleEl) titleEl.textContent = '编辑记忆';
      if (titleInput) titleInput.value = m ? m.title : '';
      if (typeSel) typeSel.value = m ? m.type : 'fact';
      if (contentInput) contentInput.value = m ? (m.preview || '') : '';
    } else {
      if (titleEl) titleEl.textContent = '添加记忆';
      if (titleInput) titleInput.value = '';
      if (typeSel) typeSel.value = 'fact';
      if (contentInput) contentInput.value = '';
    }
    showOverlay('memoryEditorOverlay');
  }

  function closeMemoryEditor() {
    hideOverlay('memoryEditorOverlay');
    _editingMemoryId = null;
  }

  async function saveMemory() {
    const title = (document.getElementById('memEditorTitleInput').value || '').trim();
    const type = document.getElementById('memEditorType').value;
    const content = (document.getElementById('memEditorContent').value || '').trim();
    const msg = document.getElementById('memEditorMsg');
    if (!title) { if (msg) msg.textContent = '请输入标题'; return; }
    if (!content) { if (msg) msg.textContent = '请输入内容'; return; }
    const role = currentAction || 'dami';
    try {
      let resp;
      if (_editingMemoryId) {
        resp = await window.hermes.updateMemory(role, _editingMemoryId, title, content, type);
      } else {
        resp = await window.hermes.addMemory(role, title, content, type);
      }
      if (resp && resp.success) {
        closeMemoryEditor();
        loadMemories();
      } else if (msg) {
        msg.textContent = '保存失败：' + ((resp && resp.error) || '未知错误');
      }
    } catch (e) {
      if (msg) msg.textContent = '保存失败：' + (e.message || '');
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  let _allSkills = [];
  let _activeCategory = null;
  let _activeRole = null;
  let _hergentSkills = new Set();

  // 角色→技能关联（展示用，技能本身全局可用）
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

  async function loadSkills() {
    const grid = document.getElementById('skillsGrid');
    const total = document.getElementById('skillsTotal');
    const searchInput = document.getElementById('skillsSearch');
    const sidebarNav = document.getElementById('skillsSidebarNav');
    if (!grid) return;
    try {
      let data = { categories: [], total: 0 };
      if (window.hermes && window.hermes.listSkills) {
        data = await window.hermes.listSkills();
      }

      if (!data.categories || data.categories.length === 0) {
        grid.innerHTML = '<div class="memory-empty">技能目录为空，请检查 Hermes 安装</div>';
        if (sidebarNav) sidebarNav.innerHTML = '';
        return;
      }

      // 识别 Hergent 自研技能（通过 slug 匹配）
      const hergentSlugs = new Set([
        'wechat-miniprogram', 'chinese-content-tools', 'chinese-writing',
        'xiaohongshu-content', 'douyin-content', 'wechat-official-account',
        'chinese-marketing', 'chinese-social-media', 'chinese-ecommerce',
        'chinese-education', 'chinese-enterprise'
      ]);
      _hergentSkills = new Set();
      for (const s of data.categories) {
        if (hergentSlugs.has(s.slug)) _hergentSkills.add(s.slug);
      }

      _allSkills = data.categories;
      if (searchInput) searchInput.value = '';
      _activeCategory = null;
      _activeRole = null;

      const hergentCount = _hergentSkills.size;
      const hermesCount = data.total - hergentCount;
      if (total) total.textContent = `共 ${data.total} 项技能 · ${hergentCount} 项自研 · ${hermesCount} 项社区`;

      _renderSkillSidebar();
      _renderSkills(_allSkills);
    } catch (e) {
      grid.innerHTML = '<div class="memory-empty">加载失败</div>';
    }
  }

  function _renderSkillSidebar() {
    const nav = document.getElementById('skillsSidebarNav');
    if (!nav) return;
    // 按角色
    let html = `<div class="skill-nav-section-title">按角色</div>`;
    html += `<div class="skill-nav-item${!_activeRole && !_activeCategory ? ' active' : ''}" data-role="" onclick="_selectRole('')">
      <span class="skill-nav-icon">👤</span><span class="skill-nav-label">全部角色</span><span class="skill-nav-count">${_allSkills.length}</span>
    </div>`;
    for (const [roleId, slugs] of Object.entries(ROLE_SKILLS)) {
      if (slugs.length === 0) continue;
      const rd = ROLES[roleId] || {};
      const name = rd.name || roleId;
      html += `<div class="skill-nav-item${_activeRole === roleId ? ' active' : ''}" data-role="${roleId}" onclick="_selectRole('${roleId}')">
        <span class="skill-nav-icon">👤</span><span class="skill-nav-label">${escapeHtml(name)}</span><span class="skill-nav-count">${slugs.length}</span>
      </div>`;
    }
    // 按分类
    html += `<div class="skill-nav-section-title" style="margin-top:12px;">按分类</div>`;
    const allCats = [...new Set(_allSkills.map(s => s.category || '其他'))].filter(Boolean);
    allCats.sort((a, b) => a.localeCompare(b, 'zh'));
    html += `<div class="skill-nav-item${!_activeCategory && !_activeRole ? ' active' : ''}" data-cat="" onclick="_selectCategory('')">
      <span class="skill-nav-icon">📁</span><span class="skill-nav-label">全部分类</span><span class="skill-nav-count">${_allSkills.length}</span>
    </div>`;
    for (const cat of allCats) {
      const cnt = _allSkills.filter(s => (s.category || '其他') === cat).length;
      html += `<div class="skill-nav-item${_activeCategory === cat ? ' active' : ''}" data-cat="${escapeHtml(cat)}" onclick="_selectCategory('${escapeHtml(cat)}')">
        <span class="skill-nav-icon">📁</span><span class="skill-nav-label">${escapeHtml(cat)}</span><span class="skill-nav-count">${cnt}</span>
      </div>`;
    }
    nav.innerHTML = html;
  }

  function _selectRole(roleId) {
    _activeRole = roleId || null;
    _activeCategory = null;
    _renderSkillSidebar();
    let skills = _allSkills;
    if (roleId) {
      const roleSlugs = ROLE_SKILLS[roleId] || [];
      skills = _allSkills.filter(s => roleSlugs.includes(s.slug));
    }
    _renderSkills(skills, roleId ? (ROLES[roleId]?.name || roleId) : undefined);
  }

  function _selectCategory(cat) {
    _activeCategory = cat || null;
    _activeRole = null;
    _renderSkillSidebar();
    const skills = cat ? _allSkills.filter(s => (s.category || '其他') === cat) : _allSkills;
    _renderSkills(skills, !!cat ? cat : undefined);
  }

  function filterSkills() {
    const q = (document.getElementById('skillsSearch')?.value || '').toLowerCase().trim();
    if (!q) { _selectCategory(_activeCategory || ''); return; }
    const filtered = _allSkills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.slug || '').toLowerCase().includes(q)
    );
    _renderSkills(filtered, q);
    _renderSkillSidebar(); // keep sidebar visible
  }

  function _renderSkills(skills, query) {
    const grid = document.getElementById('skillsGrid');
    if (!grid) return;

    if (skills.length === 0) {
      grid.innerHTML = query
        ? `<div class="empty-msg">没有匹配 "${escapeHtml(query)}" 的技能</div>`
        : '<div class="empty-msg">暂无技能</div>';
      return;
    }

    // 按分类分组
    const groups = {};
    for (const s of skills) {
      const cat = s.category || '其他';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    }

    let html = '';
    const catNames = Object.keys(groups);
    if (query || catNames.length <= 1) {
      skills.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      html = `<div class="skill-card-grid">${skills.map(s => _skillCardHTML(s)).join('')}</div>`;
    } else {
      for (const [cat, items] of Object.entries(groups)) {
        items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        html += `<div class="skill-cat-group"><div class="skill-cat-title">${escapeHtml(cat)} <span class="skill-cat-cnt">${items.length} 项</span></div>`;
        html += `<div class="skill-card-grid">${items.map(s => _skillCardHTML(s)).join('')}</div>`;
        html += '</div>';
      }
    }

    grid.innerHTML = html;
  }

  function _skillCardHTML(s) {
    const usages = JSON.parse(localStorage.getItem('hermes_skill_usages') || '{}');
    const count = usages[s.slug] || 0;
    const isHergent = _hergentSkills.has(s.slug);
    return `<div class="skill-card">
      <div class="skill-card-icon">${isHergent ? '⚡' : '📦'}</div>
      <div class="skill-card-body">
        <div class="skill-card-name">${escapeHtml(s.name)}</div>
        ${s.description ? `<div class="skill-card-desc">${escapeHtml(s.description)}</div>` : ''}
        <div class="skill-card-meta">
          <span class="skill-source-tag${isHergent ? ' hergent' : ''}">${isHergent ? 'Hergent' : 'Hermes'}</span>
          ${count > 0 ? `<span class="skill-usage-count">${count}次</span>` : ''}
        </div>
      </div>
    </div>`;
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

  async function deleteMemory(id) {
    try {
      await window.hermes.deleteMemory(id, currentAction || 'dami');
      loadMemories();
    } catch (e) {
      showDialog('⚠️', '删除失败: ' + (e.message || ''));
    }
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

  
  // 快速创建任务（从新手引导卡片）
  function quickCreateTask(freq, time, prompt) {
    showAddTask({ name: '', freq: freq, time: time, prompt: prompt });
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
        <span class="tpl-ico">${t.ico}</span>${t.name}<span style="color:var(--text-tertiary);font-size:10px;">${freqLabel}</span>
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
listEl.innerHTML = `<div class="empty-state task-onboarding"> <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <div class="empty-state-title">让 AI 帮你定时干活</div> <div class="empty-state-desc">设置一次，每天自动执行。结果推到你手机上。</div> <div class="task-onboarding-examples"> <div class="task-onboard-card" onclick="quickCreateTask(&apos;每天&apos;, &apos;08:00&apos;, &apos;帮我搜索今天AI行业最新动态，整理成简报&apos;)"><span class="tob-icon">🌤</span><div class="tob-info"><div class="tob-name">每天早上推送 AI 简报</div><div class="tob-detail">每天 08:00 · 搜索最新动态 → 整理 → 推送</div></div><span class="tob-add">+</span></div> <div class="task-onboard-card" onclick="quickCreateTask(&apos;每周&apos;, &apos;17:00&apos;, &apos;帮我总结本周工作内容，生成周报&apos;)"><span class="tob-icon">📋</span><div class="tob-info"><div class="tob-name">每周五生成工作周报</div><div class="tob-detail">每周五 17:00 · 自动总结 → 生成周报</div></div><span class="tob-add">+</span></div> <div class="task-onboard-card" onclick="quickCreateTask(&apos;每天&apos;, &apos;09:00&apos;, &apos;帮我查今天天气，如果有雨提醒我带伞&apos;)"><span class="tob-icon">☔</span><div class="tob-info"><div class="tob-name">每天早上查天气</div><div class="tob-detail">每天 09:00 · 查天气 → 有雨提醒带伞</div></div><span class="tob-add">+</span></div> </div> <button class="btn" onclick="showAddTask()" style="margin-top:16px;">自定义创建</button> </div>`;
        return;
      }
      let html = '';
      tasks.forEach(t => {
        const isActive = t.status === 'active';
        const name = t.name || t.id || '(未命名)';
        const schedule = t.schedule || '';
        const nextRun = t.nextRun ? t.nextRun.replace('T', ' ').slice(0, 16) : '';
        const lastRun = t.lastRun ? t.lastRun.replace('T', ' ').slice(0, 16) : '';

        const roleLabel = t.roleId && t.roleId !== 'main' ? (ROLES[t.roleId]?.name || t.roleId) : '';
        html += `<div class="task-card">
          <div class="task-info">
            <strong>${escapeHTML(name)}${roleLabel ? ` <span style="font-size:10px;color:var(--brand-500);background:var(--brand-light);padding:1px 6px;border-radius:4px;">${escapeHTML(roleLabel)}</span>` : ''}</strong>
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

    const roleName = ROLES[_crRole]?.name || _crRole;
    const platformName = card.label;
    try {
      showDialog('⏳', `正在保存 ${roleName}·${platformName} 配置...`);
      const result = await window.hermes.saveChannel(_crChannel, _crRole, data);
      closeChannelRoleModal();
      refreshChannels();

      if (result && result.gatewayRestarted) {
        showDialog('🔄', `${roleName}·${platformName} 已保存\nGateway 重启中，约10秒后生效...`);
        // 等10秒后检查连接状态
        setTimeout(async () => {
          try {
            const status = await window.hermes.gatewayStatus();
            if (status && status.running) {
              showDialog('✅', `${roleName}·${platformName} 配置完成\nGateway 已就绪，去${platformName}发消息试试吧`);
            } else {
              showDialog('⚠️', `${roleName}·${platformName} 已保存\nGateway 仍在启动中，请稍候...`);
            }
          } catch(_) {
            showDialog('✅', `${roleName}·${platformName} 已保存\nGateway 重启中，稍后生效`);
          }
        }, 10000);
      } else {
        showDialog('✅', `${roleName}·${platformName} 已保存`);
      }
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
    try { return await window.hermes.getChannels(); } catch(_) { console.error("getChannels failed"); return {}; }
  }

  async function refreshChannels() {
    const gridEl = document.getElementById('channelCardsGrid');
    gridEl.innerHTML = '<div class="empty-msg"><div class="spinner"></div>加载中...</div>';

    const channels = await getChannels();
    // 缓存到 localStorage 供 getFeishuRole 等函数使用
    try { localStorage.setItem('hermes_channels_cache', JSON.stringify(channels)); } catch (_) {}

    gridEl.innerHTML = CHANNEL_CARDS.map(c => {
      const platformRoles = channels[c.key] || {};
      const roleKeys = Object.keys(platformRoles).filter(k => !k.startsWith('_'));
      const isFeishu = c.key === 'feishu';

      const connectedRoles = roleKeys.filter(r => platformRoles[r].connected === true);
      const roleTags = connectedRoles.length > 0
        ? connectedRoles.map(r => `<span class="chp-role-tag"><img src="avatar://${r}.png" onerror="this.style.display='none'" style="width:16px;height:16px;border-radius:50%;object-fit:cover;" /> ${ROLES[r]?.name || r}</span>`).join('')
        : '';

      return `<div class="channel-platform-card" id="chCard_${c.key}" onclick="openChannelRoleModal('${c.key}')">
        <div class="chp-top">
          <div class="chp-icon-wrap">
            <img src="avatar://${c.icon}.png" alt="${c.label}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" />
            ${isFeishu ? '<span class="chp-recommend">推荐</span>' : ''}
          </div>
          <div class="chp-name">${c.label}</div>
          <div class="chp-desc">${c.desc}</div>
        </div>
        <div class="chp-status">
          ${connectedRoles.length > 0
            ? '<span class="chp-connected">\u{1F7E2} 已连 ' + connectedRoles.length + ' 位员工</span>' + roleTags
            : (roleKeys.length > 0 ? '<span class="chp-disconnected">🔴 未连接</span>' : '<span class="chp-empty">点击添加员工</span>')}
        </div>
        <div class="chp-roles">
          ${roleKeys.map(role => {
            const cfg = platformRoles[role] || {};
            const isConnected = cfg.connected === true;
            return '<div class="chp-role-row" onclick="event.stopPropagation();openChannelRoleModal(\'' + c.key + '\',\'' + role + '\')">' +
              '<img class="chp-role-avatar" src="avatar://' + role + '.png" onerror="this.style.display=\'none\'" />' +
              '<span class="chp-role-name">' + (ROLES[role]?.name || role) + '</span>' +
              '<span class="chp-role-status ' + (isConnected ? 'online' : 'saved') + '">' + (isConnected ? '已连接' : '已保存') + '</span>' +
              '<button class="chp-role-del" onclick="event.stopPropagation();removeChannelRole(\'' + c.key + '\',\'' + role + '\')" title="移除">×</button>' +
              '</div>';
          }).join('')
            || '<div class="chp-role-empty">点击上方卡片添加第一位员工</div>'}
        </div>
      </div>`;
    }).join('');

    checkGatewayStatus();
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
        startFeishuPolling(); // 网关就绪后开始轮询飞书消息
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

  // ===== 飞书消息轮询 =====
  let _feishuPollTimer = null;
  let _feishuLastMsgTime = null;

  function startFeishuPolling() {
    if (_feishuPollTimer) return;
    _feishuPollTimer = setInterval(pollFeishuMessages, 4000);
    pollFeishuMessages(); // 立即执行一次
  }

  async function pollFeishuMessages() {
    if (!window.hermes || !window.hermes.pollFeishuMessages) return;
    try {
      const result = await window.hermes.pollFeishuMessages();
      if (!result.messages || result.messages.length === 0) return;

      for (const msg of result.messages) {
        // 避免重复显示
        const msgKey = msg.time + msg.text.slice(0, 30);
        if (msgKey === _feishuLastMsgTime) continue;
        _feishuLastMsgTime = msgKey;

        const msgRole = msg.roleId || getFeishuRole();
        const rd = ROLES[msgRole] || {};
        const roleName = rd.name || msgRole;
        const displayText = msg.role === 'user'
          ? `📱 ${msg.platform || '飞书'}→${roleName}: ${msg.text}`
          : msg.text;

        // 保存到正确的角色聊天记录（而非当前查看的角色）
        const prevAction = currentAction;
        try {
          currentAction = msgRole; // 临时切换到目标角色
          if (msg.role === 'user') {
            addChatMessage('user', displayText, null, msg.time || null, msg.platform || '飞书');
          } else {
            addChatMessage('hermes', displayText, null, msg.time || null, msg.platform || '飞书');
          }
        } finally {
          currentAction = prevAction; // 恢复当前角色
        }

        // App 和飞书共用同一 Session，无需注入

        // 如果当前不在看该角色的聊天，加未读
        if (!document.getElementById('pageHome').classList.contains('active') || prevAction !== msgRole) {
          bumpUnread(msgRole);
        }

        // 如果当前正在看该角色的聊天，刷新显示
        if (prevAction === msgRole && document.getElementById('pageHome').classList.contains('active')) {
          loadChatHistory();
        }
      }
    } catch (_) {}
  }

  function getFeishuRole() {
    try {
      const channels = JSON.parse(localStorage.getItem('hermes_channels_cache') || '{}');
      if (channels.feishu) {
        const roles = Object.keys(channels.feishu).filter(k => !k.startsWith('_'));
        if (roles.length > 0) return roles[0];
      }
    } catch (_) {}
    return currentAction || 'dami';
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
    try {
      const result = await window.hermes.selectFile();
      if (!result.canceled && result.filePath) {
        chatFilePaths.push({ name: result.filePath.split('/').pop(), path: result.filePath });
        addFileTag(result.filePath.split('/').pop());
      }
    } catch(err) {
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
      return `<a href="#" onclick="event.preventDefault();window.hermes.openFolder('${escaped}')" style="color:var(--brand-500);text-decoration:underline;cursor:pointer;" title="在 Finder 中打开">${match}</a>`;
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
        const opening = `你好，我是${rd.name.replace('我的', '你的')}。有什么需要帮忙的？`;
        addChatMessage('hermes', opening);
      }
      // 首次使用该角色时显示快速上手指引
      _showRoleFirstVisit(role);
      // 若正在新手引导中：切换角色即完成 Step 0，推进到 Step 1
      if (!localStorage.getItem('hermes_onboarding_done') && _onboardingStep === 0) {
        _renderOnboardingStep(1);
      }
      const input = document.getElementById('chatInput');
      if (input) { input.value = ''; input.focus(); }
      updateToolbarTitle(getRoleTitle(role));

      renderQuickActions();
    } finally {
      _switchingRole = false;
    }
  }

  // ===== 角色快捷操作芯片 =====
  const QUICK_ACTIONS = {
    dami:         ['总结文件要点', '写工作周报', '起草一份合同'],
    accountant:   ['分析这个Excel', '对账本月收支', '做利润分析表'],
    programmer:   ['写个网页爬虫', '批量重命名文件', '做一个记账App'],
    writer:       ['写个小说开头', '写篇行业分析', '润色这段文字'],
    screenwriter: ['写短视频脚本', '写品牌文案', '写一篇演讲稿'],
    tutor:        ['解释这个概念', '出几道练习题', '帮我复习知识点'],
    health:       ['分析我的饮食', '制定运动计划', '看看这份体检报告'],
    investor:     ['分析市场行情', '评估投资风险', '看看这份财报'],
  };

  function _showRoleFirstVisit(role) {
    const key = `hermes_role_visited_${role}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    const actions = QUICK_ACTIONS[role] || QUICK_ACTIONS['dami'];
    const rd = _rolesList.find(r => r.id === role) || ROLES[role];
    const name = rd?.name || role;
    const chips = actions.map(a =>
      `<button class="role-tip-chip" onclick="event.stopPropagation();var inp=document.getElementById('chatInput');if(inp){inp.value='${a.replace(/'/g, "\\'")}';inp.focus();}">${a}</button>`
    ).join('');
    const msg = document.createElement('div');
    msg.className = 'chat-msg hermes role-first-visit';
    msg.innerHTML = `<div class="role-tip-banner">
      <div class="rtb-title">💡 试试让「${escapeHtml(name)}」帮你：</div>
      <div class="rtb-chips">${chips}</div>
      <div class="rtb-hint">点击上方指令可直接发送，或自己在输入框输入任何任务</div>
    </div>`;
    const history = document.getElementById('chatHistory');
    if (history) { history.appendChild(msg); scrollChat(); }
  }

  function renderQuickActions() {
    const container = document.getElementById('quickActions');
    if (!container) return;
    const role = currentAction || 'dami';
    const actions = QUICK_ACTIONS[role] || QUICK_ACTIONS['dami'];
    // 也支持动态添加的自定义角色：fallback 用大秘的
    container.innerHTML = actions.map(text =>
      `<button class="quick-action-chip" onclick="event.stopPropagation();var inp=document.getElementById('chatInput');if(inp){inp.value='${text.replace(/'/g, "\\'")}';inp.focus();}">${text}</button>`
    ).join('');
  }

  function updateToolbarTitle(title) {
    const el = document.getElementById('chatToolbarTitle');
    if (el && title) el.textContent = title;
  }

  // ===== 角色指示器 & 切换弹出菜单 =====
  // 角色指示器已移至侧边栏，输入栏不再显示当前角色

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

    // 删除按钮：新建时隐藏，编辑时始终显示（后端拦截不可删的）
    if (deleteBtn) {
      deleteBtn.style.display = role ? '' : 'none';
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
    if (role.builtIn === true) { showDialog('⚠️', '默认员工不可删除'); return; }
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

  function toggleModelSwitcher() {
    const popup = document.getElementById('modelSwitcher');
    const isOpen = popup.classList.contains('show');
    if (isOpen) { popup.classList.remove('show'); return; }

    const models = [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', desc: '最强推理 · 约8-10分/次', provider: 'hergent' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', desc: '快速响应 · 约2-3分/次', provider: 'hergent' },
      { id: 'qwen3-max', name: 'Qwen3 Max', desc: '阿里旗舰 · 258K上下文 · 约5-8分/次', provider: 'bailian' },
      { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', desc: '百万上下文 · 快速便宜 · 约1-2分/次', provider: 'bailian' },
      { id: 'qwen3.7-max', name: 'Qwen3.7 Max', desc: '最新Agent模型 · 超强工具调用', provider: 'bailian' },
    ];
    const list = document.getElementById('msList');
    list.innerHTML = models.map(m => `
      <button class="ms-item${_currentModel === m.id ? ' active' : ''}" onclick="event.stopPropagation();switchModel('${m.id}','${m.provider || 'hergent'}')">
        <span class="ms-item-name">${m.name}</span>
        <span class="ms-item-desc">${m.desc}</span>
      </button>
    `).join('')
    + `<div class="ms-divider"></div>
    <button class="ms-item" onclick="event.stopPropagation();switchPage('pageSettings');document.getElementById('modelSwitcher').classList.remove('show');">
      <span class="ms-item-name">⚙ 自定义模型…</span>
      <span class="ms-item-desc">使用自己的 API Key 和地址</span>
    </button>`;

    const btn = document.getElementById('modelIndicator');
    const rect = btn.getBoundingClientRect();
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    popup.style.left = (rect.left - 6) + 'px';
    popup.classList.add('show');

    if (popup._closeHandler) document.removeEventListener('click', popup._closeHandler);
    setTimeout(() => {
      popup._closeHandler = function closeMS(e) {
        if (!popup.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
          popup.classList.remove('show');
          document.removeEventListener('click', closeMS);
          popup._closeHandler = null;
        }
      };
      document.addEventListener('click', popup._closeHandler);
    }, 10);
  }

  function switchModel(model, provider) {
    document.getElementById('modelSwitcher').classList.remove('show');
    if (model === _currentModel) return;
    _saveModelPreset(model, provider || 'hergent');
    updateModelIndicator(model);
  }

  function updateModelIndicator(model) {
    const label = document.getElementById('miLabel');
    if (!label) return;
    label.textContent = MODEL_LABELS[model || _currentModel] || (model || _currentModel);
    // 更新设置页
    const setModel = document.getElementById('setModelName');
    if (setModel) setModel.textContent = MODEL_LABELS[model || _currentModel] || (model || _currentModel);
  }

  function switchRole(role) {
    document.getElementById('modelSwitcher')?.classList.remove('show');
    handleRole(role);
  }

  // 场景卡片 HTML — 每个角色有专属推荐
  const ROLE_SCENES = {
    dami: [
      { icon: '📄', text: '把PDF总结成要点', prompt: '帮我把这个PDF总结成3个要点' },
      { icon: '✍️', text: '写一份工作周报', prompt: '帮我写一份这周的工作周报' },
      { icon: '🔍', text: '搜索最新行业动态', prompt: '帮我搜一下最近AI行业的新动态' },
      { icon: '📝', text: '起草一份合同', prompt: '帮我起草一份租房合同' },
      { icon: '📧', text: '回复客户邮件', prompt: '帮我写一封回复客户的邮件' },
      { icon: '📋', text: '整理会议纪要', prompt: '帮我把这段会议录音整理成纪要' },
    ],
    accountant: [
      { icon: '📊', text: '分析Excel表格', prompt: '帮我分析这个Excel表格的数据' },
      { icon: '💰', text: '对账银行流水', prompt: '帮我对一下这个月的银行流水' },
      { icon: '📈', text: '做利润分析表', prompt: '帮我把这些数据做成利润分析表' },
      { icon: '🧾', text: '整理发票报销', prompt: '帮我整理这些发票按类别汇总' },
      { icon: '📉', text: '成本核算分析', prompt: '帮我做一份成本核算分析' },
      { icon: '💳', text: '算个税社保', prompt: '帮我算一下这个月的个税和社保' },
    ],
    programmer: [
      { icon: '🐍', text: '写Python脚本', prompt: '帮我写个批量重命名文件的Python脚本' },
      { icon: '🔧', text: '写自动化工具', prompt: '帮我写个自动备份文件夹的脚本' },
      { icon: '🐛', text: 'Debug代码', prompt: '帮我看看这段代码为什么报错' },
      { icon: '🌐', text: '写个网页应用', prompt: '帮我写一个简单的记账网页' },
      { icon: '📦', text: '处理数据文件', prompt: '帮我写个脚本批量处理CSV数据' },
      { icon: '⚡', text: '优化代码性能', prompt: '帮我优化一下这段代码的性能' },
    ],
    writer: [
      { icon: '📖', text: '写一篇公众号文章', prompt: '帮我写一篇关于创业经历的公众号文章' },
      { icon: '✍️', text: '润色一篇文章', prompt: '帮我润色这篇文章，让文字更有感染力' },
      { icon: '📚', text: '整理经验写电子书', prompt: '帮我把行业经验整理成一本电子书' },
      { icon: '🎤', text: '写演讲稿', prompt: '帮我写一篇年会上的演讲稿' },
      { icon: '📝', text: '写品牌故事', prompt: '帮我写一个品牌故事' },
      { icon: '💌', text: '写一封走心的信', prompt: '帮我写一封给合作伙伴的感谢信' },
    ],
    screenwriter: [
      { icon: '🎬', text: '写短视频脚本', prompt: '帮我写一个15秒的带货短视频脚本' },
      { icon: '📱', text: '写小红书文案', prompt: '帮我写一篇小红书种草文案' },
      { icon: '🎯', text: '写广告标语', prompt: '帮我写几个品牌广告语' },
      { icon: '📺', text: '写直播话术', prompt: '帮我写一段直播带货的话术' },
      { icon: '🎭', text: '写剧情脚本', prompt: '帮我写一个3分钟的情景短剧脚本' },
      { icon: '💡', text: '想营销创意', prompt: '帮我想几个新品上市的营销创意' },
    ],
    tutor: [
      { icon: '🧮', text: '讲解数学概念', prompt: '帮我讲一下概率论的基础概念' },
      { icon: '💻', text: '教Python编程', prompt: 'Python爬虫怎么学' },
      { icon: '📝', text: '辅导写作文', prompt: '帮孩子辅导一下这篇作文' },
      { icon: '🌍', text: '练英语口语', prompt: '帮我准备一段英语面试自我介绍' },
      { icon: '📚', text: '制定学习计划', prompt: '帮我制定一个30天考雅思的计划' },
      { icon: '❓', text: '解答疑问', prompt: '为什么天空是蓝色的' },
    ],
    health: [
      { icon: '🥗', text: '规划饮食计划', prompt: '帮我规划下周的健康饮食计划' },
      { icon: '🏃', text: '制定运动方案', prompt: '帮我制定一个适合久坐族的运动计划' },
      { icon: '😴', text: '改善睡眠质量', prompt: '最近睡眠不好，帮我分析一下原因' },
      { icon: '🩺', text: '看体检报告', prompt: '帮我看一下这份体检报告' },
      { icon: '🧘', text: '缓解工作压力', prompt: '工作压力大，有什么放松的方法' },
      { icon: '💊', text: '营养补充建议', prompt: '日常需要补充哪些维生素' },
    ],
    investor: [
      { icon: '📈', text: '分析市场行情', prompt: '帮我分析一下最近的A股市场行情' },
      { icon: '💰', text: '做资产配置', prompt: '我有10万闲钱，低风险的怎么配' },
      { icon: '🏠', text: '分析房产投资', prompt: '现在适合买房投资吗' },
      { icon: '📊', text: '看基金表现', prompt: '帮我分析一下这几只基金的表现' },
      { icon: '💡', text: '学习理财知识', prompt: '新手怎么开始理财' },
      { icon: '🔍', text: '研究公司财报', prompt: '帮我解读一下这份公司财报' },
    ],
  };

  function updateWelcomeGreeting() {
    const hour = new Date().getHours();
    let greeting, icon;
    if (hour < 12) { greeting = '早上好'; icon = '🌅'; }
    else if (hour < 18) { greeting = '下午好'; icon = '☀️'; }
    else { greeting = '晚上好'; icon = '🌙'; }
    
    const iconEl = document.getElementById('welcomeIcon');
    const textEl = document.getElementById('welcomeText');
    if (iconEl) iconEl.textContent = icon;
    if (textEl) textEl.textContent = greeting;
    
    const r = currentAction || 'dami';
    const roleName = (ROLES[r] && ROLES[r].name) || '大秘';
    const preset = ((ROLES[r] && ROLES[r].avatarPreset) || r || 'dami');
    
    const avatarEl = document.getElementById('welcomeAvatar');
    const nameEl = document.getElementById('welcomeRoleName');
    if (avatarEl) avatarEl.src = `avatar://${preset}.png`;
    if (nameEl) nameEl.textContent = roleName;
  }

  function getSceneCardsHTML() {
    const r = currentAction || 'dami';
    const scenes = ROLE_SCENES[r] || ROLE_SCENES['dami'];
    
    let html = '';
    scenes.forEach(s => {
      html += `<div class="scene-card" onclick="handleSceneCard('${r}','${s.prompt.replace(/'/g, "\\'")}')"><span class="scene-icon">${s.icon}</span><span class="scene-text">${s.text}</span><span class="scene-arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span></div>`;
    });
    html += '<div class="home-hint">或直接打字，说说你想做什么</div>';
    return html;
  }

  // 渲染空状态（带问候语）
  function renderEmptyState() {
    updateWelcomeGreeting();
    const cardsEl = document.getElementById('homeSceneCards');
    if (cardsEl) {
      cardsEl.innerHTML = getSceneCardsHTML();
    }
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
      let empty = document.getElementById('chatEmpty');
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'chat-empty';
        empty.id = 'chatEmpty';
        empty.innerHTML = '<div class="welcome-area"><div class="welcome-greeting"><span class="welcome-greeting-icon" id="welcomeIcon">☀️</span><span class="welcome-greeting-text" id="welcomeText">下午好</span></div><div class="welcome-intro"><img class="welcome-avatar" id="welcomeAvatar" src="avatar://dami.png" alt="" /><span>我是你的<strong id="welcomeRoleName">大秘</strong>，能动手的 AI 员工</span></div><div class="welcome-capabilities" id="welcomeCapabilities"><span class="wcap-pill"><span>📂</span> 读文件分析</span><span class="wcap-pill"><span>⏰</span> 定时干活</span><span class="wcap-pill"><span>🌐</span> 搜索整理</span><span class="wcap-pill"><span>📱</span> 手机遥控</span></div><div class="welcome-privacy"><span class="wprivacy-icon">🔒</span> 所有数据都在你的电脑上处理，不出本地</div></div><div class="home-scene-cards" id="homeSceneCards"></div>';
        document.getElementById('chatHistory').appendChild(empty);
      }
      empty.style.display = '';
      renderEmptyState();
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
    let empty = document.getElementById('chatEmpty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.id = 'chatEmpty';
      empty.innerHTML = '<div class="welcome-area"><div class="welcome-greeting"><span class="welcome-greeting-icon" id="welcomeIcon">☀️</span><span class="welcome-greeting-text" id="welcomeText">下午好</span></div><div class="welcome-intro"><img class="welcome-avatar" id="welcomeAvatar" src="avatar://dami.png" alt="" /><span>我是你的<strong id="welcomeRoleName">大秘</strong>，能动手的 AI 员工</span></div><div class="welcome-capabilities" id="welcomeCapabilities"><span class="wcap-pill"><span>📂</span> 读文件分析</span><span class="wcap-pill"><span>⏰</span> 定时干活</span><span class="wcap-pill"><span>🌐</span> 搜索整理</span><span class="wcap-pill"><span>📱</span> 手机遥控</span></div><div class="welcome-privacy"><span class="wprivacy-icon">🔒</span> 所有数据都在你的电脑上处理，不出本地</div></div><div class="home-scene-cards" id="homeSceneCards"></div>';
    }
    empty.style.display = '';
    renderEmptyState();
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
  let _streamRespText = '';  // 流式回复累积文本
  let _pipelineEl = null;    // pipeline 进度条容器
  let _pipelineMode = false; // 工作组协作模式
  let _pipelineRoles = [];   // 工作组角色列表
  let _pipelineResults = null; // 当前 pipeline 各步骤结果

  // ===== 工作组 Pipeline 模式 =====
  function togglePipelineMode() {
    _pipelineMode = !_pipelineMode;
    const toggle = document.getElementById('pipelineToggle');
    const bar = document.getElementById('pipelineRolesBar');
    const input = document.getElementById('chatInput');

    if (_pipelineMode) {
      if (!_pipelineRoles.length) {
        _pipelineRoles = [currentAction || 'dami'];
      }
      if (_pipelineRoles.length < 2) {
        // 默认加入一个推荐角色
        const all = _rolesList.map(r => r.id);
        const other = all.find(id => id !== _pipelineRoles[0]) || 'programmer';
        _pipelineRoles.push(other);
      }
      if (toggle) toggle.classList.add('active');
      if (bar) bar.style.display = '';
      if (input) input.placeholder = '描述任务，工作组将按顺序协作完成...';
      _renderPipelineRolesBar();
    } else {
      if (toggle) toggle.classList.remove('active');
      if (bar) bar.style.display = 'none';
      if (input) input.placeholder = '说说你想做什么…';
    }
  }

  function _renderPipelineRolesBar() {
    const container = document.getElementById('prbRoles');
    if (!container) return;
    container.innerHTML = _pipelineRoles.map((rid, i) => {
      const rd = _rolesList.find(r => r.id === rid) || {};
      const name = rd.name || rid;
      const preset = rd.avatarPreset || rid;
      return `<span class="prb-role-chip">
        <img class="prb-avatar" src="avatar://${preset}.png" alt="" />
        <span>${escapeHtml(name)}</span>
        ${i < _pipelineRoles.length - 1 ? '<span class="prb-arrow">→</span>' : ''}
      </span>`;
    }).join('');
  }

  function showPipelineConfig() {
    const overlay = document.getElementById('pipelineConfigOverlay');
    const container = document.getElementById('pipelineConfigRoles');
    if (!overlay || !container) return;
    showOverlay('pipelineConfigOverlay');
    const allRoles = _rolesList.map(r => ({ id: r.id, name: r.name, preset: r.avatarPreset || r.id }));
    const selected = new Set(_pipelineRoles);
    container.innerHTML = allRoles.map((r, i) => {
      const checked = selected.has(r.id);
      return `<div class="pcr-role ${checked ? 'checked' : ''}" data-role="${r.id}" onclick="togglePipelineRole('${r.id}')">
        <span class="pcr-check">${checked ? '☑' : '☐'}</span>
        <img class="pcr-avatar" src="avatar://${r.preset}.png" alt="" />
        <span class="pcr-name">${escapeHtml(r.name)}</span>
        ${checked ? `<span class="pcr-order">第${_pipelineRoles.indexOf(r.id) + 1}步</span>` : ''}
      </div>`;
    }).join('');
    // 提示最少2个
    if (_pipelineRoles.length < 2) {
      container.insertAdjacentHTML('beforeend', '<p class="pcr-hint">请至少选择 2 个角色组成工作组</p>');
    }
  }

  function togglePipelineRole(roleId) {
    const idx = _pipelineRoles.indexOf(roleId);
    if (idx >= 0) {
      _pipelineRoles.splice(idx, 1);
    } else {
      if (_pipelineRoles.length >= 4) return; // 最多4个
      _pipelineRoles.push(roleId);
    }
    showPipelineConfig(); // 刷新弹窗
  }

  function closePipelineConfig() {
    hideOverlay('pipelineConfigOverlay');
  }

  function applyPipelineConfig() {
    if (_pipelineRoles.length < 2) {
      _pipelineRoles = [currentAction || 'dami'];
      const all = _rolesList.map(r => r.id);
      const other = all.find(id => id !== _pipelineRoles[0]) || 'programmer';
      _pipelineRoles.push(other);
    }
    _renderPipelineRolesBar();
    closePipelineConfig();
    // 确保 pipeline 模式开启
    if (!_pipelineMode) togglePipelineMode();
  }
  window.hermes_on.stream((data) => {
    if (!_streamActive || !_streamTarget || _switchingRole) return;

    // —— pipeline 步骤进度 ——
    if (data.type === 'pipeline-step') {
      if (!_pipelineEl && _streamTarget) {
        _pipelineEl = document.createElement('div');
        _pipelineEl.className = 'pipeline-steps has-cards';
        _streamTarget.appendChild(_pipelineEl);
      }
      _renderPipelineStep(data);
      return;
    }

    if (_streamRole && _streamRole !== (currentAction || 'chat')) return;
    const step = (data && data.text) ? data.text.trim() : '';
    if (!step || step.startsWith('│') || step.startsWith('╭') || step.startsWith('╰')) return;

    // 回复内容 → 逐字累积显示
    if (data.type === 'response') {
      _streamRespText += step;
      if (_streamTarget) {
        _streamTarget.innerHTML = '<div class="stream-response">' + renderMarkdown(_streamRespText) + '</div><span class="stream-typing">●</span>';
        if (_streamStepEl) _streamStepEl.style.display = 'none';
      }
      scrollChat();
      return;
    }

    // 系统消息（离线模式等）→ 跳过
    if (data.type === 'system') return;

    // 工具步骤 → 显示步骤列表
    _streamSteps.push(step);
    _renderStreamSteps();
  });

  function _renderPipelineStep(data) {
    if (!_pipelineEl || !_streamTarget) return;
    // 保持已有步骤状态，追加或更新当前步骤
    let html = '<div class="pipeline-header">🤝 工作组协作中...</div><div class="pipeline-steps-inner">';
    const allRoles = _pipelineRoles.length > 0 ? _pipelineRoles : [data.role || 'dami'];
    for (let i = 0; i < data.total; i++) {
      const rid = allRoles[i] || data.role || 'dami';
      const rd = _rolesList.find(r => r.id === rid) || {};
      const name = rd.name || rid;
      const preset = rd.avatarPreset || rid;
      let cls = 'pending', dot = '○', statusText = '等待中';
      if (i + 1 < data.step) { cls = 'done'; dot = '✓'; statusText = '已完成'; }
      else if (i + 1 === data.step) {
        if (data.status === 'error') { cls = 'error'; dot = '✗'; statusText = data.error || '失败'; }
        else if (data.status === 'done') { cls = 'done'; dot = '✓'; statusText = '已完成'; }
        else { cls = 'active'; dot = '●'; statusText = '处理中...'; }
      }
      html += `<div class="pipeline-step-card ${cls}">
        <img class="psc-avatar" src="avatar://${preset}.png" alt="" />
        <div class="psc-body">
          <div class="psc-name">${escapeHtml(name)} <span class="psc-dot">${dot}</span></div>
          <div class="psc-status">${statusText}</div>
        </div>
      </div>`;
    }
    html += '</div>';
    // 当前步骤的输出预览
    if (data.status === 'done' && data.preview) {
      html += `<div class="pipeline-step-preview">${escapeHtml(data.preview).slice(0, 200)}</div>`;
    }
    _pipelineEl.innerHTML = html;
    if (_streamStepEl) _streamStepEl.style.display = 'none';
  }

  function _renderStreamSteps() {
    if (!_streamStepEl || !_streamTarget) return;
    _streamStepEl.style.display = '';
    const steps = _streamSteps.slice(-5);
    _streamStepEl.innerHTML = steps.map((s, i) => {
      const isLast = i === steps.length - 1;
      const clean = s.replace(/^┊\s*/, '');
      const icon = _toolIcon(clean);
      return `<div class="stream-step ${isLast ? 'active' : 'done'}">
        <span class="stream-step-dot">${isLast ? '●' : '✓'}</span>
        <span class="stream-step-icon">${icon}</span>
        <span class="stream-step-text">${clean}</span>
      </div>`;
    }).join('');

    // 同步更新 loading 消息下方的工具标签
    const existing = _streamTarget.querySelector('.tool-tags');
    if (existing) existing.remove();
    if (steps.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'tool-tags';
      const seen = new Set();
      const icons = [];
      for (const s of [...steps].reverse()) {
        const clean = s.replace(/^┊\s*/, '');
        const icon = _toolIcon(clean);
        if (!seen.has(icon)) { seen.add(icon); icons.push(icon); }
        if (icons.length >= 4) break;
      }
      tags.innerHTML = icons.map(i => `<span class="tool-tag">${i}</span>`).join('');
      _streamTarget.appendChild(tags);
    }
  }

  function _toolIcon(text) {
    const t = text.toLowerCase();
    if (/search|搜索|检索|查询|查找|bing|google|web|arxiv|wiki/i.test(t)) return '🔍';
    if (/read|读取|读|打开.*文件|查看.*文件|file|cat |head |tail |less /i.test(t)) return '📄';
    if (/write|写入|写|保存|创建.*文件|生成.*文件|create|touch |mkdir|new file/i.test(t)) return '✏️';
    if (/code|代码|编程|执行.*代码|python|bash|shell|terminal|exec|run|compile/i.test(t)) return '💻';
    if (/browser|浏览器|打开.*网页|navigate|click|screenshot|playwright|selenium/i.test(t)) return '🌐';
    if (/think|思考|分析|推理|reason|plan|规划|reflect|evaluate/i.test(t)) return '🧠';
    if (/fetch|http|api|request|curl|下载|download|upload|上传/i.test(t)) return '📡';
    if (/extract|解析|提取|parse|convert|转换|transform|process|处理/i.test(t)) return '🔧';
    if (/image|图片|图像|画|生成.*图|dalle|midjourney|stable/i.test(t)) return '🎨';
    if (/memory|记忆|recall|remember|store|memorize|save.*context/i.test(t)) return '💾';
    if (/edit|编辑|修改|change|update|replace|diff|patch/i.test(t)) return '📝';
    if (/git|commit|push|pull|branch|merge|repo/i.test(t)) return '🔀';
    if (/deploy|部署|publish|发布|release|build/i.test(t)) return '🚀';
    return '⚡';
  }

  function _initStreamSteps(loadingMsg) {
    _streamSteps = [];
    _streamRespText = '';
    _streamStartTime = Date.now();
    _streamStepEl = document.createElement('div');
    _streamStepEl.className = 'stream-steps';
    loadingMsg.appendChild(_streamStepEl);
  }

  function addChatMessage(role, text, fileNames, msgTime, platform, pipeline) {
    const history = document.getElementById('chatHistory');
    const empty = history.querySelector('.chat-empty');
    if (empty) empty.style.display = 'none';

    // 创建消息行容器
    const row = document.createElement('div');
    row.className = `msg-row ${role === 'user' ? 'user-row' : 'hermes-row'}`;

    // Pipeline 消息：工作组头像
    if (role === 'hermes' && pipeline && pipeline.length > 0) {
      const avatarGroup = document.createElement('div');
      avatarGroup.className = 'msg-avatar-group';
      pipeline.forEach((r, i) => {
        const rd = _rolesList.find(rr => rr.id === r.role) || {};
        const preset = rd.avatarPreset || r.role || 'dami';
        const img = document.createElement('img');
        img.className = 'msg-avatar msg-avatar-stacked';
        img.src = `avatar://${preset}.png`;
        img.alt = rd.name || r.role;
        img.style.zIndex = pipeline.length - i;
        img.onerror = function() { this.style.display = 'none'; };
        avatarGroup.appendChild(img);
      });
      row.appendChild(avatarGroup);
    } else if (role === 'hermes') {
      const avatar = document.createElement('img');
      avatar.className = 'msg-avatar';
      // 获取当前角色头像
      const activeRole = _rolesList.find(r => r.id === currentAction);
      const preset = (activeRole && activeRole.avatarPreset) || currentAction || 'dami';
      avatar.src = `avatar://${preset}.png`;
      avatar.alt = (activeRole && activeRole.name) || 'AI';
      avatar.onerror = function() {
        this.style.display = 'none';
        const ph = document.createElement('div');
        ph.className = 'msg-avatar-placeholder';
        ph.textContent = ((activeRole && activeRole.name) || 'AI').charAt(0);
        this.parentNode.insertBefore(ph, this);
      };
      row.appendChild(avatar);
    }

    // 消息体
    const body = document.createElement('div');
    body.className = 'msg-body';

    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;

    const now = new Date();
    const time = msgTime || `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    let inner = '';
    if (platform) {
      inner += `<span class="platform-badge">📱 来自${platform}</span> `;
    }

    // Pipeline 结果：渲染可折叠的 per-role 区块
    if (pipeline && pipeline.length > 0) {
      inner += `<div class="pipeline-result">
        <div class="pp-intro">🤝 工作组协作 — ${pipeline.length} 位角色</div>`;
      pipeline.forEach((r, i) => {
        const rid = r.role || 'dami';
        const rd = _rolesList.find(rr => rr.id === rid) || {};
        const name = rd.name || rid;
        const preset = rd.avatarPreset || rid;
        const isError = r.output && r.output.startsWith('[错误]');
        inner += `<div class="pp-result ${isError ? 'error' : ''}">
          <div class="ppr-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <img class="ppr-avatar" src="avatar://${preset}.png" alt="" />
            <span class="ppr-name">第${i+1}步：${escapeHtml(name)}</span>
            <span class="ppr-status">${isError ? '❌' : '✅'}</span>
            <svg class="ppr-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="ppr-body">${renderMarkdown(r.output.replace(/^\[错误\]\s*/, ''))}</div>
        </div>`;
      });
      inner += `<button class="pp-rerun" onclick="rerunPipeline()">🔄 重新执行</button>`;
      inner += '</div>';
    } else {
      inner += renderMarkdown(text);
    }

    if (fileNames && fileNames.length > 0) {
      fileNames.forEach(f => { inner += `<br><span class="files-badge">📎 ${f}</span>`; });
    }
    inner += `<span class="time">${time}</span>`;

    div.setAttribute('data-text', text);
    div.innerHTML = inner;
    body.appendChild(div);

    // 用户消息加编辑按钮
    if (role === 'user') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = '<button class="msg-action-btn msg-edit-btn" title="编辑" onclick="event.stopPropagation();editUserMsg(this)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
      body.appendChild(actions);
    }
    // Hermes 回复加操作栏
    if (role === 'hermes' && text !== '思考中' && text !== '工作组协作中...') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = '<button class="msg-action-btn" title="复制" onclick="event.stopPropagation();copyMsgReply(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
        '<button class="msg-action-btn" title="重新生成" onclick="event.stopPropagation();retryMsg(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>' +
        '<button class="msg-action-btn feedback-btn" title="有用" onclick="event.stopPropagation();feedbackMsg(this,\'up\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg></button>' +
        '<button class="msg-action-btn feedback-btn" title="没用" onclick="event.stopPropagation();feedbackMsg(this,\'down\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V4H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/></svg></button>';
      body.appendChild(actions);
    }

    row.appendChild(body);
    history.appendChild(row);
    scrollChat();

    return div;
  }

  // ===== 消息快捷操作 =====
  function editUserMsg(btn) {
    const msg = btn.closest('.chat-msg');
    if (!msg) return;
    const text = msg.getAttribute('data-text') || '';
    const input = document.getElementById('chatInput');
    if (input) {
      input.value = text.trim();
      input.focus();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      // 滚动到输入框
      input.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

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
    // 找到这条回复所在的 row，再找前一个 row 中的用户消息
    const row = msg.closest('.msg-row');
    const prevRow = row ? row.previousElementSibling : null;
    const userMsg = prevRow ? prevRow.querySelector('.chat-msg.user') : null;
    if (userMsg) {
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
    btn.parentElement.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('active'));
    if (!wasActive) {
      btn.classList.add('active');
      // 上报反馈数据到本地日志
      const msgEl = btn.closest('.chat-msg');
      const reqId = msgEl ? msgEl.closest('[data-reqid]')?.getAttribute('data-reqid') : null;
      try {
        if (window.hermes && window.hermes.execute) {
          window.hermes.execute('feedback:send', { type, requestId: reqId || '', text: msgEl?.textContent?.slice(0, 200) || '', timestamp: Date.now() }).catch(() => {});
        }
      } catch (_) {}
    }
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
    _pipelineEl = null;
    _pipelineResults = null;
    toggleCancelButton(false);
    localStorage.removeItem('hermes_streaming');
  }

  // 渲染成功响应到 loading 消息
  function _renderSuccess(loadingMsg, cleanText, result) {
    const cost = (result && result.cost) ? result.cost : 0;
    const balance = (result && result.balance != null) ? result.balance : null;
    const isOffline = result && result.offline;
    const costLine = isOffline
      ? '<span class="cost-tag offline">⚡ 本地模式 · Hermes CLI</span>'
      : (cost > 0 ? `<span class="cost-tag">消耗 ${cost} 积分${balance != null ? ' · 剩余 ' + balance : ''}</span>` : '');

    // 思考耗时
    let durHTML = '';
    if (_streamStartTime > 0) {
      const dur = Math.round((Date.now() - _streamStartTime) / 1000);
      durHTML = `<span class="duration-tag">${dur}秒</span>`;
    }
    const timeStr = new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});

    // 思考过程折叠面板
    let thinkingHTML = '';
    if (_streamSteps.length > 0 && _streamStartTime > 0) {
      const thinkingId = 'thinking_' + Date.now();
      const totalDur = Math.round((Date.now() - _streamStartTime) / 1000);
      thinkingHTML = `
        <details class="thinking-panel">
          <summary class="thinking-summary">
            <span class="thinking-icon">🧠</span>
            <span class="thinking-label">思考过程</span>
            <span class="thinking-count">${_streamSteps.length} 步</span>
            <span class="thinking-dur">${totalDur}秒</span>
            <svg class="thinking-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <div class="thinking-body">
            ${_streamSteps.map((s, i) => {
              const clean = s.replace(/^\[[^\]]+\]\s*/, '').replace(/^┊\s*/, '');
              const emoji = _toolIcon(clean);
              return `<div class="thinking-step">
                <span class="thinking-step-num">${i + 1}</span>
                <span class="thinking-step-emoji">${emoji}</span>
                <span class="thinking-step-text">${escapeHTML(clean)}</span>
              </div>`;
            }).join('')}
          </div>
        </details>`;
    }

    const footerHTML = `<div class="msg-footer">${costLine}${durHTML} <span class="time">${timeStr}</span></div>`;
    // 记录消息消耗用于费用预估
    if (cost > 0) _recordMessageCost(cost, _currentModel);
    // 工具使用摘要（始终可见）
    let toolSummaryHTML = '';
    if (_streamSteps.length > 0) {
      const seen = new Set();
      const icons = [];
      for (const s of [..._streamSteps].reverse()) {
        const clean = s.replace(/^┊\s*/, '');
        const icon = _toolIcon(clean);
        if (!seen.has(icon)) { seen.add(icon); icons.push(icon); }
        if (icons.length >= 5) break;
      }
      if (icons.length > 0) {
        toolSummaryHTML = `<div class="tool-summary">${icons.join(' ')}</div>`;
      }
    }
    loadingMsg.innerHTML = thinkingHTML + toolSummaryHTML + renderFinal(cleanText) + footerHTML;
    loadingMsg.removeAttribute('data-pending');
    scrollChat();
    updateCreditsBadge();
    updateCostEstimate();
    // 窗口不在前台时发送系统通知
    if (!document.hasFocus() && cleanText) {
      notifyIfAway('Hergent 回复了', cleanText.slice(0, 100));
    }
  }

  // 渲染失败响应到 loading 消息
  function _renderError(loadingMsg, err, sendingRole) {
    const errMsg = friendlyError(err);
    loadingMsg.innerHTML = `❌ 发送失败：${errMsg}<span class="time">${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span>`;
    showConnBanner(errMsg, true);
    startConnMonitor();
    saveResponseToRole(sendingRole, `❌ 发送失败：${errMsg}`);
  }

  function _renderPipelineResult(loadingMsg, result) {
    const results = result.pipeline || _pipelineResults || [];
    if (!results.length) {
      loadingMsg.innerHTML = '<div class="stream-response">' + renderMarkdown(result.output || '') + '</div>';
      return;
    }
    const sections = results.map((r, i) => {
      const roleId = r.role || 'dami';
      const rd = _rolesList.find(rr => rr.id === roleId) || {};
      const name = rd.name || roleId;
      const preset = rd.avatarPreset || roleId;
      const isError = r.output && r.output.startsWith('[错误]');
      return `<div class="pp-result ${isError ? 'error' : ''}">
        <div class="ppr-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <img class="ppr-avatar" src="avatar://${preset}.png" alt="" />
          <span class="ppr-name">第${i+1}步：${escapeHtml(name)}</span>
          <span class="ppr-status">${isError ? '❌' : '✅'}</span>
          <svg class="ppr-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="ppr-body">${renderMarkdown(r.output.replace(/^\[错误\]\s*/, ''))}</div>
      </div>`;
    }).join('');
    loadingMsg.innerHTML = `<div class="pipeline-result">
      <div class="pp-intro">🤝 工作组完成 — ${results.length} 位角色协作</div>
      ${sections}
      <button class="pp-rerun" onclick="rerunPipeline()">🔄 重新执行</button>
      <span class="time">${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span>
    </div>`;
  }

  function rerunPipeline() {
    const input = document.getElementById('chatInput');
    if (input) input.focus();
    if (_pipelineMode && _pipelineRoles.length >= 2) {
      sendMessage(); // Re-sends the last input if still available
    }
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
      addChatMessage('hermes', `🪙 积分不足（剩余 ${creditsCheck.credits} 分），请充值后继续使用`);
      input.value = text;
      input.focus();
      showActivationDialog();
      return;
    }
    // 低余额提醒（允许继续但提示）
    if (creditsCheck.low && creditsCheck.credits > 0) {
      addChatMessage('hermes', `⚠️ 剩余积分较少（${creditsCheck.credits} 分），本次对话约需 ${creditsCheck.avgCost} 分，建议尽快充值`);
    }

    // 保存文件路径，清空 UI
    const sendPaths = chatFilePaths.map(f => f.path);
    addChatMessage('user', text || '(已选文件)', fileNames.length > 0 ? fileNames : null);
    input.value = '';
    chatFilePaths.length = 0;
    document.getElementById('chatFiles').innerHTML = '';

    // === 工作组 Pipeline 模式 ===
    if (_pipelineMode && _pipelineRoles.length >= 2 && text) {
      const steps = _pipelineRoles.map(rid => ({ role: rid, text: text }));
      const loadingMsg = addChatMessage('hermes', '工作组协作中...');
      _initStreamSteps(loadingMsg);
      loadingMsg.setAttribute('data-pending', 'true');
      _streamTarget = loadingMsg;
      _streamActive = true;
      _streamRole = null; // pipeline 不绑定单角色
      _pipelineResults = [];
      toggleCancelButton(true);
      _startPendingTimer(loadingMsg);
      _streamKey = chatStorageKey();
      localStorage.setItem('hermes_streaming', 'pipeline');

      try {
        const result = await window.hermes.execute('pipeline:run', { steps, context: '' });
        _resetStreamState();

        let respText = '';
        if (result && result.pipeline) {
          _pipelineResults = result.pipeline;
          _renderPipelineResult(loadingMsg, result);
          respText = '🤝 工作组协作完成 — ' + result.pipeline.length + ' 位角色协作';
        } else if (result && result.output) {
          loadingMsg.innerHTML = '<div class="stream-response">' + renderMarkdown(result.output) + '</div>';
          respText = result.output;
        } else {
          loadingMsg.innerHTML = '❌ 工作组执行失败';
          respText = '❌ 工作组执行失败';
        }

        // 更新 data-text 属性（用于复制功能）
        loadingMsg.setAttribute('data-text', respText);

        // 为 pipeline 结果补加操作栏（初始渲染时因 text='工作组协作中...' 被跳过了）
        if (result && result.pipeline) {
          const body = loadingMsg.parentElement;
          if (body && !body.querySelector('.msg-actions')) {
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            actions.innerHTML = '<button class="msg-action-btn" title="复制" onclick="event.stopPropagation();copyMsgReply(this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
              '<button class="msg-action-btn" title="重新执行" onclick="event.stopPropagation();rerunPipeline()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>' +
              '<button class="msg-action-btn feedback-btn" title="有用" onclick="event.stopPropagation();feedbackMsg(this,\'up\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg></button>' +
              '<button class="msg-action-btn feedback-btn" title="没用" onclick="event.stopPropagation();feedbackMsg(this,\'down\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V4H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/></svg></button>';
            body.appendChild(actions);
          }
        }

        updateCreditsBadge();
        updateCostEstimate();
        // 持久化
        const msgs = JSON.parse(localStorage.getItem(_streamKey) || '[]');
        const last = msgs[msgs.length - 1];
        if (last && last.text === '工作组协作中...') { last.text = respText; last.time = new Date().toISOString(); last.pipeline = _pipelineResults; }
        else { msgs.push({ role: 'hermes', text: respText, time: new Date().toISOString(), pipeline: _pipelineResults }); }
        localStorage.setItem(_streamKey, JSON.stringify(msgs));
        if (!loadingMsg.isConnected) loadChatHistory();
      } catch (e) {
        _resetStreamState();
        _renderError(loadingMsg, e, 'pipeline');
        const errText = '❌ 工作组执行失败: ' + (e.message || '');
        loadingMsg.setAttribute('data-text', errText);
        const msgs = JSON.parse(localStorage.getItem(_streamKey) || '[]');
        const last = msgs[msgs.length - 1];
        if (last && last.text === '工作组协作中...') { last.text = errText; last.time = new Date().toISOString(); }
        else { msgs.push({ role: 'hermes', text: errText, time: new Date().toISOString() }); }
        localStorage.setItem(_streamKey, JSON.stringify(msgs));
        if (!loadingMsg.isConnected) loadChatHistory();
      }
      return;
    }

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
        const result = await window.hermes.execute('chat:send', { action: 'chat', text: fullPrompt, files: sendPaths, role: sendingRole });
        if (result && result.requestId) loadingMsg.setAttribute('data-reqid', result.requestId);
        if (result && result.sessionId) localStorage.setItem('hermes_session_' + (sendingRole || 'chat'), result.sessionId);
        _resetStreamState();

        if (sendingRole !== (currentAction || 'chat') || !document.getElementById('pageHome').classList.contains('active')) bumpUnread(sendingRole);

        const resp = ((result && result.output) ? result.output : '✅ 已提交处理')
          .replace(/^session_id:.*\n?/gm, '').replace(/\n{2,}/g, '\n');
        _renderSuccess(loadingMsg, resp, result);
        updateCreditsBadge(); // 聊天后刷新积分显示

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
        sendText = `${isRole.systemPrompt}\n\n用户消息：${text}`;
      }
      if (isOnboarding) {
        sendText = `[引导模式——用户第一次使用Hergent。请回复：先友好地问候，然后问用户"你平时主要做什么工作/学什么？"，根据回复推荐1-2个合适的数字员工角色。简洁自然，像朋友聊天。]\n\n[用户消息]${text}`;
      }

      const result = await window.hermes.execute('chat:send', { action: isRole ? 'chat' : effectiveAction, text: sendText, files: sendPaths, role: sendingRole });
      if (result && result.requestId) loadingMsg.setAttribute('data-reqid', result.requestId);
      if (result && result.sessionId) localStorage.setItem('hermes_session_' + (sendingRole || 'chat'), result.sessionId);
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
    let empty = document.getElementById('chatEmpty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.id = 'chatEmpty';
      empty.innerHTML = '<div class="welcome-area"><div class="welcome-greeting"><span class="welcome-greeting-icon" id="welcomeIcon">☀️</span><span class="welcome-greeting-text" id="welcomeText">下午好</span></div><div class="welcome-intro"><img class="welcome-avatar" id="welcomeAvatar" src="avatar://dami.png" alt="" /><span>我是你的<strong id="welcomeRoleName">大秘</strong>，能动手的 AI 员工</span></div><div class="welcome-capabilities" id="welcomeCapabilities"><span class="wcap-pill"><span>📂</span> 读文件分析</span><span class="wcap-pill"><span>⏰</span> 定时干活</span><span class="wcap-pill"><span>🌐</span> 搜索整理</span><span class="wcap-pill"><span>📱</span> 手机遥控</span></div><div class="welcome-privacy"><span class="wprivacy-icon">🔒</span> 所有数据都在你的电脑上处理，不出本地</div></div><div class="home-scene-cards" id="homeSceneCards"></div>';
    }
    empty.style.display = '';
    renderEmptyState();
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
        msgs.forEach(m => addChatMessage(m.role, m.text, m.files, m.time, m.platform, m.pipeline));
        _loadingHistory = false;
      } catch {
        _loadingHistory = false;
        localStorage.removeItem(key);
      }
    }
  }

  // ===== 我的成果（智能分类 + 预览 + 重新生成） =====
  let _previewFilePath = null;
  let _previewFileFolder = null;

  async function refreshReports() {
    const baseDir = window.hermes.reportsDir;
    const categories = [
      { folder: '业务报表', id: 'biz', empty: '对话中生成的报表、<br>数据分析等', icon: '📊', rePrompt: '帮我生成一份业务报表，分析' },
      { folder: '我的创作', id: 'creative', empty: '帮你写的文案、方案、<br>邮件等创作内容', icon: '✍️', rePrompt: '帮我写一份文档，主题是' },
      { folder: '我的工具', id: 'tools', empty: '帮你做的App、脚本、<br>自动化工具等', icon: '🔧', rePrompt: '帮我做一个工具，功能是' },
    ];

    const results = await Promise.all(categories.map(cat =>
      window.hermes.execute('fs:list', { dir: `${baseDir}/${cat.folder}`, meta: true }).catch(() => ({ files: [] }))
    ));

    let totalFiles = 0;
    let totalSize = 0;
    categories.forEach((cat, i) => {
      const res = results[i];
      let files = (res && res.files || []).filter(f => !f.isDirectory);
      // 按修改时间降序排列
      files.sort((a, b) => new Date(b.mtime || 0) - new Date(a.mtime || 0));
      totalFiles += files.length;
      files.forEach(f => { totalSize += f.size || 0; });

      const card = document.querySelector(`.result-card[data-folder="${cat.folder}"]`);
      const cntEl = document.getElementById(`cnt_${cat.id}`);
      const fileDiv = document.getElementById(`files_${cat.id}`);

      if (cntEl) cntEl.textContent = files.length;

      if (files.length === 0) {
        if (fileDiv) fileDiv.innerHTML = `<div class="result-empty">${cat.empty}</div>`;
      } else {
        // 时间分组
        const now = Date.now();
        const groups = [
          { label: '今天', max: now - (now % 86400000), files: [] },
          { label: '本周', max: now - (now % 86400000) - 86400000, files: [] },
          { label: '本月', max: now - (now % 86400000) - 7 * 86400000, files: [] },
          { label: '更早', max: 0, files: [] },
        ];
        files.forEach(f => {
          const mtime = new Date(f.mtime || 0).getTime();
          const todayStart = new Date().setHours(0, 0, 0, 0);
          const weekAgo = todayStart - 7 * 86400000;
          const monthAgo = todayStart - 30 * 86400000;
          if (mtime >= todayStart) groups[0].files.push(f);
          else if (mtime >= weekAgo) groups[1].files.push(f);
          else if (mtime >= monthAgo) groups[2].files.push(f);
          else groups[3].files.push(f);
        });

        let html = '';
        groups.forEach(g => {
          if (g.files.length === 0) return;
          html += `<div class="result-time-group">${g.label}</div>`;
          g.files.forEach(f => {
            const safeName = f.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeFolder = cat.folder.replace(/'/g, "\\'");
            const typeIcon = _fileTypeIcon(f.type);
            const sizeStr = f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + 'MB'
              : f.size > 1024 ? (f.size / 1024).toFixed(0) + 'KB' : f.size + 'B';
            const agoStr = _timeAgo(new Date(f.mtime || 0));
            html += `<div class="result-file-item" onclick="previewReportFile('${safeFolder}', '${safeName}')" title="${f.name} · ${sizeStr} · ${agoStr}">
              <span class="result-file-icon">${typeIcon}</span>
              <span class="rfi-name">${f.name}</span>
              <span class="rfi-meta">${sizeStr} · ${agoStr}</span>
            </div>`;
          });
        });
        if (fileDiv) fileDiv.innerHTML = html;
      }
    });

    // 更新头部统计
    const headerEl = document.querySelector('#pageReports .page-header');
    const existingStats = document.getElementById('reportsStats');
    if (existingStats) existingStats.remove();
    if (totalFiles > 0 && headerEl) {
      const sizeStr = totalSize > 1024 * 1024 ? (totalSize / 1024 / 1024).toFixed(1) + ' MB'
        : totalSize > 1024 ? (totalSize / 1024).toFixed(0) + ' KB' : totalSize + ' B';
      const statsEl = document.createElement('span');
      statsEl.id = 'reportsStats';
      statsEl.style.cssText = 'font-size:12px;color:var(--text-tertiary);font-weight:400;margin-left:auto;';
      statsEl.textContent = `${totalFiles} 个文件 · ${sizeStr}`;
      headerEl.appendChild(statsEl);
    }

    // 整体空状态
    const gridEl = document.getElementById('reportsGrid');
    if (totalFiles === 0 && gridEl) {
      gridEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg><div class="empty-state-title">还没有成果</div><div class="empty-state-desc">让 Hermes 帮你写文档、做报表、生成工具，<br>产出会自动保存在这里</div></div>';
    }
  }

  function _fileTypeIcon(type) {
    const map = {
      markdown: '📝', csv: '📊', excel: '📈', image: '🖼️', pdf: '📕',
      code: '💻', other: '📄'
    };
    return map[type] || '📄';
  }

  function _timeAgo(date) {
    const ms = Date.now() - date.getTime();
    if (ms < 60000) return '刚刚';
    if (ms < 3600000) return Math.floor(ms / 60000) + '分钟前';
    if (ms < 86400000) return Math.floor(ms / 3600000) + '小时前';
    if (ms < 2592000000) return Math.floor(ms / 86400000) + '天前';
    return date.toLocaleDateString('zh-CN');
  }

  async function previewReportFile(folder, fileName) {
    const fullPath = `${window.hermes.reportsDir}/${folder}/${fileName}`;
    _previewFilePath = fullPath;
    _previewFileFolder = folder;
    const overlay = document.getElementById('filePreviewOverlay');
    const titleEl = document.getElementById('fpTitle');
    const metaEl = document.getElementById('fpMeta');
    const contentEl = document.getElementById('fpContent');
    const openBtn = document.getElementById('fpOpenBtn');
    if (!overlay) return;

    showOverlay('filePreviewOverlay');
    if (titleEl) titleEl.textContent = fileName;
    if (metaEl) metaEl.textContent = `${folder} · 加载中...`;
    if (contentEl) contentEl.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';
    if (openBtn) openBtn.onclick = () => {
      window.hermes.execute('shell:open', { path: fullPath }).catch(() => {});
    };

    try {
      const resp = await window.hermes.execute('fs:read', { path: fullPath });
      const content = (resp && resp.content) || '';
      const ext = (fileName || '').toLowerCase().split('.').pop();
      const st = await window.hermes.execute('fs:list', { dir: `${window.hermes.reportsDir}/${folder}`, meta: true })
        .then(r => (r && r.files || []).find(f => f.name === fileName))
        .catch(() => null);
      const sizeStr = st && st.size
        ? (st.size > 1024 * 1024 ? (st.size / 1024 / 1024).toFixed(1) + ' MB' : st.size > 1024 ? (st.size / 1024).toFixed(0) + ' KB' : st.size + ' B')
        : '';
      const mtimeStr = st && st.mtime ? _timeAgo(new Date(st.mtime)) : '';
      if (metaEl) metaEl.textContent = `${folder}${sizeStr ? ' · ' + sizeStr : ''}${mtimeStr ? ' · ' + mtimeStr : ''}`;

      if (['md', 'markdown', 'txt'].includes(ext)) {
        contentEl.innerHTML = `<div class="fp-md">${renderMarkdown(content)}</div>`;
      } else if (ext === 'csv') {
        const lines = content.trim().split('\n').slice(0, 200);
        if (lines.length === 0) {
          contentEl.innerHTML = '<div class="result-empty">空文件</div>';
        } else {
          const headers = lines[0].split(',');
          const rows = lines.slice(1);
          contentEl.innerHTML = `<div class="fp-csv-wrap"><table class="fp-csv-table">
            <thead><tr>${headers.map(h => `<th>${escapeHtml(h.trim())}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${r.split(',').map(c => `<td>${escapeHtml(c.trim())}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>${lines.length >= 200 ? '<p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">仅显示前 200 行</p>' : ''}</div>`;
        }
      } else if (['xlsx', 'xls'].includes(ext)) {
        contentEl.innerHTML = '<div class="result-empty" style="padding:40px;">📊 Excel 文件暂不支持在线预览<br><small>请点击右上角"在 Finder 中打开"查看</small></div>';
      } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
        contentEl.innerHTML = `<img src="file://${fullPath}" style="max-width:100%;max-height:50vh;border-radius:8px;" onerror="this.parentElement.innerHTML='<div class=\\'result-empty\\'>图片加载失败</div>'" />`;
      } else {
        contentEl.innerHTML = `<pre class="fp-code">${escapeHtml(content.slice(0, 5000))}</pre>`;
      }
    } catch (e) {
      if (contentEl) contentEl.innerHTML = `<div class="result-empty">加载失败：${escapeHtml(e.message || '')}</div>`;
    }
  }

  function closeFilePreview() {
    hideOverlay('filePreviewOverlay');
    _previewFilePath = null;
    _previewFileFolder = null;
  }

  function regenerateReport() {
    const fileName = _previewFilePath ? _previewFilePath.split('/').pop().replace(/\.[^.]+$/, '') : '';
    const folder = _previewFileFolder || '';
    closeFilePreview();
    switchPage('pageHome');
    const input = document.getElementById('chatInput');
    if (input) {
      input.value = `帮我重新生成一份${folder ? '「' + folder + '」相关的' : ''}内容，类似之前的"${fileName || '这个文件'}"`;
      input.focus();
    }
  }

  function openReportInFolder() {
    if (_previewFilePath) {
      window.hermes.openFolder(_previewFilePath).catch(() => {});
    }
  }

  // 兼容旧接口
  async function openReportFile(relPath) {
    const fullPath = `${window.hermes.reportsDir}/${relPath}`;
    const parts = relPath.split('/');
    const folder = parts.length > 1 ? parts[0] : '';
    const fileName = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
    previewReportFile(folder, fileName);
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
          '<br><span style="color:var(--text-tertiary);font-size:11px;">（已停止生成）</span>' +
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

  // 监听更新通知
  if (window.hermes_on && window.hermes_on.updateStatus) {
    window.hermes_on.updateStatus((data) => {
      if (data.event === 'available') {
        showDialog('🔄', `发现新版本 v${data.version}，是否下载更新？`, true).then(ok => {
          if (ok) window.hermes.execute('update:install', {}).catch(() => {});
        });
      } else if (data.event === 'downloaded') {
        showDialog('✅', `v${data.version} 已下载，重启后生效`, true).then(ok => {
          if (ok) window.hermes.execute('update:quit-and-install', {}).catch(() => {});
        });
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

// ===== 模型配置 =====
let _currentModel = 'deepseek-v4-pro';
let _currentProvider = 'hergent';

const PRESET_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'qwen3-max', 'qwen3.6-flash', 'qwen3.7-max'];
const MODEL_LABELS = { 'deepseek-v4-pro': 'DeepSeek V4 Pro', 'deepseek-v4-flash': 'DeepSeek V4 Flash', 'qwen3-max': 'Qwen3 Max', 'qwen3.6-flash': 'Qwen3.6 Flash', 'qwen3.7-max': 'Qwen3.7 Max' };
const MODEL_PROVIDERS = { 'deepseek-v4-pro': 'hergent', 'deepseek-v4-flash': 'hergent', 'qwen3-max': 'bailian', 'qwen3.6-flash': 'bailian', 'qwen3.7-max': 'bailian' };

async function loadModelConfig() {
  try {
    const cfg = await window.hermes.getModelConfig();
    _currentModel = cfg.model || 'deepseek-v4-pro';
    _currentProvider = cfg.provider || 'hergent';
    updateModelIndicator(_currentModel);
    const setModel = document.getElementById('setModelName');
    if (setModel) setModel.textContent = MODEL_LABELS[_currentModel] || _currentModel;
    const isPreset = PRESET_MODELS.includes(_currentModel);
    document.querySelectorAll('.model-option').forEach(o => {
      o.classList.toggle('active', isPreset ? o.dataset.model === _currentModel : o.dataset.model === 'custom');
    });
    if (!isPreset && cfg.custom_providers && cfg.custom_providers.length > 0) {
      const cp = cfg.custom_providers[0];
      document.getElementById('customBaseUrl').value = cp.base_url || '';
      document.getElementById('customApiKey').value = cp.api_key || '';
      document.getElementById('customModelName').value = cp.model || _currentModel;
      document.getElementById('customModelForm').style.display = '';
    }
  } catch (_) { console.error("loadModelConfig failed"); }
}

function selectModel(model) {
  document.querySelectorAll('.model-option').forEach(o => o.classList.remove('active'));
  document.querySelector(`.model-option[data-model="${model}"]`)?.classList.add('active');
  const form = document.getElementById('customModelForm');
  const msg = document.getElementById('modelMsg');
  if (model === 'custom') {
    form.style.display = '';
  } else {
    form.style.display = 'none';
    msg.textContent = '';
    _saveModelPreset(model, MODEL_PROVIDERS[model] || 'hergent');
  }
}

async function _saveModelPreset(model, provider) {
  provider = provider || 'hergent';
  const msg = document.getElementById('modelMsg');
  const label = document.getElementById('miLabel');
  if (msg) { msg.textContent = '应用模型中...'; msg.style.color = 'var(--text-tertiary)'; }
  if (label) { label.textContent = '切换中...'; }
  try {
    const result = await window.hermes.setModelConfig({ model, provider });
    if (result.success) {
      _currentModel = model;
      updateModelIndicator(model);
      if (msg) { msg.textContent = '模型已切换，Gateway 重启中...'; }
      if (label) { label.textContent = '已生效 ✓'; }
      setTimeout(() => {
        if (msg) { msg.textContent = '模型已生效 ✓'; msg.style.color = '#22c55e'; }
        updateModelIndicator(model);
      }, 2000);
    } else {
      if (msg) { msg.textContent = '切换失败: ' + (result.error || '未知错误'); msg.style.color = '#ef4444'; }
      if (label) updateModelIndicator(model);
    }
  } catch (e) {
    if (msg) { msg.textContent = '切换失败: ' + (e.message || '网络错误'); msg.style.color = '#ef4444'; }
    if (label) updateModelIndicator(model);
  }
}

async function saveCustomModel() {
  const baseUrl = document.getElementById('customBaseUrl').value.trim();
  const apiKey = document.getElementById('customApiKey').value.trim();
  const modelName = document.getElementById('customModelName').value.trim() || 'deepseek-v4-pro';
  const msg = document.getElementById('modelMsg');
  if (!baseUrl) { msg.textContent = '请输入 API Base URL'; msg.style.color = '#ef4444'; return; }
  msg.textContent = '应用自定义模型中...';
  msg.style.color = 'var(--text-tertiary)';
  try {
    const result = await window.hermes.setModelConfig({
      model: modelName,
      provider: 'custom',
      custom_base_url: baseUrl,
      custom_api_key: apiKey,
    });
    if (result.success) {
      _currentModel = modelName;
      updateModelIndicator(modelName + ' (自定义)');
      msg.textContent = '自定义模型已生效 ✓';
      msg.style.color = '#22c55e';
    } else {
      msg.textContent = '保存失败: ' + (result.error || '未知错误');
      msg.style.color = '#ef4444';
    }
  } catch (e) {
    msg.textContent = '保存失败: ' + (e.message || '网络错误');
    msg.style.color = '#ef4444';
  }
}

// Phase 2: Register DOM event listeners
function _initDomEvents() {
  const ci = document.getElementById('codeInput');
  if (ci) ci.addEventListener('keydown', e => { if (e.key === 'Enter') verifySmsCode(); });
  initDragDrop();
  initCustomAvatars();
  initTheme();
  initSidebarResize();
}

// ===== 侧边栏拖拽调整宽度 =====
function initSidebarResize() {
  const sidebar = document.querySelector('.sidebar');
  const handle = document.getElementById('sidebarResizeHandle');
  if (!sidebar || !handle) return;

  const savedWidth = localStorage.getItem('hermes_sidebar_width');
  if (savedWidth) sidebar.style.width = savedWidth + 'px';

  let dragging = false, startX = 0, startWidth = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.max(160, Math.min(320, startWidth + e.clientX - startX));
    sidebar.style.width = w + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('hermes_sidebar_width', sidebar.offsetWidth);
  });
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
