<template>
  <div class="page page-default">
    <div class="page-hd split">
      <div>
        <h2>{{ title }}</h2>
        <span class="page-sub">{{ area }} · 规划能力</span>
      </div>
    </div>

    <!-- v465（2026-10-11）：四新区（仓配管理/资金管理/数据报表/市场营销）的**共享占位骨架**。
         与 Print.vue（v395）同一先例：**先立入口、不留死链** —— 侧栏弹窗条目点了有去处、
         URL 先占住，但**不装作已完成**（明写「开发中」、不写任何业务数据）。
         ⚠️ 本组件由 `router/index.js` 按 `constants/pages.js::PLACEHOLDER_PAGES`
            **数据驱动**批量挂载；某个占位页要落真身时，把该条从表里移出、
            换成真实组件与登记行即可，本组件不用改。 -->
    <div class="card ph-card">
      <div class="ph-hd">
        <h3>{{ title }}</h3>
        <span class="tag">开发中</span>
      </div>
      <p class="ph-desc">这一页属于「{{ area }}」的规划能力：入口与 URL 已先立（对齐舟谱的侧栏形态），功能按批次补齐 —— 先把该区的数据链路打通，再逐页落真身。</p>
      <p class="ph-foot">本页当前不承载任何业务数据；要做这一页时，从 `PLACEHOLDER_PAGES` 表里移出并换成真实页面。</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => (route.meta && route.meta.title) || '占位页')
const area = computed(() => (route.meta && route.meta.area) || '规划中')
</script>

<style scoped>
/* 只补本页特有两处排版，容器/页头/卡片一律用全局件（UI-SPEC §6.2：同一视觉语言不写第二份）。 */
.ph-card { padding: 18px 20px; max-width: 720px }
.ph-hd { display: flex; align-items: center; gap: 10px; margin-bottom: 8px }
.ph-hd h3 { font-size: 15px; font-weight: 600; color: var(--t1) }
.ph-desc { font-size: 13px; color: var(--t2); line-height: 1.7; margin-bottom: 12px }
.ph-foot { font-size: 12px; color: var(--t3) }
</style>
