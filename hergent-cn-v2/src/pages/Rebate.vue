<template>
  <div class="page">
    <div class="page-hd">
      <h2>目标与返利政策</h2>
      <span class="page-sub">唯一规则写入口 · 厂家指标管理</span>
    </div>

    <!-- 操作栏 -->
    <div class="card toolbar">
      <div class="tb-left">
        <select v-model="filterDim" class="input sel-filter">
          <option value="">全部维度</option>
          <option value="brand">品牌维度</option>
          <option value="product">单品维度</option>
        </select>
        <select v-model="filterActive" class="input sel-filter">
          <option value="">全部状态</option>
          <option value="1">已启用</option>
          <option value="0">已停用</option>
        </select>
      </div>
      <div class="tb-right">
        <button class="btn btn-ghost" @click="showSimulate = !showSimulate">试算</button>
        <button class="btn btn-primary" @click="openCreate">+ 新建规则</button>
      </div>
    </div>

    <!-- 规则列表 -->
    <div class="card list-card">
      <div v-if="loading" class="state-empty"><div class="skel-line" style="width:60%;margin:0 auto"></div></div>
      <div v-else-if="!filteredRules.length" class="state-empty">
        <div class="se-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
        <p>暂无返利规则，点击「新建规则」创建</p>
      </div>
      <div v-else class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>规则名称</th><th>维度</th><th>周期</th><th>作用对象</th>
              <th class="num">目标值</th><th>触发</th><th>返利</th>
              <th>生效期</th><th>状态</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filteredRules" :key="r.id">
              <td>{{ r.rule_name }}</td>
              <td><span class="tag info">{{ dimText(r.dimension) }}</span></td>
              <td>{{ periodText(r.period_type) }}</td>
              <td>{{ r.scope_name || '全部' }}</td>
              <td class="num">{{ fmtTarget(r) }}</td>
              <td><span class="tag" :class="r.trigger_mode === 'tiered' ? 'info' : 'ok'">{{ triggerText(r.trigger_mode) }}</span></td>
              <td>{{ rebateText(r) }}</td>
              <td class="td-date">{{ r.effective_start || '—' }} ~ {{ r.effective_end || '—' }}</td>
              <td><span class="tag" :class="r.is_active ? 'ok' : ''">{{ r.is_active ? '启用' : '停用' }}</span></td>
              <td>
                <button class="btn-mini" @click="openEdit(r)">编辑</button>
                <button class="btn-mini btn-danger" @click="del(r)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新建/编辑弹层 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showForm" class="modal-overlay" @click.self="showForm=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="showForm" class="modal-card">
          <div class="modal-hd">
            <b>{{ editing ? '编辑规则' : '新建规则' }}</b>
            <button class="btn-close" @click="showForm=false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row"><label>规则名称</label><input v-model="form.rule_name" class="input" placeholder="如 蒙牛低温8月目标"></div>
            <div class="form-grid2">
              <div class="form-row"><label>计算维度</label>
                <select v-model="form.dimension" class="input">
                  <option value="brand">品牌</option>
                  <option value="product">单品</option>
                </select>
              </div>
              <div class="form-row"><label>目标度量</label>
                <select v-model="form.target_type" class="input">
                  <option value="amount">金额（元）</option>
                  <option value="quantity">数量（件）</option>
                </select>
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>作用对象</label><input v-model="form.scope_name" class="input" placeholder="品牌名/商品名（空=全部）"></div>
              <div class="form-row"><label>周期口径</label>
                <select v-model="form.period_type" class="input">
                  <option value="month">月</option>
                  <option value="quarter">季</option>
                  <option value="year">年</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>目标值</label><input v-model.number="form.target_value" class="input" type="number" min="0" placeholder="金额或数量"></div>
              <div class="form-row"><label>触发方式</label>
                <select v-model="form.trigger_mode" class="input">
                  <option value="on_target">达成即返</option>
                  <option value="tiered">阶梯返利</option>
                </select>
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>返利形式</label>
                <select v-model="form.rebate_basis" class="input">
                  <option value="rate">比例</option>
                  <option value="fixed">固定金额</option>
                </select>
              </div>
              <div class="form-row"><label>返利值</label>
                <input v-if="form.rebate_basis==='rate'" v-model.number="form.rebate_rate" class="input" type="number" min="0" max="1" step="0.01" placeholder="0.02 = 2%">
                <input v-else v-model.number="form.rebate_amount" class="input" type="number" min="0" placeholder="固定金额">
              </div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>生效开始</label><input v-model="form.effective_start" class="input" type="date"></div>
              <div class="form-row"><label>生效结束</label><input v-model="form.effective_end" class="input" type="date"></div>
            </div>
            <div class="form-grid2">
              <div class="form-row"><label>优先级</label><input v-model.number="form.priority" class="input" type="number" placeholder="数值越大越优先"></div>
              <div class="form-row"><label>启用</label>
                <select v-model.number="form.is_active" class="input">
                  <option :value="1">启用</option>
                  <option :value="0">停用</option>
                </select>
              </div>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="showForm=false">取消</button>
            <button class="btn btn-primary" @click="save">{{ editing ? '保存' : '创建' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 试算弹层 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showSimulate" class="modal-overlay" @click.self="showSimulate=false"></div>
      </Transition>
      <Transition name="modal">
        <div v-if="showSimulate" class="modal-card">
          <div class="modal-hd"><b>返利试算</b><button class="btn-close" @click="showSimulate=false">✕</button></div>
          <div class="modal-body">
            <div class="form-row"><label>选择规则</label>
              <select v-model="simRuleId" class="input">
                <option value="">— 选择 —</option>
                <option v-for="r in rules" :key="r.id" :value="r.id">{{ r.rule_name }}</option>
              </select>
            </div>
            <div class="form-row"><label>实际完成值</label><input v-model.number="simActual" class="input" type="number" placeholder="实际完成金额或数量"></div>
            <div v-if="simResult" class="sim-result">
              <div class="sr-row"><span>应返金额</span><b class="sr-val">¥{{ fmt(simResult.rebate_amount) }}</b></div>
              <div class="sr-row"><span>返利比例</span><b>{{ simResult.effective_rate ? (simResult.effective_rate * 100).toFixed(2) + '%' : '—' }}</b></div>
              <div class="sr-row"><span>达成率</span><b>{{ simResult.achievement ? (simResult.achievement * 100).toFixed(1) + '%' : '—' }}</b></div>
              <div v-if="simResult.note" class="sr-note">{{ simResult.note }}</div>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-ghost" @click="showSimulate=false">关闭</button>
            <button class="btn btn-primary" @click="runSimulate">计算</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { toast } from '../store'
import { rebateApi } from '../api/modules'

const rules = ref([])
const loading = ref(false)
const filterDim = ref('')
const filterActive = ref('')

const showForm = ref(false)
const editing = ref(false)
const form = ref({})

const showSimulate = ref(false)
const simRuleId = ref('')
const simActual = ref(null)
const simResult = ref(null)

const filteredRules = computed(() => {
  return rules.value.filter(r => {
    if (filterDim.value && r.dimension !== filterDim.value) return false
    if (filterActive.value !== '' && String(r.is_active) !== filterActive.value) return false
    return true
  })
})

function openCreate() {
  editing.value = false
  form.value = {
    rule_name: '', dimension: 'brand', target_type: 'amount',
    scope_key: '', scope_name: '', period_type: 'month',
    target_value: 0, trigger_mode: 'on_target', trigger_threshold: 1,
    tiers_json: '', rebate_basis: 'rate', rebate_rate: 0, rebate_amount: 0,
    effective_start: '', effective_end: '', priority: 0, is_active: 1,
  }
  showForm.value = true
}

function openEdit(r) {
  editing.value = true
  form.value = { ...r }
  showForm.value = true
}

async function save() {
  const f = form.value
  if (!f.rule_name) { toast('请填写规则名称', 'error'); return }
  if (!f.target_value || f.target_value <= 0) { toast('目标值必须 > 0', 'error'); return }
  if (f.rebate_basis === 'rate' && (f.rebate_rate < 0 || f.rebate_rate > 1)) { toast('返利比例须 0~1', 'error'); return }
  try {
    if (editing.value) {
      await rebateApi.update(f.id, f)
    } else {
      await rebateApi.create(f)
    }
    toast(editing.value ? '已保存' : '已创建', 'success')
    showForm.value = false
    await loadRules()
  } catch (e) {
    toast('操作失败: ' + (e.message || ''), 'error')
  }
}

async function del(r) {
  if (!confirm(`确认删除「${r.rule_name}」？`)) return
  try {
    await rebateApi.delete(r.id)
    toast('已删除', 'success')
    await loadRules()
  } catch (e) {
    toast('删除失败: ' + (e.message || ''), 'error')
  }
}

async function runSimulate() {
  if (!simRuleId.value || !simActual.value) { toast('请选择规则并输入实际值', 'error'); return }
  try {
    const r = await rebateApi.simulate({ rule_id: parseInt(simRuleId.value), actual_value: simActual.value })
    simResult.value = r
  } catch (e) {
    toast('试算失败: ' + (e.message || ''), 'error')
  }
}

async function loadRules() {
  loading.value = true
  try {
    const d = await rebateApi.list()
    rules.value = d.rules || d.data || d || []
  } catch (e) {
    // 静默
  } finally {
    loading.value = false
  }
}

function dimText(d) { return d === 'brand' ? '品牌' : d === 'product' ? '单品' : d }
function periodText(p) { return { month: '月', quarter: '季', year: '年', custom: '自定义' }[p] || p }
function triggerText(t) { return t === 'on_target' ? '达成即返' : t === 'tiered' ? '阶梯' : t }
function rebateText(r) {
  if (r.rebate_basis === 'rate') return r.rebate_rate ? (r.rebate_rate * 100).toFixed(1) + '%' : '—'
  return r.rebate_amount ? '¥' + r.rebate_amount : '—'
}
function fmtTarget(r) {
  if (r.target_type === 'amount') return '¥' + fmt(r.target_value)
  return r.target_value + ' 件'
}
function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

onMounted(loadRules)
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;margin-bottom:14px;flex-wrap:wrap;gap:10px}
.tb-left,.tb-right{display:flex;align-items:center;gap:8px}
.sel-filter{width:160px}
.list-card{padding:16px}
.td-date{font-size:12px;color:var(--t3);white-space:nowrap}
.btn-mini{border:1px solid var(--bd);background:none;border-radius:6px;padding:3px 10px;font-size:12px;color:var(--t2);cursor:pointer;margin-right:4px}
.btn-mini:hover{background:var(--bg2)}
.btn-mini.btn-danger{color:var(--dan);border-color:rgba(var(--dan-rgb),.3)}
.btn-mini.btn-danger:hover{background:rgba(var(--dan-rgb),.08)}

.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000}
.modal-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:580px;max-width:92vw;max-height:88vh;overflow-y:auto;background:var(--bg);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:1001}
.modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.modal-hd b{font-size:16px}
.btn-close{border:none;background:none;font-size:18px;color:var(--t3);cursor:pointer}
.modal-body{padding:20px;display:flex;flex-direction:column;gap:14px}
.modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sim-result{background:var(--bg2);border-radius:var(--radius-md);padding:14px;margin-top:6px}
.sr-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0}
.sr-val{font-size:18px;color:var(--p-dark)}
.sr-note{font-size:12px;color:var(--t3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.modal-enter-active,.modal-leave-active{transition:all .25s ease}
.modal-enter-from,.modal-leave-to{opacity:0;transform:translate(-50%,-46%)}

@media(max-width:768px){
  .toolbar{flex-direction:column;align-items:stretch}
  .sel-filter{width:100%}
  .form-grid2{grid-template-columns:1fr}
  .modal-card{width:94vw}
}
</style>
