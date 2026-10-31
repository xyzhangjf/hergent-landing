<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>资金余额表</h2><span class="page-sub">各资金账户当前余额（过账后实时更新）</span></div>
      <div class="fb-acts">
        <button class="btn btn-primary btn-sm" @click="openCreate()"><Icon name="plus" :size="14" />新建账户</button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button>
      </div>
    </div>

    <Skeleton v-if="loading" />
    <div v-else-if="err" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ err }}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button></div>

    <template v-else>
      <div class="card kpi-strip cols-2">
        <div class="kpi"><div class="kpi-label">账户数</div><div class="kpi-val">{{ accounts.length }}</div><div class="kpi-sub">已建资金账户</div></div>
        <div class="kpi"><div class="kpi-label">资金总额</div><div class="kpi-val val-ok">¥{{ fmtMoney(total) }}</div><div class="kpi-sub">全部账户余额合计</div></div>
      </div>
      <div class="card fb-card">
        <!-- v721：空态原先只写「还没有资金账户」但**全站没有建账户的入口**
             （`fundsApi.createAccount` 早在 api 层定义，却没有任何页面调用它）
             ⇒ 资金域 5 张表长期 0 行。这里补上按钮，否则这句话是死胡同。 -->
        <div v-if="!accounts.length" class="state-empty">
          <p>还没有资金账户。收款单 / 付款单需要先选择账户。</p>
          <button class="btn btn-primary btn-sm" style="margin-top:12px" @click="openCreate()">
            <Icon name="plus" :size="14" />新建第一个账户
          </button>
        </div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl">
            <thead><tr><th class="seq-th">序号</th><th>账户</th><th>类型</th><th>开户行</th><th class="num">期初余额</th><th class="num">当前余额</th><th class="op-th">操作</th></tr></thead>
            <tbody>
              <tr v-for="(a, i) in accounts" :key="a.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ a.name }}</td><td>{{ a.type }}</td><td>{{ a.bank_name || '—' }}</td>
                <td class="num">¥{{ fmtMoney(a.opening_balance) }}</td>
                <td class="num" :class="a.current_balance < 0 ? 'val-bad' : 'val-ok'">¥{{ fmtMoney(a.current_balance) }}</td>
                <td class="op-cell"><button class="btn btn-ghost btn-xs" @click="openEdit(a)">编辑</button></td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <!-- v721：`本页合计` 从「序号」窄列里挪出来。加了操作列后总宽重算，
                     它被压成「本/页/合/计」四行竖排（截图实测）。这里跨前 4 列，右对齐。 -->
                <td class="ft-lb" colspan="4">本页合计</td>
                <td class="num">¥{{ fmtMoney(pageTotals.opening) }}</td>
                <td class="num">¥{{ fmtMoney(pageTotals.current) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>

    <!-- ============ 新建 / 编辑账户 ============ -->
    <Teleport to="body">
      <div v-if="formOpen" class="imp-overlay" @click.self="closeForm()"></div>
      <div v-if="formOpen" class="imp-modal fa-modal">
        <div class="imp-hd">
          <b>{{ editing ? '编辑资金账户' : '新建资金账户' }}</b>
          <button class="imp-x" @click="closeForm()"><Icon name="close" :size="16" /></button>
        </div>
        <div class="imp-body">
          <p class="imp-tip">资金流水按<b>账户名称</b>关联，所以账户名<b>建好后不可修改</b>；同名账户也不允许（否则余额会算到别的账户上）。</p>

          <div class="fa-row">
            <label>账户名称<i>*</i></label>
            <input v-model.trim="form.name" class="input" :disabled="editing" placeholder="例如：农行基本户 / 微信收款 / 备用金">
            <span v-if="editing" class="fa-hint">名称不可修改</span>
          </div>
          <div class="fa-row">
            <label>账户类型</label>
            <select v-model="form.type" class="input">
              <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div class="fa-row" v-if="form.type === '银行'">
            <label>开户行</label>
            <input v-model.trim="form.bank_name" class="input" placeholder="例如：农业银行襄阳分行">
          </div>
          <div class="fa-row" v-if="form.type === '银行'">
            <label>银行账号</label>
            <input v-model.trim="form.account_no" class="input" placeholder="选填">
          </div>
          <div class="fa-row">
            <label>期初余额</label>
            <input v-model.number="form.opening_balance" type="number" step="0.01" class="input" placeholder="0.00">
            <span class="fa-hint">建账户当天的账面余额（元）。留空按 0 处理。</span>
          </div>
          <div class="fa-row">
            <label>备注</label>
            <input v-model.trim="form.remark" class="input" placeholder="选填">
          </div>

          <div v-if="formErr" class="fa-err"><Icon name="alert" :size="14" />{{ formErr }}</div>

          <div class="del-actions">
            <button class="btn btn-ghost btn-sm" :disabled="saving" @click="closeForm()">取消</button>
            <button class="btn btn-primary btn-sm" :disabled="saving" @click="save()">
              {{ saving ? '保存中…' : (editing ? '保存修改' : '创建账户') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import Skeleton from '../../components/Skeleton.vue'
import { ref, reactive, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'

const TYPES = ['现金', '银行', '微信', '支付宝', '其他']

const loading = ref(true), err = ref(''), accounts = ref([]), total = ref(0)
/* v512：客户端「本页合计」—— 后端余额表不返回合计，对当前页可见账户期初 / 当前余额求和。 */
const pageTotals = computed(() => {
  let opening = 0, current = 0
  for (const a of accounts.value) {
    opening += Number(a.opening_balance || 0)
    current += Number(a.current_balance || 0)
  }
  return { opening, current }
})

/* ---------------- 新建 / 编辑 ---------------- */
const formOpen = ref(false), editing = ref(false), saving = ref(false), formErr = ref(''), editId = ref(0)
const form = reactive({ name: '', type: '现金', bank_name: '', account_no: '', opening_balance: 0, remark: '' })

function resetForm() {
  form.name = ''; form.type = '现金'; form.bank_name = ''; form.account_no = ''
  form.opening_balance = 0; form.remark = ''
  formErr.value = ''
}
function openCreate() {
  editing.value = false; editId.value = 0; resetForm(); formOpen.value = true
}
function openEdit(a) {
  editing.value = true; editId.value = a.id; resetForm()
  form.name = a.name; form.type = a.type || '现金'
  form.bank_name = a.bank_name || ''; form.account_no = a.account_no || ''
  form.opening_balance = Number(a.opening_balance || 0); form.remark = a.remark || ''
  formOpen.value = true
}
function closeForm() { if (!saving.value) formOpen.value = false }

async function save() {
  if (saving.value) return
  formErr.value = ''
  if (!form.name) { formErr.value = '请填账户名称'; return }
  saving.value = true
  try {
    const payload = {
      name: form.name,
      type: form.type,
      bank_name: form.bank_name || '',
      account_no: form.account_no || '',
      opening_balance: Number(form.opening_balance || 0),
      remark: form.remark || '',
    }
    if (editing.value) await fundsApi.updateAccount(editId.value, payload)
    else await fundsApi.createAccount(payload)
    formOpen.value = false
    await load()
  } catch (e) {
    // 🔴 不许空 catch：后端为「空名 / 重名 / 改名」都返回了可读文案，必须原样上屏
    formErr.value = e.message || '保存失败'
  } finally { saving.value = false }
}

async function load() {
  loading.value = true; err.value = ''
  try {
    const d = await fundsApi.balance()
    accounts.value = Array.isArray(d.accounts) ? d.accounts : []
    total.value = Number(d.total || 0)
  } catch (e) { err.value = e.message || '加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.fb-acts { display: flex; gap: 8px }
.fb-card { padding: 0; overflow: hidden }
/* 操作列：按最不利密度核算 —— 「编辑」两字 + 按钮内边距 ≥ 88px，
   否则会被压成「编/辑」竖排（v721 截图实测踩到）。 */
.op-th, .op-cell { width: 88px; min-width: 88px; text-align: center; white-space: nowrap }
.op-cell .btn { white-space: nowrap }
.ft-lb { white-space: nowrap; text-align: right; padding-right: 12px !important }
.state-empty { padding: 36px 16px; text-align: center; color: var(--t2) }
.fa-modal { width: min(480px, 94vw) }
.fa-row { margin-bottom: 12px }
.fa-row label { display: block; font-size: var(--fs-sm); color: var(--t2); margin-bottom: 5px }
.fa-row label i { color: var(--dan); font-style: normal; margin-left: 2px }
.fa-row .input { width: 100% }
.fa-row .input:disabled { background: var(--bg2); color: var(--t3); cursor: not-allowed }
.fa-hint { display: block; font-size: 11.5px; color: var(--t3); margin-top: 4px }
.fa-err { display: flex; align-items: center; gap: 6px; margin-top: 4px; padding: 8px 10px;
  border-radius: var(--radius-sm); background: var(--dan-bg, #fdeaea); color: var(--dan); font-size: var(--fs-sm) }
</style>
