/**
 * Hergent Desktop — ERP Bot Integration (v85)
 * Routes ERP-related AI queries to the Web ERP /api/bot/chat instead of local Hermes engine.
 * Injects a subtle ERP connection indicator + settings into the existing chat flow.
 *
 * ERP intent keywords: 查库存, 查欠款, 开单, 报表, 客户, 商品, 对账, 收款, 付款,
 *   工资, 薪酬, 税务, 关账, 凭证, 合并, 实体
 */
(function(){
'use strict';

var ERP_CONFIG = {
  url: localStorage.getItem('hergent_erp_url') || 'https://erp.hergent.cn',
  token: localStorage.getItem('hergent_erp_token') || '',
  enabled: localStorage.getItem('hergent_erp_enabled') !== 'false',
  indicatorAdded: false
};

// ERP intent patterns — if message matches, route to ERP bot instead of local Hermes
var ERP_INTENT_PATTERNS = [
  /库存|存货|入库|出库|批次|过期|效期|FEFO|盘点|安全库存|低库存/,
  /欠款|应收|应付|收款|付款|核销|对账|冲账|账期|逾期|催收/,
  /开单|下订单|订货|给.*拿|拿.*箱|拿.*瓶|拿.*件|要.*箱|要.*瓶|给.*发|帮.*订|卖.*给|下单|创建.*订单|新建.*订单|销售单|采购单/,
  /客户|供应商|联系人|档案|档案管理|查.*信息/,
  /商品|产品|SKU|变体|规格|价格|售价|进价/,
  /报表|日报|周报|月报|经营|趋势|分析|排行|KPI|BI/,
  /利润|毛利|净利|费用|成本|亏损|盈亏/,
  /合同|返利|促销|价格审批|价目表/,
  /工资|薪酬|个税|社保|公积金|员工|考勤|打卡/,
  /税务|发票|电子发票|红冲|开票|报税|税率/,
  /关账|会计准则|合并报表|子公司|法人实体/,
];

function _isErpIntent(text) {
  if (!text) return false;
  return ERP_INTENT_PATTERNS.some(function(p) { return p.test(text); });
}

// ---- ERP Bot Chat ----
function _erpChat(text, role) {
  if (!ERP_CONFIG.token) {
    return Promise.reject(new Error("未配置ERP Token。请在设置中填入ERP连接信息。"));
  }

  return fetch(ERP_CONFIG.url + '/api/bot/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ERP_CONFIG.token
    },
    body: JSON.stringify({text: text, role: role || 'dami'})
  }).then(function(r) { return r.json(); });
}

// ---- ERP Bot Report ----
function _erpReport(type) {
  if (!ERP_CONFIG.token) return Promise.resolve({error: "未配置ERP Token"});
  return fetch(ERP_CONFIG.url + '/api/bot/report', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ERP_CONFIG.token},
    body: JSON.stringify({type: type || 'daily'})
  }).then(function(r) { return r.json(); });
}

