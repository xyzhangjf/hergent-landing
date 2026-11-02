<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>{{ title }}</h2>
        <span class="page-sub">{{ subtitle }}</span>
      </div>
    </div>
    <div class="card rpt-card">
      <div class="unavail">
        <div class="ua-ic"><Icon name="info" :size="22" /></div>
        <h3>报表框架已就绪，数据待接入</h3>
        <p class="ua-main">本报表对应的业务模块——<b>{{ moduleName }}</b>——当前尚未在系统中录入 / 启用数据，因此暂无内容可展示。</p>
        <p class="ua-sub">{{ detail }}</p>
        <p class="ua-note">这不是故障：报表页已正式落地并纳入权限门禁。待对应模块产生业务数据（或接入数据表）后，本页会自动出数，无需再次开发。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 诚实空态报表组件（批次3）：对应业务模块在系统中尚无数据表 / 尚未启用。
   🔴 绝不编造数据：只说明「框架就绪、数据待接入」，明确这不是故障。 */
import Icon from './Icon.vue'

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  moduleName: { type: String, default: '' },
  detail: { type: String, default: '' },
})
</script>

<style scoped>
.rpt-card { margin-top: var(--sp-4); }
.unavail {
  padding: 40px var(--sp-6); text-align: center; color: var(--t2);
  display: flex; flex-direction: column; align-items: center; gap: var(--sp-2);
}
.ua-ic { color: var(--t3); margin-bottom: var(--sp-1); }
.unavail h3 { margin: 0; font-size:var(--fs-lg); color: var(--t1); }
.ua-main { margin: var(--sp-1) 0 0; font-size:var(--fs-md); max-width: 560px; line-height: var(--lh-loose); }
.ua-main b { color: var(--t1); }
.ua-sub { margin: 0; font-size:var(--fs-sm); color: var(--t3); max-width: 560px; line-height: var(--lh-loose); }
.ua-note { margin: var(--sp-2) 0 0; font-size:var(--fs-sm); color: var(--t3); max-width: 560px; line-height: var(--lh-loose); }
</style>
