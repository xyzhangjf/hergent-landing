#!/usr/bin/env node
/**
 * 副驾「新对话」入口契约（v663）
 *
 * 为什么需要这条护栏：
 *   用户 2026-10-24 报「AI副驾新对话按键藏在历史会话里，当时已经修复了，但现在又回退了」。
 *   查实：那版修复只存在于 2026-10-21 的**生产构建产物**里（Shell-BLfJ9bAV.js），
 *   **从未进 git**。于是任何人从源码重新构建并整份同步 dist/assets，就把它覆盖掉 ——
 *   这就是"修过又回退"的机制，不是谁手滑删了代码。
 *
 * 因此本契约只查**源码结构**（不看样式、不跑浏览器）：
 *   ① `.cp-new-btn` 有且只有一个，且带 `@click="newSession"`
 *   ② 它**不在**历史会话面板区块内（判据：位于 `v-if="showHistory"` 与
 *      `v-show="!showHistory` 之间 ⇒ 判定"藏在历史里"⇒ FAIL）
 *   ③ 快捷键链路完整：store 有 `copilotNewTick`、Shell 有 ⌘/Ctrl+Shift+O 分支、
 *      CopilotDrawer 用 `consumeNewTick()` 消费它
 *
 * 用法：node tests/copilot-newchat.contract.mjs
 * 退出码：0 全过 / 1 有失败
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DRAWER = 'src/components/CopilotDrawer.vue'
const SHELL = 'src/components/Shell.vue'
const STORE = 'src/store/index.js'

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const fails = []
const lines = []
const ok = (cond, name, extra) => {
  lines.push(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`)
  if (!cond) fails.push(name)
}

const drawer = read(DRAWER)

/* ① 按钮存在且恰好一个、绑 newSession */
const btnCount = (drawer.match(/class="cp-new-btn"/g) || []).length
ok(btnCount === 1, '标题栏「新对话」按钮存在且唯一', `count=${btnCount}`)
const btnAt = drawer.indexOf('class="cp-new-btn"')
if (btnAt >= 0) {
  const around = drawer.slice(btnAt, btnAt + 400)
  ok(/@click="newSession"/.test(around), '按钮绑定 @click="newSession"')
  ok(/新对话/.test(around), '按钮可见文案含「新对话」（窄屏收起，靠 title 提示）')
}

/* ② 不许落在历史会话面板区块内
   区块边界用两个结构性锚点：`v-if="showHistory"`（历史面板开标签）
   与 `v-show="!showHistory`（双栏容器开标签，紧跟历史面板之后）。 */
const histStart = drawer.indexOf('v-if="showHistory"')
const splitStart = drawer.indexOf('v-show="!showHistory')
if (histStart < 0 || splitStart < 0) {
  ok(false, '历史面板/双栏锚点可定位（否则本条无法判定，需更新锚点）')
} else {
  ok(histStart < splitStart, '历史面板区块边界可解析', `${histStart}<${splitStart}`)
  /* 🔴 断言只扫**有效模板**，先剥 HTML 注释：注释里出现「＋ 新对话」字样是说明文字，
     不是入口（本轮就撞到过 —— 加了条说明注释，断言当场误报 FAILED）。 */
  const histBlock = drawer.slice(histStart, splitStart).replace(/<!--[\s\S]*?-->/g, '')
  ok(!/cp-new-btn/.test(histBlock), '「新对话」按钮不在历史会话面板区块内（藏在里面 = 用户原话的回退形态）')
  ok(btnAt >= 0 && btnAt < histStart, '按钮位于历史面板之前（即标题栏区）', `btn@${btnAt} < hist@${histStart}`)
  /* v664：历史面板里那个 v488 遗留的 `＋ 新对话` 已删除（同一动作两个入口是冗余）。
     🔴 反过来钉住：历史面板内**不许**再出现任何开新对话的按钮，否则就是冗余回潮。 */
  ok(!/＋ 新对话/.test(histBlock), '历史面板内不再有重复的 `＋ 新对话`（v664 已删，防冗余回潮）')
  const histNewBtn = (histBlock.match(/@click="(newSession|clear)"/g) || []).length
  ok(histNewBtn === 0, '历史面板内不绑定 newSession/clear（开新对话只走标题栏）', `count=${histNewBtn}`)
}

/* ③ 快捷键链路：store → Shell → Drawer 三处缺一即静默失效 */
const store = read(STORE)
const shell = read(SHELL)
ok(/copilotNewTick/.test(store), 'store 声明 ui.copilotNewTick')
ok(/copilotNewTick\s*\+\+/.test(shell), 'Shell 快捷键会递增 copilotNewTick')
ok(/e\.key === 'o'/.test(shell), 'Shell 监听 O 键（⌘/Ctrl+Shift+O）')
ok(/consumeNewTick/.test(drawer), 'Drawer 通过 consumeNewTick() 消费信号（防重复触发）')
ok(/watch\(\(\) => store\.ui\.copilotNewTick/.test(drawer), 'Drawer 监听 copilotNewTick（抽屉已开时也能换新对话）')

console.log('── 副驾「新对话」入口契约 ──')
console.log(lines.join('\n'))
console.log(fails.length ? `\nFAILED (${fails.length}): ${fails.join(' / ')}` : '\nPASS')
process.exit(fails.length ? 1 : 0)
