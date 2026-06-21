// Hergent Desktop — Global Keyboard Shortcuts
// Extracted from app.js Phase 2
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
    if (top === 'activationOverlay') { return; }
    if (top === 'modalOverlay') { hideAddTask(); return; }
    if (top === 'rechargeOverlay') { closeRecharge(); return; }
    if (top === 'memoryEditorOverlay') { closeMemoryEditor(); return; }
    if (top === 'pipelineConfigOverlay') { closePipelineConfig(); return; }
    if (top === 'filePreviewOverlay') { closeFilePreview(); return; }
    if (_streamActive) { cancelStream(); return; }
  }
});

// 窗口不在前台时发送系统通知


// 初始化：检查本地 token（DEV 模式跳过登录）

