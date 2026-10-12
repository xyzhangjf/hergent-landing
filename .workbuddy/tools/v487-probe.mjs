/**
 * v487 真机 DOM 探针（只读）：把一条合成会话写进 localStorage（hergent_chat_sessions_v1），
 * 打开副驾抽屉 → 历史 → 点开该会话，验证真实渲染后的 DOM：
 *   P2-③ 表格→图表：出现「看图表」按钮；点击后图表显示、表格隐藏。
 *   P2-⑦ 内联控件：滑块 input.md-control-range（value=50）+ 开关 button.md-switch.on 渲染出来。
 *   P2-⑨ 产物元数据：卡片产物出现 .cp-art-meta，含相对时间 + 「来自于「…」」来源。
 *   P0 未跳登录页 + P5 全程零 console.error。
 *
 * 用法：
 *   BASE=http://127.0.0.1:8099 node v487-probe.mjs        # 本地静态产物
 *   HG_TOKEN=xxx node v487-probe.mjs                       # 默认打生产 hergent.cn
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.V487_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || 'local-dummy-token'
const TENANT = process.env.HG_TENANT || '1'

// —— 合成会话：一张表（触发图表）+ 两个控件 + 一张带 created_at 的卡片 ——
const SID = '__v487_probe__'
const now = Date.now()
const session = [{
  id: SID,
  title: '__v487_probe__',
  roleId: '',
  updated_at: now,
  messages: [
    { role: 'user', content: '分析一下本月货损情况' },
    { role: 'assistant', content:
      '这是一张表：\n\n' +
      '| 月份 | 销量 | 退货 |\n| --- | --- | --- |\n| 1月 | 120 | 5 |\n| 2月 | 135 | 8 |\n| 3月 | 110 | 3 |\n\n' +
      '调一下参数：[[control: slider|温度|0|100|1|50]] 与 [[control: switch|自动续费|on]]。' },
    { role: 'assistant', content: '货损卡片如下：',
      card: { type: 'kpi', title: '本月货损率', summary: '1.2%',
        metrics: [{ label: '环比', value: '-0.3pp', tone: 'good' }] },
      created_at: now - 60000 }
  ]
}]

const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

const IS_LOCAL = /127\.0\.0\.1|localhost/.test(BASE)
const browser = await launch({ extraArgs: IS_LOCAL ? ['--no-proxy-server'] : [] })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(`
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_chat_sessions_v1', ${JSON.stringify(JSON.stringify(session))});
  `)

  await page.goto(BASE + '/?cb=' + Date.now() + '#/workbench', 9000)
  // 等抽屉相关脚本就绪
  await new Promise(r => setTimeout(r, 1500))

  const url1 = await page.eval('location.href')
  ok('P0 未跳登录页', !/#\/login/.test(url1), url1)

  // 打开副驾抽屉（顶部栏 .tb-copilot 入口，图标按钮无文字）
  const opened = await page.eval(`(() => {
    const b = document.querySelector('.tb-copilot');
    if (b) { b.click(); return true; }
    return false;
  })()`)
  ok('P1 副驾入口可点击', opened)
  await new Promise(r => setTimeout(r, 800))

  // 打开历史会话（抽屉内 title="历史会话" 的图标按钮）
  const hist = await page.eval(`(() => {
    const b = [...document.querySelectorAll('.cp-icon-btn')].find(x => /历史/.test(x.getAttribute('title') || x.innerText || ''));
    if (b) { b.click(); return true; }
    return false;
  })()`)
  ok('P1′ 历史按钮可点击', hist)
  await new Promise(r => setTimeout(r, 600))

  // 点开注入的会话
  const clicked = await page.eval(`(() => {
    const items = [...document.querySelectorAll('.cp-hist-item, .cp-hist-hit')];
    const it = items.find(x => (x.innerText || '').includes('__v487_probe__'));
    if (it) { it.click(); return true; }
    return false;
  })()`)
  ok('P2 注入会话出现在历史并可点开', clicked)
  await new Promise(r => setTimeout(r, 900))

  // —— ③ 图表切换 ——
  const hasToggle = await page.eval(`!!document.querySelector('.md-table-chart-toggle')`)
  ok('③ 表格渲染出「看图表」按钮', hasToggle)
  if (hasToggle) {
    await page.eval(`document.querySelector('.md-table-chart-toggle').click()`)
    await new Promise(r => setTimeout(r, 300))
    const after = await page.eval(`(() => {
      const t = document.querySelector('.md-table-chart-toggle');
      const chart = document.querySelector('.md-table-chart');
      const table = document.querySelector('.md-table');
      return JSON.stringify({
        toggleText: t ? t.textContent : '',
        chartShown: chart ? !chart.hasAttribute('hidden') : false,
        tableHidden: table ? table.style.display === 'none' : false
      })
    })()`)
    const a = JSON.parse(after || '{}')
    ok('③ 点击后图表显示 + 表格隐藏', a.chartShown && a.tableHidden, JSON.stringify(a))
  }

  // —— ⑦ 内联控件 ——
  const ctrl = await page.eval(`JSON.stringify({
    slider: !!document.querySelector('.md-control-range'),
    sliderVal: (document.querySelector('.md-control-range')||{}).value,
    switchOn: !!document.querySelector('.md-switch.on'),
    switchAria: (document.querySelector('.md-switch')||{}).getAttribute && document.querySelector('.md-switch').getAttribute('aria-checked')
  })`)
  const c = JSON.parse(ctrl || '{}')
  ok('⑦ 滑块渲染（value=50）', c.slider && c.sliderVal === '50', JSON.stringify(c))
  ok('⑦ 开关渲染为 on 态', c.switchOn && c.switchAria === 'true', JSON.stringify(c))

  // —— ⑨ 产物元数据 ——
  const meta = await page.eval(`(() => {
    const m = document.querySelector('.cp-art-meta');
    return m ? m.innerText : '';
  })()`)
  ok('⑨ 卡片产物含元数据行', /来自于「|刚刚|分钟前|月.+日/.test(meta || ''), meta)

  // —— P5 零 console 错误 ——
  const errs = (page.errors || []).filter(e => !/401|403|Failed to load resource/.test(e))
  ok('P5 全程零 console.error / 零页面异常', errs.length === 0, JSON.stringify(errs).slice(0, 240))
} catch (e) {
  ok('探针执行未抛异常', false, e.message)
} finally {
  console.log('\n===== v487 真机 DOM 探针结果 =====')
  let n = 0
  for (const r of R) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
    n += r.pass ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  await browser.close()
}
