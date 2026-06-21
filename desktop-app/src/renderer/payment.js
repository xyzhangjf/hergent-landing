// Hergent Desktop — Payment & Recharge
// Extracted from app.js Phase 2
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
var _selectedRechargeAmount = 10;
var _currentPaymentOrderId = '';
var _currentPaymentUrl = '';
var _paymentPollTimer = null;

var RECHARGE_TIERS = {
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
  // Reset to Step 1
  document.getElementById('rechargeStep1').style.display = '';
  document.getElementById('rechargeStep2').style.display = 'none';
  document.getElementById('rechargeTitle').textContent = '充值积分';
  document.getElementById('rechargeSubtitle').style.display = '';
  document.getElementById('rechargePrice').textContent = '10';
  document.getElementById('rechargeCredits').textContent = tier.label;
  document.getElementById('rechargeError').textContent = '';
  document.querySelectorAll('.recharge-tier').forEach(function(t) { t.classList.remove('selected'); });
  var tier10 = document.querySelector('.recharge-tier[data-amount="10"]');
  if (tier10) tier10.classList.add('selected');
  _updateTierHint(10);
  // Reset QR
  _stopPaymentPoll();
  document.getElementById('qrImage').src = '';
  document.getElementById('qrStatus').style.display = '';
  document.getElementById('qrSuccess').style.display = 'none';
  document.getElementById('qrOpenBrowserBtn').style.display = 'none';
  document.getElementById('rechargeUsageSection').style.display = 'none';
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
  document.querySelectorAll('.recharge-tier').forEach(function(t) { t.classList.remove('selected'); });
  var el = document.querySelector('.recharge-tier[data-amount="' + amount + '"]');
  if (el) el.classList.add('selected');
  const tier = RECHARGE_TIERS[amount];
  document.getElementById('rechargeCredits').textContent = tier.label;
  document.getElementById('rechargePrice').textContent = amount;
  document.getElementById('rechargeError').textContent = '';
  _updateTierHint(amount);
}

// 自定义金额（测试用，1-999元，1元=100分）
function selectCustomAmount(val) {
  var n = parseInt(val);
  if (n >= 1 && n <= 999) {
    _selectedRechargeAmount = n;
    document.querySelectorAll('.recharge-tier').forEach(function(t) { t.classList.remove('selected'); });
    document.getElementById('rechargePrice').textContent = n;
    document.getElementById('rechargeCredits').textContent = (n * 100).toLocaleString();
    document.getElementById('rechargeError').textContent = '';
  }
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
  _stopPaymentPoll();
  hideOverlay('rechargeOverlay');
  refreshCredits();
}

// ===== 支付工具方法 =====
function _stopPaymentPoll() {
  if (_paymentPollTimer) { clearInterval(_paymentPollTimer); _paymentPollTimer = null; }
}

// ===== 创建支付订单 → 打开浏览器 =====
async function submitRecharge(method) {
  var amount = _selectedRechargeAmount;
  var tier = RECHARGE_TIERS[amount];
  var credits = tier ? tier.credits : amount * 100;
  var label = tier ? tier.label : (amount * 100).toLocaleString();

  // 微信支付暂未开通
  if (method === 'wechat') {
    showDialog('微信支付即将上线', '微信支付正在接入中，请先用支付宝支付');
    return;
  }

  var errEl = document.getElementById('rechargeError');
  errEl.textContent = '';

  // 禁用支付按钮，显示加载状态
  var aliBtn = document.querySelector('.rpm-alipay');
  if (aliBtn) { aliBtn.disabled = true; aliBtn.style.opacity = '0.5'; }

  try {
    var result = await hermes.createPayment(amount);
    if (result && result.success && result.pay_url) {
      _currentPaymentOrderId = result.order_id;
      _currentPaymentUrl = result.pay_url;

      // DEV 模式：直接加积分
      if (result.dev_mode) {
        document.getElementById('rechargeStep1').style.display = '';
        document.getElementById('rechargeStep2').style.display = 'none';
        document.getElementById('rechargeError').textContent = '';
        if (aliBtn) { aliBtn.disabled = false; aliBtn.style.opacity = ''; }
        // DEV 模式一键到账
        try {
          var devResult = await hermes.devPay(_currentPaymentOrderId, '', amount);
          if (devResult.success || devResult.duplicate) {
            document.getElementById('rechargeSuccess').style.display = '';
            document.getElementById('rechargeSuccessDetail').textContent = '到账 ' + label + ' 积分';
            updateCreditsBadge();
            setTimeout(function() { closeRecharge(); }, 2000);
          }
        } catch(_) {}
        return;
      }

      // 正式支付：直接打开浏览器跳转支付宝付款页
      window.hermes.openExternal(result.pay_url);

      // 简化等待界面
      document.getElementById('rechargeStep1').style.display = 'none';
      document.getElementById('rechargeStep2').style.display = '';
      document.getElementById('rechargeTitle').textContent = '等待支付';
      document.getElementById('rechargeSubtitle').style.display = 'none';
      document.getElementById('qrAmount').textContent = amount;
      document.getElementById('qrCredits').textContent = label;
      document.getElementById('qrImage').style.display = 'none';
      document.getElementById('qrStatus').style.display = '';
      document.getElementById('qrSuccess').style.display = 'none';
      document.getElementById('qrOpenBrowserBtn').style.display = 'none';
      document.getElementById('qrTipText').textContent = '已打开支付宝付款页，请用手机扫码完成支付';

      // Start polling payment status
      _startPaymentPoll();
    } else {
      errEl.textContent = result.error || '创建支付订单失败，请稍后重试';
      if (aliBtn) { aliBtn.disabled = false; aliBtn.style.opacity = ''; }
    }
  } catch (e) {
    errEl.textContent = '网络错误，请检查连接后重试';
    if (aliBtn) { aliBtn.disabled = false; aliBtn.style.opacity = ''; }
  }
}