// ---- ERP Config Dialog ----
function _showErpConfig() {
  var html = '<h3>ERP 连接设置</h3>' +
    '<div style="margin-bottom:12px;padding:8px 12px;background:var(--bg3);border-radius:6px;font-size:11px;color:var(--t2)">' +
    '连接后，AI 将可以查询真实的进销存数据、开单、生成报表。<br>' +
    'Token 获取方式：Web ERP → 设置 → API Token 管理</div>' +
    '<div class="modal-field"><label>ERP 服务器地址</label>' +
    '<input id="erpCfgUrl" value="' + (ERP_CONFIG.url||'') + '" style="padding:10px 14px;border:1px solid var(--bd);border-radius:6px;background:var(--bg3);color:var(--t1);font-size:13px;font-family:inherit;width:100%;box-sizing:border-box"></div>' +
    '<div class="modal-field"><label>API Token</label>' +
    '<input id="erpCfgToken" type="password" value="' + (ERP_CONFIG.token||'') + '" placeholder="从 Web ERP 设置中获取" style="padding:10px 14px;border:1px solid var(--bd);border-radius:6px;background:var(--bg3);color:var(--t1);font-size:13px;font-family:inherit;width:100%;box-sizing:border-box"></div>' +
    '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
    '<input type="checkbox" id="erpCfgEnabled" '+(ERP_CONFIG.enabled?'checked':'')+' style="accent-color:var(--p)">' +
    '<label for="erpCfgEnabled" style="font-size:12px;color:var(--t2);cursor:pointer">启用 ERP Bot 集成</label></div>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-primary" onclick="_erpSaveConfig()">保存</button>' +
    '<button class="btn btn-outline" onclick="_erpTestConnection()">测试连接</button>' +
    '<button class="btn btn-outline" data-close>取消</button></div>';
  if (typeof showModal === 'function') showModal(html);
  else if (typeof window.modalOpen === 'function') window.modalOpen(html);
  window._erpSaveConfig = function(){
    ERP_CONFIG.url = document.getElementById('erpCfgUrl').value.trim();
    ERP_CONFIG.token = document.getElementById('erpCfgToken').value.trim();
    ERP_CONFIG.enabled = document.getElementById('erpCfgEnabled').checked;
    localStorage.setItem('hergent_erp_url', ERP_CONFIG.url);
    localStorage.setItem('hergent_erp_token', ERP_CONFIG.token);
    localStorage.setItem('hergent_erp_enabled', ERP_CONFIG.enabled ? 'true' : 'false');
    _addErpIndicator();
    if (typeof toast === 'function') toast('ERP连接已保存');
    else if (typeof window.toast === 'function') window.toast('ERP连接已保存');
    if (typeof closeModal === 'function') closeModal();
    else if (typeof window.closeModal === 'function') window.closeModal();
  };
  window._erpTestConnection = function(){
    var url = document.getElementById('erpCfgUrl').value.trim();
    var token = document.getElementById('erpCfgToken').value.trim();
    if (!token) { alert('请先填入API Token'); return; }
    fetch(url + '/api/bot/status', {headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(d){
        if (d && d.success) alert('✅ 连接成功！ERP '+d.version+', '+d.tools_count+' 个工具可用');
        else alert('❌ 连接失败: ' + (d?d.error||JSON.stringify(d):'网络错误'));
      }).catch(function(e){ alert('❌ 连接失败: ' + e.message); });
  };
}

// ---- Add ERP indicator to chat header ----
function _addErpIndicator() {
  if (!ERP_CONFIG.enabled || !ERP_CONFIG.token) return;
  var chatHeader = document.querySelector('.chat-header, #chatHeader');
  if (!chatHeader) return setTimeout(_addErpIndicator, 1000);
  var existing = document.getElementById('erpIndicator');
  if (existing) existing.remove();

  var el = document.createElement('span');
  el.id = 'erpIndicator';
  el.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;margin-left:8px;border-radius:12px;font-size:10px;background:rgba(16,185,129,.12);color:var(--suc);border:1px solid rgba(16,185,129,.2)';
  el.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ERP已连接';
  el.onclick = _showErpConfig;
  el.title = '点击管理ERP连接';
  chatHeader.appendChild(el);
}

// ---- Hook into settings ----
function _hookSettings() {
  var settingsBtn = document.querySelector('[data-mod="settings"], #settingsBtn');
  var tryCount = 0;
  function tryHook() {
    if (tryCount++ > 20) return;
    var settingsPanel = document.querySelector('.settings-panel, #settingsPanel, #pgSettings');
    if (settingsPanel) {
      var existing = document.getElementById('erpSettingsEnt');
      if (existing) return;
      var btn = document.createElement('button');
      btn.id = 'erpSettingsEnt';
      btn.className = 'btn btn-outline btn-sm';
      btn.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 14px;margin-top:8px';
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.66V20a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg> ERP 连接';
      btn.onclick = _showErpConfig;
      settingsPanel.appendChild(btn);
    } else {
      setTimeout(tryHook, 500);
    }
  }
  setTimeout(tryHook, 1000);
}

// ---- Init ----
window.addEventListener('DOMContentLoaded', function() {
  if (ERP_CONFIG.enabled && ERP_CONFIG.token) {
    setTimeout(_addErpIndicator, 2000);
  }
  setTimeout(_hookSettings, 2000);

  // Monkey-patch AI send to intercept ERP intents
  var origSend = window.sendAI || window.sendMessage || window.sendChat;
  if (origSend) {
    var sendFn = origSend;
    window.sendMessage = function(text, role) {
      if (ERP_CONFIG.enabled && ERP_CONFIG.token && _isErpIntent(text)) {
        _erpChat(text, role).then(function(r) {
          if (r && r.reply) {
            if (typeof addMessage === 'function') addMessage('ai', r.reply, r);
            else if (typeof window.addChatMessage === 'function') window.addChatMessage('ai', r.reply);
          }
        }).catch(function(e) {
          // Fallback to local engine on error
          sendFn.call(window, text, role);
        });
      } else {
        sendFn.call(window, text, role);
      }
    };
  }

  // Expose globally
  window._erpConfig = _showErpConfig;
  window._erpChat = _erpChat;
  window._erpReport = _erpReport;
  window._isErpIntent = _isErpIntent;
});
})();
