<template>
  <div v-if="result" class="ir" :class="{ bad: failCount }">
    <div class="ir-line">
      导入完成 —— 新增 <b>{{ okCount }}</b> 条
      · 跳过 <b :class="{ dim: !skipCount }">{{ skipCount }}</b> 条
      · 失败 <b :class="{ bad: failCount }">{{ failCount }}</b> 条
    </div>

    <!-- v303：把「跳过了哪些」点名出来。
         只给一个跳过数是不够的 —— 用户看到「跳过 12 条」的第一反应是"跳错了没有？"，
         他去核对的方式就是逐条看。这是「增量导入」这个功能**能不能被信任**的关键一行。 -->
    <div v-if="existing.length" class="ir-sub">
      <div class="ir-sub-h">跳过的是这些（已在系统里，未重复导入）：</div>
      <div v-for="(e, i) in existing" :key="'x' + i" class="ir-sub-i">第 {{ e.row }} 行 · {{ e.msg }}</div>
      <div v-if="result.existing_count > existing.length" class="ir-sub-i">
        … 共 {{ result.existing_count }} 条
      </div>
    </div>

    <div v-if="dupes.length" class="ir-sub">
      <div class="ir-sub-h">名字像重复、按你的设置跳过的：</div>
      <div v-for="(e, i) in dupes" :key="'d' + i" class="ir-sub-i">第 {{ e.row }} 行 · {{ e.msg }}</div>
    </div>

    <div v-if="warns.length" class="ir-sub ir-sub-warn">
      <div class="ir-sub-h">已经导进去了，但这几条要你看一眼：</div>
      <div v-for="(e, i) in warns" :key="'w' + i" class="ir-sub-i">第 {{ e.row }} 行 · {{ e.msg }}</div>
    </div>

    <div v-if="errors.length" class="ir-sub">
      <div class="ir-sub-h">没导进去的（需要你处理）：</div>
      <div v-for="(e, i) in errors" :key="'e' + i" class="ir-sub-i">第 {{ e.row }} 行 · {{ e.msg }}</div>
    </div>

    <!-- 撤销区。四种状态要能被分辨：可撤销 / 已撤销 / 无权撤销 / 不支持撤销（并说为什么不支持）。
         「不支持」与「无权」都要显示原因 —— 静默没有按钮，用户只会以为功能坏了。 -->
    <div v-if="result.batch_id" class="ir-act">
      <button v-if="canUndo" class="btn btn-ghost btn-sm" :disabled="busy || undone" @click="doUndo">
        {{ undone ? '已撤销，记录已删除' : (busy ? '撤销中…' : '撤销这次导入') }}
      </button>
      <span v-if="canUndo && !undone" class="ir-tip">只删掉这次新加的记录，之前录入的不受影响。</span>
      <span v-else-if="result.undoable && !hasUndoPerm" class="ir-tip">你没有撤销导入的权限，如需撤销请联系管理员。</span>
      <span v-else-if="!result.undoable" class="ir-tip">{{ result.undo_reason }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { toast, canDo } from '../store'
import { importApi } from '../api/modules'

/* 导入回执 —— 商品 / 库存 / 员工 / 报单矩阵四处导入**共用同一份实现**。
 *
 * 由来（v303，2026-09-28）：四处导入此前各自渲染一段"成功 N 条 · 跳过 N 条 · 失败 N 条"，
 * 且都没有撤销入口。BP 承诺的「导入回执可撤销」因此落不了地。
 * 抽成一个组件而不是四处各写一遍，理由与 ImportMapping.vue 完全相同：
 * 撤销这件事涉及**危险动作**（删数据），四份实现里只要有一份忘了确认，就会删错东西。
 *
 * 设计约束（两条）：
 *  ① **撤销成功必须以「后端说删了几条」为准**，不能只看 HTTP 200。后端返回
 *     `{deleted, recorded}`，两者不等说明导出后有人动过这些行 —— 这种情况要显式说出来。
 *  ② **不可撤销要显示原因**。库存（同批次累加）、应收期初（参与账龄）、销售明细（改单据金额）
 *     在业务上都不该被自动撤，后端会回 `undo_reason`；这里只负责显示，不自己判断。
 */
const props = defineProps({
  // /api/import/execute 的返回值。null 时整块不渲染。
  result: { type: Object, default: null },
})
const emit = defineEmits(['undone'])

const busy = ref(false)
const undone = ref(false)

// 换一份新的导入结果 ⇒ 撤销按钮状态复位（否则第二次导入会显示"已撤销"）
watch(() => props.result && props.result.batch_id, () => { undone.value = false })

const r = computed(() => (props.result && props.result.results) || {})
const okCount = computed(() => r.value.success || 0)
const skipCount = computed(() => r.value.skipped || 0)

const allErrs = computed(() => (r.value.errors || []))
/* 四类分开（**分类只在这一处**，模板里不再各自 filter —— 两处分类必然漂移）：
     · duplicate → 疑似重复，按用户自己设的跳过（`type='duplicate'`）
     · 已存在     → 增量跳过，在顶层 `existing` 里，**不在** errors
     · warn      → v304 新增：**已经导进去了、但有事要你看一眼**。最典型的是收款流水的
                   「这笔钱超过该客户全部未清应收，有 N 元没能分摊」。它既不该算进"失败"
                   （会让整块变红、用户以为白导了），更不该被吞掉（那笔差额就永远没人管）。
     · 其余      → 真失败（没导进去，要处理） */
const dupes = computed(() => allErrs.value.filter(e => e.type === 'duplicate'))
const warns = computed(() => allErrs.value.filter(e => e.type === 'warn'))
const errors = computed(() => allErrs.value.filter(e => e.type !== 'duplicate' && e.type !== 'warn'))
const failCount = computed(() => errors.value.length)
const existing = computed(() => (props.result && props.result.existing) || [])

/* v335（2026-09-30）**按钮级门禁**：撤销 = `POST /api/import/receipts/{id}/undo`
   ⇒ 后端模块 `data`、动作 **`create`**。
   🔴 `create` 不是笔误 —— 后端动作由 **HTTP 方法**推导（POST=create），这个撤销端点就是 POST。
      门禁必须照抄这个事实，自己按"业务语义"改成 `delete` 就会与后端判据不一致（撒谎）。
   🔴 为什么把「后端说可撤」与「你有权撤」分成两个 computed 再用三个分支显示：
      只写一个合并判据时，会出现「按钮藏着、旁边却留着『只删掉这次新加的记录』那行说明」；
      而权限不足时又什么都不显示（静默）—— 本仓明令「不支持要显示原因」。 */
const hasUndoPerm = computed(() => canDo('data', 'create'))
const canUndo = computed(() => !!props.result && !!props.result.undoable && hasUndoPerm.value)

async function doUndo() {
  if (!props.result || !props.result.batch_id) return
  busy.value = true
  try {
    const res = await importApi.undo(props.result.batch_id)
    undone.value = true
    const del = res.deleted
    const rec = res.recorded
    if (res.kind === 'revert') {
      /* v304：收款流水的撤销不是"删行"，是**把分摊掉的钱按原路冲回应收**。
         说成"删除 N 条"会让老板以为只是少了几行记录 —— 真正要紧的是"那笔钱退回去了、
         这位客户又变回欠款状态"。两种语义必须用两种说法。 */
      toast(del === rec
        ? `已撤销：${del} 笔回款已冲回，对应客户的应收已恢复原样`
        : `已撤销：已冲回 ${del} 笔（本次记了 ${rec} 笔，其余可能已被改动过）`,
        del === rec ? 'ok' : 'warn')
    } else {
      toast(del === rec
        ? `已撤销：删除 ${del} 条本次导入的记录`
        : `已撤销：只找到并删除 ${del} 条（本次导入记了 ${rec} 条，其余可能已被改动过）`,
        del === rec ? 'ok' : 'warn')
    }
    emit('undone')
  } catch (e) {
    toast(e.message || '撤销失败', 'err')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.ir{margin-top:12px;padding:10px 14px;border-radius:10px;font-size:13px;
    background:rgba(var(--suc-rgb),.1);color:var(--suc);display:flex;flex-direction:column;gap:6px}
.ir.bad{background:rgba(var(--war-rgb),.12);color:var(--war)}
.ir-line b{font-size:14px}
.ir-line b.dim{color:var(--t3);font-weight:500}
.ir-line b.bad{color:var(--err-red, #d9534f)}
.ir-sub{font-size:12px;color:var(--t2);display:flex;flex-direction:column;gap:2px}
/* v304：「已导入但要你看一眼」用暖色，与"真失败"（红）刻意区分开 ——
   两者混成一色，用户就无法一眼分辨"要不要重来"。 */
.ir-sub-warn{color:#b45309}
.ir-sub-h{font-weight:500}
.ir-sub-i{padding-left:8px}
.ir-act{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px}
.ir-tip{font-size:12px;color:var(--t2)}
</style>
