<template>
  <div class="page page-default">
    <div class="page-hd split">
      <div>
        <h2>打印</h2>
        <span class="page-sub">单据模板、打印设置与打印记录</span>
      </div>
    </div>

    <!-- 🔴 当前页签只从 URL 的 `?tab=` 读（与 `Forecast.vue` 同构）：
         侧栏三条入口各带自己的 `tab` ⇒ 直达、可分享、刷新不丢。 -->
    <div class="main-tabs">
      <router-link v-for="t in TABS" :key="t.key" class="main-tab" :class="{ on: tab === t.key }"
                   :to="{ path: '/print', query: { tab: t.key } }">{{ t.name }}</router-link>
    </div>

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
.pr-card { padding: 18px 20px; max-width: 720px }
.pr-hd { display: flex; align-items: center; gap: 10px; margin-bottom: 8px }
.pr-hd h3 { font-size: 15px; font-weight: 600; color: var(--t1) }
.pr-desc { font-size: 13px; color: var(--t2); line-height: 1.7; margin-bottom: 14px }
.pr-plan { list-style: none; padding: 0; margin: 0 0 14px; display: grid; gap: 8px }
.pr-plan li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--t2) }
.pr-plan li svg { color: var(--p-dark); flex-shrink: 0 }
.pr-foot { font-size: 12px; color: var(--t3) }
</style>
