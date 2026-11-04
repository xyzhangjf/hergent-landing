<template>
  <!-- v766：全站「指路文案」的唯一可点实现。
       ------------------------------------------------------------
       由来（2026-11-04 全站审计）：页面里大量「请到 XX 页去配」「先去 XX 建一个」
       这类**跨页指路**是死文本 —— 用户被要求去一个页面，却没有可点的东西，
       只能自己去侧栏摸。审计实测 22 处跨页死文案 + 10 处 toast 指路。
       根因不是文案写错，而是**跳转写法有 4 套并存**（`<router-link>` 13 处 /
       裸 `href="#/..."` 3 处 / 各页自写 `goXxx()` 34 处 / `router.push` 0 处），
       于是「加一个可点入口」每次都要重新发明一遍，多数时候干脆没加。

       🔴 样式直接复用全局 `.lnk-btn`（styles/variables.css:865，v713 已定义）——
          它本来就是「嵌在一句话中间的可点词」，尺寸跟所在段落行高走。
          **不要在调用处再写一份 lnk-btn 样式**：ReportMapping / PriceChannels /
          BrandArchive / AlertRules / EmployeeArchive / Promotions 六个文件里
          各自 scoped 复制过同一段，改一处不会同步另外五处。

       🔴 两种形态必须都在：`to` 给路由 ⇒ 渲染 `<a>`（走路由守卫，无权限时由守卫
          统一提示，不自造第二套判据）；`to` 为空 ⇒ 渲染 `<button>`，由父组件
          `@click` 决定行为（用于**同页**动作，例如「切到某 tab」「打开某弹窗」）。
          同页动作**不要**塞 URL：`?tab=` 类深链通常只在页面挂载时消费一次，
          已经在页内再点同一个 URL 不会重新触发（Rebate `_applyRouteNew` 即此形态）。 -->
  <router-link
    v-if="to"
    :to="to"
    class="lnk-btn go-link"
    @click="$emit('click')"
  ><slot /></router-link>
  <button
    v-else
    type="button"
    class="lnk-btn go-link"
    @click="$emit('click')"
  ><slot /></button>
</template>

<script setup>
defineProps({
  /** 目标路由（路径字符串或 `{ path, query }`）。留空 = 渲染按钮，行为交给 `@click` */
  to: { type: [String, Object], default: '' },
})
defineEmits(['click'])
</script>

<style scoped>
/* 只补 `.lnk-btn` 没覆盖的一点：它是 `<a>` 时默认 `display:inline`，
   在 flex 容器里（部分提示条）会撑不满行高；`vertical-align` 让它在正文里不顶着上沿。 */
.go-link{vertical-align:baseline}
</style>