// ===== 支付状态轮询 =====
function _startPaymentPoll() {
  _stopPaymentPoll();
  var count = 0;
  var maxCount = 150; // 5 minutes at 2s interval

  _paymentPollTimer = setInterval(async function() {
    count++;
    if (count >= maxCount) {
      _stopPaymentPoll();
      document.getElementById('qrStatus').innerHTML = '<span style="color:var(--text-tertiary);">支付超时，请重新下单</span>';
      return;
    }

    try {
      var status = await hermes.checkPayment(_currentPaymentOrderId);
      if (status.paid) {
        _stopPaymentPoll();
        document.getElementById('qrStatus').style.display = 'none';
        document.getElementById('qrSuccess').style.display = '';
        document.getElementById('qrSuccessText').textContent =
          '充值成功！到账 ' + status.credits_added + ' 积分';
        updateCreditsBadge();
        setTimeout(function() { closeRecharge(); }, 2000);
      }
    } catch (_) { /* continue polling */ }
  }, 2000);
}

// ===== 取消支付 =====
function cancelPayment() {
  _stopPaymentPoll();
  document.getElementById('rechargeStep1').style.display = '';
  document.getElementById('rechargeStep2').style.display = 'none';
  document.getElementById('rechargeTitle').textContent = '充值积分';
  document.getElementById('rechargeSubtitle').style.display = '';
  var aliBtn = document.querySelector('.rpm-alipay');
  if (aliBtn) { aliBtn.disabled = false; aliBtn.style.opacity = ''; }
}

// ===== 浏览器支付 / DEV一键充值 =====
async function openPaymentInBrowser() {
  var btn = document.getElementById('qrOpenBrowserBtn');
  btn.disabled = true;

  // Check if already paid
  try {
    var s = await hermes.checkPayment(_currentPaymentOrderId);
    if (s.paid) return;
  } catch (_) {}

  if (_currentPaymentUrl.indexOf('dev-pay') !== -1) {
    btn.textContent = '充值中...';
    try {
      var amount = _selectedRechargeAmount;
      var result = await hermes.devPay(_currentPaymentOrderId, (authState && authState.user && authState.user.id) || '', amount);
      if (result.success) {
        _stopPaymentPoll();
        document.getElementById('qrStatus').style.display = 'none';
        document.getElementById('qrSuccess').style.display = '';
        var tierCredits = RECHARGE_TIERS[amount] ? RECHARGE_TIERS[amount].label : (amount * 100).toLocaleString();
        document.getElementById('qrSuccessText').textContent =
          '充值成功！到账 ' + tierCredits + ' 积分';
        updateCreditsBadge();
        setTimeout(function() { closeRecharge(); }, 2000);
      }
    } catch (_) {}
    btn.disabled = false;
    btn.textContent = '一键充值（测试）';
  } else {
    // Open Mianbaoduo pay URL in browser
    window.hermes.openExternal(_currentPaymentUrl);
    btn.disabled = false;
  }
}

// ===== 刷新二维码 =====
function refreshQR() {
  showRecharge();
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


