<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>品牌档案</h2>
        <span class="page-sub">维护品牌主档 · 支撑品牌目标与返利 · 服务无 API 的舟谱类用户</span>
      </div>
    </div>

    <!-- 品牌列表 -->
    <div class="card ba-panel">
      <div class="panel-hd">
        <b>品牌主档</b>
        <span class="tag info">商品 brand 为轻量文本，这里做规范层，不强制外键</span>
      </div>

      <!-- 新增品牌 -->
      <div class="ba-add-row">
        <button class="btn btn-primary btn-sm" @click="openCreate">+ 添加品牌</button>
        <span class="ba-add-hint">点击后填写品牌信息（与「编辑」一致，先弹窗）</span>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="brands.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>品牌</th><th>厂商</th><th>等级</th>
            <th class="num">关联商品</th><th>状态</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="b in brands" :key="b.id" :class="{ stopped: b.is_active === 0 }">
              <td>
                {{ b.name }}
                <span v-if="b.is_active === 0" class="ba-stopped-tag">已停用</span>
              </td>
              <td>{{ b.manufacturer || '—' }}</td>
              <td>{{ b.tier || '—' }}</td>
              <td class="num">{{ b.product_count || 0 }}</td>
              <td>
                <span class="ba-status" :class="b.is_active === 0 ? 'off' : 'on'">
                  {{ b.is_active === 0 ? '停用' : '启用' }}
                </span>
              </td>
              <td class="ba-ops">
                <button class="btn btn-ghost btn-sm" @click="openEdit(b)">编辑</button>
                <button v-if="b.is_active !== 0" class="btn btn-ghost btn-sm danger" @click="askDisable(b)">停用</button>
                <button v-else class="btn btn-ghost btn-sm" @click="brandToggle(b.id, 1)">启用</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">还没有品牌，先添加，或在导入/连接器里发现的品牌会进「待审」队列</div>
    </div>

    <!-- 待审品牌（决策②：导入/连接器未匹配品牌入队） -->
    <div class="card ba-panel">
      <div class="panel-hd">
        <b>待审品牌</b>
        <span class="tag warn">导入 / 连接器发现的未匹配品牌先入这里，人工确认后再归一（决策③逐步归一）</span>
      </div>

      <div v-if="pendingLoading" class="state-empty">加载中…</div>
      <div v-else-if="pending.length" class="ba-pending-list">
        <div v-for="p in pending" :key="p.id" class="ba-pending-item">
          <div class="ba-pending-info">
            <div class="ba-pending-name">
              {{ p.raw_name }}
              <span class="ba-ref">命中 {{ p.ref_count }} 次</span>
            </div>
            <div class="ba-pending-meta">
              <span v-if="p.source">来源：{{ p.source }}</span>
              <span v-if="p.created_at">发现于：{{ p.created_at }}</span>
            </div>
          </div>
          <div class="ba-pending-actions">
            <input v-model="p._canonical" class="input ba-canonical" :placeholder="p.raw_name" style="width:150px">
            <button class="btn btn-primary btn-sm" :disabled="!canonicalOf(p)" @click="resolve(p, 'create')">新建为品牌</button>
            <select v-model="p._mergeTarget" class="input ba-merge" style="width:150px">
              <option value="">合并到已有品牌…</option>
              <option v-for="b in activeBrands" :key="b.id" :value="b.name">{{ b.name }}</option>
            </select>
            <button class="btn btn-ghost btn-sm" :disabled="!p._mergeTarget" @click="resolve(p, 'merge')">合并</button>
            <button class="btn btn-ghost btn-sm" @click="resolve(p, 'dismiss')">忽略</button>
          </div>
        </div>
      </div>
      <div v-else class="state-empty">待审队列为空 ✓</div>
    </div>

    <!-- 新建/编辑品牌弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="formOpen" class="ba-overlay" @click="formOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="formOpen" class="ba-modal">
          <div class="ba-modal-hd"><b>{{ formMode === 'create' ? '新建品牌' : ('编辑品牌 · ' + editTarget?.name) }}</b><button class="ba-x" @click="formOpen = false">✕</button></div>
          <div class="ba-modal-body">
            <label class="ba-field"><span>品牌名称 *</span><input v-model="editForm.name" class="input" placeholder="必填，如 蒙牛 / 伊利"></label>
            <label class="ba-field"><span>厂商</span><input v-model="editForm.manufacturer" class="input"></label>
            <label class="ba-field"><span>等级</span><input v-model="editForm.tier" class="input" placeholder="如 KA / BC / 便利店"></label>
            <label class="ba-field"><span>统一社会信用代码</span><input v-model="editForm.credit_code" class="input"></label>
            <label class="ba-field"><span>官网</span><input v-model="editForm.website" class="input"></label>
            <label class="ba-field"><span>联系方式</span><input v-model="editForm.contact_info" class="input"></label>
            <label class="ba-field ba-field-wide"><span>备注</span><input v-model="editForm.description" class="input"></label>
          </div>
          <div class="ba-modal-ft">
            <button class="btn btn-ghost" @click="formOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="!editForm.name.trim()" @click="saveForm">保存</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 停用确认弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="disableOpen" class="ba-overlay" @click="disableOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="disableOpen" class="ba-modal">
          <div class="ba-modal-hd"><b>停用品牌</b><button class="ba-x" @click="disableOpen = false">✕</button></div>
          <div class="ba-modal-body">
            <p class="ba-tip warn-text">确认停用「{{ disableTarget?.name }}」？<br>停用后该品牌仍保留在历史商品记录里，只是不再作为可选规范品牌。</p>
          </div>
          <div class="ba-modal-ft">
            <button class="btn btn-ghost" @click="disableOpen = false">取消</button>
            <button class="btn btn-danger" @click="confirmDisable">确认停用</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '../api/client'
