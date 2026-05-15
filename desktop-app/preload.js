const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// 头像目录：App/Contents/Resources/avatars/（asar 外一层）
const AVATARS_PATH = path.resolve(__dirname, '..', 'avatars');

// 成果输出目录
const REPORTS_DIR = path.join(require('os').homedir(), 'Documents', 'Hergent', '成果');

// SERVER_URL — 从 main process 传入（通过 process.env 或默认 localhost）
const SERVER_URL = process.env.HERMES_SERVER_URL || 'http://localhost:8765';

contextBridge.exposeInMainWorld('hermes', {
  execute: (action, args) => ipcRenderer.invoke('hermes:execute', { action, args }),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  drag: (deltaX, deltaY) => ipcRenderer.send('window:drag', { deltaX, deltaY }),

  // 文件选择（系统对话框）
  selectFile: (opts) => ipcRenderer.invoke('file:select', opts),

  // 头像上传 — 存到 Resources/avatars/，不依赖 localStorage
  avatarsPath: AVATARS_PATH,
  reportsDir: REPORTS_DIR,
  uploadAvatar: (role) => ipcRenderer.invoke('avatar:upload', role),
  getCustomAvatar: (role) => ipcRenderer.invoke('avatar:get', role),
  removeAvatar: (role) => ipcRenderer.invoke('avatar:remove', role),

  // 定时任务
  cronList: () => ipcRenderer.invoke('cron:list'),
  cronCreate: (opts) => ipcRenderer.invoke('cron:create', opts),
  cronRemove: (id) => ipcRenderer.invoke('cron:remove', id),
  cronPause: (id) => ipcRenderer.invoke('cron:pause', id),
  cronResume: (id) => ipcRenderer.invoke('cron:resume', id),
  cronRun: (id) => ipcRenderer.invoke('cron:run', id),

  // 连接手机（Bot模式：保存 { channel, data: {app_id, app_secret} }）
  getChannels: () => ipcRenderer.invoke('channels:get'),
  saveChannel: (channel, role, data) => ipcRenderer.invoke('channels:save', channel, role, data),
  removeChannel: (channel, role) => ipcRenderer.invoke('channels:remove', channel, role),
  approvePairing: (channel, role, code) => ipcRenderer.invoke('channels:pairing-approve', channel, role, code),

  testChannel: (channel) => ipcRenderer.invoke('channels:test', { channel }),
  gatewayStatus: () => ipcRenderer.invoke('channels:gateway-status'),
  gatewayRestart: () => ipcRenderer.invoke('channels:gateway-restart'),

  // 在 Finder 中打开文件所在文件夹
  openFolder: (path) => ipcRenderer.invoke('shell:openFolder', path),

  // 积分查询
  getCredits: () => ipcRenderer.invoke('activation:credits'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),

  // 右键菜单
  showContextMenu: () => ipcRenderer.send('show-context-menu'),

  // 对话导出
  exportChat: (opts) => ipcRenderer.invoke('chat:export', opts),

  // 桌面通知
  notify: (title, body) => ipcRenderer.invoke('notify:send', { title, body }),

  // Hermes CLI 引导安装
  checkCli: () => ipcRenderer.invoke('hermes:check-cli'),
  bootstrapHermes: () => ipcRenderer.invoke('hermes:bootstrap'),
  onBootProgress: (callback) => {
    ipcRenderer.on('hermes:boot-progress', (event, msg) => callback(msg));
  },

  // 取消流式生成
  cancelStream: () => ipcRenderer.invoke('hermes:cancel'),

  // 主题管理
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  // 记忆系统
  listMemories: () => ipcRenderer.invoke('memory:list'),
  deleteMemory: (id) => ipcRenderer.invoke('memory:delete', id),

  // 动态角色管理
  rolesList: () => ipcRenderer.invoke('roles:list'),
  rolesSave: (roles) => ipcRenderer.invoke('roles:save', roles),
  rolesAdd: (roleData) => ipcRenderer.invoke('roles:add', roleData),
  rolesDelete: (roleId) => ipcRenderer.invoke('roles:delete', roleId),
  rolesUpdate: (roleId, updates) => ipcRenderer.invoke('roles:update', roleId, updates),

  // 服务端地址
  getServerUrl: () => ipcRenderer.invoke('server:get-url'),
  saveServerUrl: (url) => ipcRenderer.invoke('server:save-url', url),

  // 认证登录
  serverUrl: SERVER_URL,
  authMe: (token) => ipcRenderer.invoke('auth:me', token),
  authSendCode: (phone) => ipcRenderer.invoke('auth:send-code', phone),
  authVerifyCode: (phone, code) => ipcRenderer.invoke('auth:verify-code', phone, code),
  authWechatUrl: () => ipcRenderer.invoke('auth:wechat-url'),
  authLogout: (token) => ipcRenderer.invoke('auth:logout', token),

  // 清除角色活跃会话（新建对话时调用）
  sessionClear: (role) => ipcRenderer.invoke('session:clear', role),
});


// 接收后端推送的结果
contextBridge.exposeInMainWorld('hermes_on', {
  result: (callback) => ipcRenderer.on('hermes:result', (event, data) => callback(data)),
  stream: (callback) => ipcRenderer.on('hermes:stream', (event, data) => callback(data)),
  themeChanged: (callback) => ipcRenderer.on('theme:changed', (event, isDark) => callback(isDark)),
  gatewayMessage: (callback) => ipcRenderer.on('hermes:gateway-message', (event, data) => callback(data))
});
