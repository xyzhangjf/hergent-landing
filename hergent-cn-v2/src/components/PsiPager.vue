<template>
  <!-- v501：进销存列表页「分页器」共享件（采购 / 销售 / 调拨三页同一条）。
       由来：三页此前各写一份**逐字同构**的分页器（`.ipl-pager` / `.isl-pager`），
       结构与文案完全一致、只有前缀不同 ⇒ 抽成本组件，样式随 `psi-list.css` 的
       `.psi-pager` / `.psi-pg-*`（三页唯一出处）。

       🔴 **只搬结构与样式，不搬业务逻辑**：页码窗 `pageNums` 与总数 `total` 仍由
          父页的 computed 算（分页算法、每页条数候选 `PAGE_SIZES` 都留在父页 ——
          采购是 [20,50,100]、销售/调拨是 [20,50,100,200]，本轮**刻意不统一**：
          那是各页的既有能力，不是样式）。翻页动作 `go` 也由父页执行（要发请求）。

       唯一自己持有的状态是「跳至」输入框的值 `jump` —— 它是**纯输入缓冲**，
       消费即清空，不属于业务状态，放组件内最合适（父页原先的 `jumpTo` / `doJump`
       随本组件上线一并删除，避免留下"从未被执行过的代码"）。 -->
  <div class="psi-pager">
    <span class="psi-pg-cnt">共 {{ total }} 条记录，第 {{ from }}–{{ to }} 条</span>
    <div class="psi-pg-nums">
      <button class="psi-pg" :disabled="page <= 1" @click="go(page - 1)">‹</button>
      <button v-for="p in pageNums" :key="p" class="psi-pg" :class="{ on: p === page }"
              @click="go(p)">{{ p }}</button>
      <button class="psi-pg" :disabled="page >= pageCount" @click="go(page + 1)">›</button>
    </div>
    <select :value="limit" class="input psi-pg-size" @change="onSize">
      <option v-for="s in sizes" :key="s" :value="s">{{ s }} 条/页</option>
    </select>
    <span class="psi-pg-jump">
      跳至
      <input v-model.number="jump" class="input psi-pg-in" inputmode="numeric"
             @keyup.enter="doJump" />
      页
    </span>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  /** 当前页首 / 末条序号（父页 computed：`pageFrom` / `pageTo`） */
  from: { type: Number, default: 0 },
  to: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageNums: { type: Array, default: () => [] },
  pageCount: { type: Number, default: 1 },
  limit: { type: Number, default: 20 },
  sizes: { type: Array, default: () => [20, 50, 100] },
})
const emit = defineEmits(['go', 'size'])

const jump = ref('')

function go (p) { emit('go', p) }
function onSize (e) { emit('size', Number(e.target.value)) }
/* 越界钳制与"跳转后清空输入框"都在父页的 `goPage` / 本函数内完成 ——
   ⚠️ 非数字（`parseInt` 得 NaN）**直接返回**，不发请求（与原 `doJump` 逐字同行为）。 */
function doJump () {
  const n = parseInt(jump.value, 10)
  jump.value = ''
  if (!Number.isFinite(n)) return
  go(Math.min(Math.max(1, n), Math.max(1, props.pageCount)))
}
</script>