import { toast } from '../store'

const loading = ref(false)
const pendingLoading = ref(false)
const brands = ref([])
const pending = ref([])

const activeBrands = computed(() => brands.value.filter(b => b.is_active !== 0))

/* ---- 新建 / 编辑（统一弹窗） ---- */
const formOpen = ref(false)
const formMode = ref('create') // 'create' | 'edit'
const editTarget = ref(null)
const editForm = reactive({ name: '', manufacturer: '', tier: '', credit_code: '', website: '', contact_info: '', description: '' })

/* ---- 停用 ---- */
const disableOpen = ref(false)
const disableTarget = ref(null)

function canonicalOf(p) { return (p._canonical || '').trim() || p.raw_name }

async function loadBrands() {
  loading.value = true
  try {
    const d = await api('/api/brands?include_inactive=1')
    brands.value = Array.isArray(d) ? d : []
  } catch (e) { toast(e.message || '加载品牌失败', 'err') }
  finally { loading.value = false }
}

async function loadPending() {
  pendingLoading.value = true
  try {
    const d = await api('/api/brands/pending')
    pending.value = (Array.isArray(d) ? d : []).map(p => ({ ...p, _canonical: '', _mergeTarget: '' }))
  } catch (e) { toast(e.message || '加载待审品牌失败', 'err') }
  finally { pendingLoading.value = false }
}

function openCreate() {
  editTarget.value = null
  editForm.name = ''
  editForm.manufacturer = ''
  editForm.tier = ''
  editForm.credit_code = ''
  editForm.website = ''
  editForm.contact_info = ''
  editForm.description = ''
  formMode.value = 'create'
  formOpen.value = true
}

function openEdit(b) {
  editTarget.value = b
  editForm.name = b.name || ''
  editForm.manufacturer = b.manufacturer || ''
  editForm.tier = b.tier || ''
  editForm.credit_code = b.credit_code || ''
  editForm.website = b.website || ''
  editForm.contact_info = b.contact_info || ''
  editForm.description = b.description || ''
  formMode.value = 'edit'
  formOpen.value = true
}

