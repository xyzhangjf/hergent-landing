<template>
  <div class="page page-default">
    <div class="page-hd split">
      <div>
        <h1>打印</h1>
        <span class="page-sub">单据模板、打印设置与打印记录</span>
      </div>
    </div>

    <!-- 🔴 v396（2026-10-08）**退役模块内页签**（老板 Q3 A）：原来这里一排
         「打印模板 / 打印设置 / 打印记录」，点侧栏任一条进来都会看到**整组**
         —— 正是老板说的「点一个字段，把整个模块所有标签全展示出来」。
         现在三条各自成为一个**标签**（侧栏「系统 › 打印」列已是三条入口，
         见 `Shell.vue` 的 `NAV`），页内只渲染当前页签的内容。
         ⚠️ 页签定义表 `TABS` **保留**：退役后它仍有两个用途 ——
            由 `?tab=` 算出当前页（未知/缺失兜底第一个），以及卡片正文的取数。
            删了它，`/print` 就没有"当前是哪一页"的概念了。 -->
    <div class="card pr-card">
      <div class="pr-hd">
        <h3>{{ cur.name }}</h3>
        <span class="tag">开发中</span>
      </div>
      <p class="pr-desc">{{ cur.desc }}</p>
      <ul class="pr-plan">
        <li v-for="s in cur.plan" :key="s"><Icon name="check" :size="14" /><span>{{ s }}</span></li>
      </ul>
      <p class="pr-foot">入口与本页已就位，能力按批次补。</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../components/Icon.vue'

/* 🔴 页签唯一源：`key` 与 `Shell.vue` NAV 里那三条的 `tab` **逐字对应** ——
   改任一处都得同步（两边不一致 = 点进去页签不亮）。

   ⚠️ v395（2026-10-08）：本页是**占位骨架**（老板拍板「先立入口、打印很重要」）。
   目的只有一个：让入口点了有去处、URL 先占住，而不是造一个假功能页
   ⇒ 每个页签都**明写「开发中」**，并把计划能力列出来（不装作已完成）。 */
const TABS = [
  {
    key: 'templates', name: '打印模板',
    desc: '销售单、采购单、送货单、小票的样式模板 —— 抬头、页脚、列宽、是否带单价。',
    plan: ['单据抬头与页脚（公司名、电话、单据编号）', '列宽与纸张方向（横版 / 竖版）', '小票模板（窄条、只列关键字段）']
  },
  {
    key: 'settings', name: '打印设置',
    desc: '默认纸张、默认打印份数、默认打印机（蓝牙小票机 / 针式打印机）。',
    plan: ['默认纸张与份数', '打印机选择与默认机', '打印前是否预览']
  },
  {
    key: 'logs', name: '打印记录',
    desc: '谁在什么时候打了哪张单 —— 便于追溯「单子打了几遍、谁打的」。',
    plan: ['按单据与时间筛选', '打印次数与操作人', '异常打印（重复打印）提醒']
  }
]

const route = useRoute()
/* 未知 / 缺失的 tab 落回第一个 —— 手敲 URL 也不白屏（与 Archive/Forecast 同一兜底）。 */
const tab = computed(() => {
  const q = String((route.query && route.query.tab) || '')
  return (TABS.find(t => t.key === q) || TABS[0]).key
})
const cur = computed(() => TABS.find(t => t.key === tab.value))
</script>

<style scoped>
/* 只补本页特有的三处排版，容器/页签/卡片一律用全局件（UI-SPEC §6.2：
   同一视觉语言不写第二份）。 */
.pr-card { padding: var(--sp-5) var(--sp-5); max-width: 720px }
.pr-hd { display: flex; align-items: center; gap: var(--sp-h10); margin-bottom: var(--sp-2) }
.pr-hd h3 { font-size:var(--fs-lg); font-weight: 600; color: var(--t1) }
.pr-desc { font-size:var(--fs-base); color: var(--t2); line-height: var(--lh-normal); margin-bottom: var(--sp-4) }
.pr-plan { list-style: none; padding: 0; margin: 0 0 var(--sp-4); display: grid; gap: var(--sp-2) }
.pr-plan li { display: flex; align-items: center; gap: var(--sp-2); font-size:var(--fs-base); color: var(--t2) }
.pr-plan li svg { color: var(--p-dark); flex-shrink: 0 }
.pr-foot { font-size:var(--fs-sm); color: var(--t3) }
</style>
