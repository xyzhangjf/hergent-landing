/// <reference path="../types.d.ts" />
// @ts-check
// Hergent Desktop — Activation Code
// Extracted from app.js Phase 2
// ===== 激活码 =====
function showActivationOverlay() {
  showOverlay('activationOverlay');
  document.getElementById('activationError').textContent = '';
  document.getElementById('activationInfo').style.display = 'none';
  document.getElementById('activationBtn').disabled = false;
  document.getElementById('activationCodeInput').value = '';
}

window.activateDevice = async function() {
  var input = document.getElementById('activationCodeInput');
  var btn = document.getElementById('activationBtn');
  var err = document.getElementById('activationError');
  var code = input.value.trim().toUpperCase();
  if (!code) { err.textContent = '请输入激活码'; return; }
  btn.disabled = true; btn.textContent = '验证中...'; err.textContent = '';
  try {
    var result = await hermes.activate(code);
    if (result.ok) {
      err.textContent = '';
      btn.textContent = '激活成功！';
      // 关闭激活窗口 + 进入主界面
      hideOverlay('activationOverlay');
      localStorage.setItem('hermes_activated', code);
      localStorage.setItem('hermes_activation_tier', result.tier || '内测用户');
      // 激活成功后重新走 initAuth
      setTimeout(function() { initAuth(); }, 800);
    } else {
      err.textContent = result.message || '激活失败';
      btn.disabled = false; btn.textContent = '激活并开始使用';
    }
  } catch (e) {
    err.textContent = '网络错误，请检查连接后重试';
    btn.disabled = false; btn.textContent = '激活并开始使用';
  }
};


