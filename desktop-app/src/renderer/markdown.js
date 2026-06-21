// Hergent Desktop — Markdown Renderer
// Extracted from app.js Phase 2
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
    // 飞书消息处理完后刷新积分显示
    updateCreditsBadge();
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


