// Hergent Desktop — Utility Functions
// Extracted from app.js Phase 2
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

