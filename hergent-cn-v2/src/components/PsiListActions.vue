<template>
  <!-- v510：进销存七列表页共享「动作组」（导出 → 批量操作 → 新建 → 刷新）。
       由来：v509 之前三页各自一套工具栏（.psi-tb），含全选 / 反选 / 打印 / 批量，
       与页签行的「新建 / 刷新」各占一行 ⇒ 纵向浪费。v510 把动作收进页签行右侧
       （StatusTabs 的 #actions 插槽），并抽成共享件，顺序固定为
       **导出 → 批量操作 → 新建 → 刷新**（老板口径：导出 / 批量在新建前面）。

       🔴 全选 / 反选 / 打印从本件移除：批量仍走行内勾选列（逐行选），不靠表头全选框；
          打印在采购单走**操作列逐行**入口（rowPrint），不在工具栏。
       🔴 排序提示（按 X 升 / 降序 + 清除）由父页通过 #status 插槽注入，落在动作组左侧。
       🔴 本件只管"按钮排布 + 把点击转成事件"，业务状态（batchOpen / selected / newLabel）
          仍由父页持有并通过 props 下传、emit 回传（与 StatusTabs / PsiPager 同一分工）。 -->
  <div class="psi-acts">
    <span v-if="$slots.status" class="psi-acts-status"><slot name="status" /></span>

    <button class="btn btn-ghost btn-sm" :disabled="exportDisabled" @click="emit('export')">
      <Icon name="download" :size="14" />导出
    </button>

    <!-- 批量操作：仅采购单有后端批量端点（psiApi.batchPurchases）；销售 / 调拨无 ⇒ showBatch=false -->
    <div v-if="showBatch" class="psi-acts-mw">
      <button class="btn btn-ghost btn-sm" :class="{ on: batchOpen }"
              :disabled="batchDisabled" @click.stop="emit('toggle-batch')">
        批量操作<span class="psi-caret" :class="{ up: batchOpen }"></span>
      </button>
      <div v-if="batchOpen" class="psi-acts-menu" @click.stop>
        <button v-for="a in batchItems" :key="a.op" class="psi-acts-mi"
                :class="{ danger: a.danger }" @click="emit('batch-pick', a)">{{ a.text }}</button>
      </div>
    </div>

    <button v-if="showNew" class="btn btn-primary btn-sm" :disabled="newDisabled" @click="emit('new')">
      <Icon name="plus" :size="14" />{{ newLabel }}
    </button>

    <button class="btn btn-ghost btn-sm" :disabled="refreshDisabled" @click="emit('refresh')">
      <Icon name="refresh" :size="14" />刷新
    </button>
  </div>
</template>

<script setup>
import Icon from './Icon.vue'
/* props / emits —— 业务状态全部来自父页：
   · exportDisabled  导出无数据时禁用（父页传 `!rows.length`）
   · showBatch       是否显示批量操作（采购单 true，销售 / 调拨 false）
   · batchItems      批量菜单项数组（父页的 BATCH_ACTIONS）
   · batchOpen       菜单展开态
   · batchDisabled   无写权限时禁用
   · newLabel        「新建」按钮文案（采购单随入口变「新建采购单 / 新建采购退货单」）
   · refreshDisabled 加载中禁用刷新
   事件：export / toggle-batch / batch-pick(item) / new / refresh */
defineProps({
  exportDisabled: { type: Boolean, default: false },
  showBatch: { type: Boolean, default: false },
  batchItems: { type: Array, default: () => [] },
  batchOpen: { type: Boolean, default: false },
  batchDisabled: { type: Boolean, default: false },
  showNew: { type: Boolean, default: true },
  newDisabled: { type: Boolean, default: false },
  newLabel: { type: String, default: '新建' },
  refreshDisabled: { type: Boolean, default: false },
})
const emit = defineEmits(['export', 'toggle-batch', 'batch-pick', 'new', 'refresh'])
</script>