async function saveForm() {
  const f = editForm
  if (!f.name.trim()) { toast('请输入品牌名称', 'err'); return }
  const body = {
    name: f.name.trim(),
    manufacturer: f.manufacturer || undefined,
    tier: f.tier || undefined,
    credit_code: f.credit_code || undefined,
    website: f.website || undefined,
    contact_info: f.contact_info || undefined,
    description: f.description || undefined,
  }
  try {
    if (formMode.value === 'create') {
      await api('/api/brands', { method: 'POST', body })
      toast('已添加品牌', 'ok')
    } else {
      await api('/api/brands/' + editTarget.value.id, { method: 'PUT', body })
      toast('已保存', 'ok')
    }
    formOpen.value = false
    loadBrands()
  } catch (e) { toast(e.message || '保存失败', 'err') }
}

function askDisable(b) { disableTarget.value = b; disableOpen.value = true }
async function confirmDisable() {
  const b = disableTarget.value
  disableOpen.value = false
  await brandToggle(b.id, 0)
}
async function brandToggle(bid, val) {
  try {
    await api('/api/brands/' + bid + '/toggle', { method: 'POST', body: { is_active: val } })
    toast(val ? '已启用品牌' : '已停用品牌', 'ok')
    loadBrands()
  } catch (e) { toast(e.message || '操作失败', 'err') }
}

/* ---- 待审处理 ---- */
async function resolve(p, action) {
  try {
    const body = { action }
    if (action === 'create') body.target_name = canonicalOf(p)
    if (action === 'merge') body.target_name = p._mergeTarget
    const r = await api('/api/brands/pending/' + p.id + '/resolve', { method: 'POST', body })
    const msg = action === 'dismiss' ? '已忽略' : ('已归一为「' + (r?.canonical || canonicalOf(p)) + '」，商品已改挂')
    toast(msg, 'ok')
    loadPending()
    loadBrands()
  } catch (e) { toast(e.message || '处理失败', 'err') }
}

onMounted(() => {
  loadBrands()
  loadPending()
})
</script>

<style scoped>
.page-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}

.ba-panel{padding:18px;margin-bottom:14px}
.ba-tip{font-size:12.5px;color:var(--t2);margin:4px 0 14px;line-height:1.7}
.tag{font-size:11.5px;padding:3px 10px;border-radius:10px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.tag.info{background:rgba(var(--p-rgb,6,182,212),.12);color:var(--p)}
.tag.warn{background:rgba(var(--war-rgb),.12);color:var(--war)}

.ba-add-row{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.ba-ops{white-space:nowrap}
.ba-ops .btn{margin-left:6px}

.ba-stopped-tag{display:inline-block;margin-left:6px;font-size:11px;padding:1px 7px;border-radius:8px;background:#e5e7eb;color:#6b7280}
.ba-status{font-size:12px;padding:2px 8px;border-radius:8px;background:var(--bg2);color:var(--t3)}
.ba-status.on{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.ba-status.off{background:rgba(var(--t3-rgb,156,163,175),.14);color:var(--t3)}
.tbl tbody tr.stopped td{color:var(--t3);background:var(--bg2)}

/* 待审 */
.ba-pending-list{display:flex;flex-direction:column;gap:10px}
.ba-pending-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border:1px solid var(--bd);border-radius:12px;flex-wrap:wrap}
.ba-pending-info{min-width:0}
.ba-pending-name{font-size:14px;font-weight:600;color:var(--t1);display:flex;align-items:center;gap:8px}
.ba-ref{font-size:11px;font-weight:400;color:var(--war);background:rgba(var(--war-rgb),.1);padding:1px 7px;border-radius:7px}
.ba-pending-meta{font-size:11.5px;color:var(--t3);margin-top:4px;display:flex;gap:14px;flex-wrap:wrap}
.ba-pending-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ba-canonical{height:30px}
.ba-merge{height:30px}

/* 弹窗 */
.ba-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.ba-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(460px,92vw);background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.ba-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.ba-modal-hd b{font-size:15px;color:var(--t1)}
.ba-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.ba-modal-body{padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}
.ba-field{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--t2)}
.ba-field-wide{grid-column:1 / -1}
.ba-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}

.btn.danger{color:var(--dan)}
.btn-danger{background:var(--dan);color:#fff;border:none}
.btn-danger:hover{filter:brightness(.95)}
.warn-text{color:var(--dan);font-weight:500}

.state-empty{font-size:13px;color:var(--t3);text-align:center;padding:22px 0}
</style>
