<template>
  <!-- v498：进销存列表页「状态页签」共享件（采购 / 销售 / 调拨三页同一条）。
       由来：采购单列表 v415 起就有「全部/草稿/待审批/…」页签条（带计数徽章），
       而销售 / 调拨两页只有状态**下拉框** —— 同一个"按状态分类"的诉求两套形态，
       用户视角就是缺陷（v496 规范 §9 曾把它登记为"有意差异 D1"，本轮消除）。

       🔴 计数必须来自**服务端 counts**（各页 load() 里从响应读），不能前端数当前页：
          本页服务端分页，数当前页 ⇒ 切一个页签、其它页签的数字跟着漂移
          （v403 教训）。服务端口径固定为「**忽略 status 筛选、保留其余筛选**」
          ⇒ 换页签时各档数字逐字不动。

       本组件只负责"亮哪一档 + 点了谁"；状态值怎么落进筛选、怎么发请求由父页决定
       （与 QuickRangeChips 同一分工：共享件不持有业务状态）。
       v501 起多一个 `#actions` 具名插槽：承载父页的「新建 / 刷新」（见模板注释）。 -->
  <!-- v501：外层 `.psi-tabbar` 是「页签行」—— 左页签、右页面动作。
       🔴 为什么要把动作收进来：v501 退役了各页的 `.page-hd`（大标题 + 新建/刷新），
          页面身份收归顶部标签栏后，「新建 / 刷新」这两个**页面级动作**需要有落脚点；
          挂在页签行右侧 ⇒ 不再单独占一行（本轮纵向压缩的目标之一）。
          ⚠️ 只有页签没有动作、或只有动作没有页签，都照常渲染（例如销售**退单**入口
             只有一档 ⇒ 无页签，但仍要能新建/刷新）；两者皆无才不渲染整条。 -->
  <div v-if="tabs.length > 1 || $slots.actions" class="psi-tabbar">
    <div v-if="tabs.length > 1" class="main-tabs psi-tabs">
      <button v-for="t in tabs" :key="t.value || 'all'" type="button"
              class="main-tab" :class="{ on: modelValue === t.value }"
              @click="pick(t.value)">
        {{ t.text }}<span class="psi-tabn">{{ t.count }}</span>
      </button>
    </div>
    <div v-if="$slots.actions" class="psi-tabact"><slot name="actions" /></div>
  </div>
</template>

<script setup>
/* tabs：[{ value, text, count }]。`value: ''` = 全部（读 counts.all）。
   ⚠️ 零值档**照显**（`已取消(0)`）——「这一档现在是空的」本身是信息；
      隐藏空档会让用户以为系统没这个功能（舟谱同样显示 `待审核(0)`）。
   ⚠️ 只有一档时不渲染整条（`tabs.length > 1`）：例如销售**退单**入口只有
      returned 一种状态，摆一条只有一个按钮的页签条是噪音。 */
defineProps({
  tabs: { type: Array, required: true },
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['pick'])
function pick (v) { emit('pick', v) }
</script>
