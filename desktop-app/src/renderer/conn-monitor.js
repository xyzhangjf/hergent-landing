/// <reference path="../types.d.ts" />
// @ts-check
// Hergent Desktop — Connection Monitor
// Extracted from app.js Phase 2
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
  setInterval(updateCreditsBadge, 300000); // 每5分钟刷新积分
}

