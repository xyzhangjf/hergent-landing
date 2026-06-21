// Hergent Desktop — Overlay & Dialog Management
// Extracted from app.js Phase 2
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

