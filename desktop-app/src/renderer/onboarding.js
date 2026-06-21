/// <reference path="../types.d.ts" />
// @ts-check
// Hergent Desktop — Onboarding Guide
// Extracted from app.js Phase 2
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


