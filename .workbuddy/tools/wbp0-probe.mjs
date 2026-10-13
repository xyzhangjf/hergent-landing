/**
 * wbp0-probe.mjs —— 生产真机验证「经营工作台 v497 P0 七区重组」
 *
 * 验证点（真实生产数据，不桩）：
 *  ① A 定位栏：问候 + 日期 + 今日状态一句话
 *  ② B 区：KPI 条（老板）或降级说明条（员工）—— demo 为 boss，应见 KPI 条
 *  ③ C 今日要务：合并后面板存在、行 ≥1、行内有动作
 *  ④ D 近效期：卡在（表格或空态，栅格不塌）
 *  ⑤ G AI 洞察：三 tab 可切换，默认「今日研判」
 *  ⑥ 徽标收敛：.bento 内 badge-blue ≤ 2
 *  ⑦ 回归：天气按钮仍在（Shell 重建后无回归）；page.errors 为空
 */
import { launch } from './lib/cdp-lite.mjs'

const ORIGIN = 'https://hergent.cn'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function getToken() {
  const r = await fetch(ORIGIN + '/api/auth/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const j = await r.json()
  if (!j.token) throw new Error('demo-login 未返回 token：' + JSON.stringify(j))
  return j.token
}

const token = await getToken()
console.log('[probe] token 取得：' + token.slice(0, 8) + '…')

const initScript = `
(function () {
  try { localStorage.setItem('hergent_v2_token', ${JSON.stringify(token)}); } catch (e) {}
})();
`

const browser = await launch({ chromePath: CHROME, headless: true, extraArgs: [] })
try {
  const page = await browser.newPage()
  await page.enable()
  const sid = await page.addInitScript(initScript)
  await page.goto(ORIGIN + '/', 6000)

  // 等工作台挂载（A 定位栏出现）
  const hasHead = await page.eval(`(async () => {
    for (let i = 0; i < 48; i++) {
      if (document.querySelector('.wb-head')) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  })()`)
  if (!hasHead) throw new Error('未找到 .wb-head（工作台未挂载或被重定向）')

  const r1 = await page.eval(`(async () => {
    await new Promise(r => setTimeout(r, 800));
    const q = (s) => document.querySelector(s)
    const qa = (s) => [...document.querySelectorAll(s)]
    const bento = q('.bento')
    const isEmptyTenant = !!q('.import-guide')
    return {
      hash: location.hash,
      isEmptyTenant,
      headText: (q('.wb-head')?.textContent || '').replace(/\\s+/g, ' ').trim(),
      hi: (q('.wb-hi')?.textContent || '').trim(),
      date: (q('.wb-date')?.textContent || '').trim(),
      status: (q('.wb-status')?.textContent || '').trim(),
      hasKpiStrip: !!q('.kpi-strip'),
      hasKpiDenied: !!q('.kpi-denied'),
      kpiCount: qa('.kpi-strip .kpi').length,
      hasTasks: !!q('.wb-tasks'),
      taskCount: qa('.wb-tasks .task-row').length,
      firstTaskTitle: (q('.wb-tasks .task-title')?.textContent || '').trim(),
      firstTaskHasAction: !!q('.wb-tasks .task-acts'),
      hasExpiry: !!q('.expiry-card'),
      expiryEmptyState: !!q('.expiry-card .state-empty'),
      expiryRows: qa('.expiry-card .tbl tbody tr').length,
      hasAiInsight: !!q('.ai-insight'),
      aiTabs: qa('.ai-insight .ai-tab').map(b => b.textContent.trim()),
      judgeTabActive: !!q('.ai-insight .ai-tab.active'),
      badgeBlueInBento: qa('.bento .badge-blue').length,
      hasWxBtn: !!q('.wx-now'),
    };
  })()`)
  console.log('[probe] 定位栏   :', JSON.stringify(r1.headText))
  console.log('[probe] 问候/日期:', JSON.stringify(r1.hi), '/', JSON.stringify(r1.date))
  console.log('[probe] 状态串   :', JSON.stringify(r1.status))
  console.log('[probe] 空账套态 :', r1.isEmptyTenant)
  console.log('[probe] KPI 条   :', r1.hasKpiStrip, '· KPI 数:', r1.kpiCount, '· 降级条:', r1.hasKpiDenied)
  console.log('[probe] 今日要务 :', r1.hasTasks, '· 行数:', r1.taskCount, '· 首行:', JSON.stringify(r1.firstTaskTitle), '· 有动作:', r1.firstTaskHasAction)
  console.log('[probe] 效期卡   :', r1.hasExpiry, '· 空态:', r1.expiryEmptyState, '· 表格行:', r1.expiryRows)
  console.log('[probe] AI 洞察  :', r1.hasAiInsight, '· tabs:', JSON.stringify(r1.aiTabs), '· 默认激活:', r1.judgeTabActive)
  console.log('[probe] bento 蓝徽标数:', r1.badgeBlueInBento, '(期望 ≤2)')
  console.log('[probe] 天气按钮回归:', r1.hasWxBtn)

  // tab 切换验证：晨报 → 经验闭环 → 研判
  const r2 = await page.eval(`(async () => {
    const tabs = [...document.querySelectorAll('.ai-insight .ai-tab')];
    if (tabs.length < 3) return { skipped: true };
    const clickTab = (idx) => tabs[idx].click();
    const paneInfo = () => {
      const pane = document.querySelector('.ai-insight .ai-pane');
      return (pane?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    };
    clickTab(2); await new Promise(r => setTimeout(r, 300));
    const reportActive = tabs[2].classList.contains('active');
    const reportPane = paneInfo();
    clickTab(1); await new Promise(r => setTimeout(r, 300));
    const loopActive = tabs[1].classList.contains('active');
    const loopPane = paneInfo();
    clickTab(0); await new Promise(r => setTimeout(r, 300));
    const judgeActive = tabs[0].classList.contains('active');
    return { reportActive, reportPane, loopActive, loopPane, judgeActive };
  })()`)
  console.log('[probe] tab 切换 :', JSON.stringify(r2))

  const shot1 = new URL('./wbp0-shot-judge.png', import.meta.url).pathname
  await page.screenshot(shot1)

  // 滚到 AI 洞察区截图（若存在）
  const r3 = await page.eval(`(async () => {
    const el = document.querySelector('.ai-insight');
    if (el) el.scrollIntoView({ block: 'start' });
    await new Promise(r => setTimeout(r, 400));
    return !!el;
  })()`)
  if (r3) {
    const shot2 = new URL('./wbp0-shot-ai.png', import.meta.url).pathname
    await page.screenshot(shot2)
    console.log('[probe] 截图2    :', shot2)
  }

  await page.removeInitScript(sid)
  console.log('[probe] 截图1    :', shot1)
  console.log('[probe] 控制台错误:', page.errors.length ? JSON.stringify(page.errors) : '无')

  // 综合判定
  const pass =
    r1.hi.length > 0 &&
    r1.date.length > 0 &&
    (r1.isEmptyTenant || (r1.hasKpiStrip && r1.hasTasks && r1.taskCount >= 1 && r1.hasExpiry && r1.hasAiInsight && r1.aiTabs.length === 3 && r1.judgeTabActive)) &&
    r1.badgeBlueInBento <= 2 &&
    r1.hasWxBtn &&
    (!r2.skipped ? (r2.reportActive && r2.loopActive && r2.judgeActive) : true) &&
    page.errors.length === 0

  console.log('\n[probe] ===== 结论: ' + (pass ? '✅ 全部通过' : '❌ 存在未达标项') + ' =====')
  process.exitCode = pass ? 0 : 1
} finally {
  await browser.close()
}
