<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>仓库档案</h2>
        <span class="page-sub">内部仓主档</span>
      </div>
      <div class="wh-hd-right">
        <!-- v335 按钮级门禁：新建 = POST /api/warehouses/full ⇒ 模块 stock / 动作 create -->
        <button v-if="canDo('stock', 'create')" class="btn btn-primary btn-sm" @click="openCreate">＋ 新建仓库</button>
      </div>
    </div>

    <div class="card df-panel">
      <div class="panel-hd df-ph">
        <b>仓库列表</b>
        <span class="tag info">共 {{ rows.length }} 个仓</span>
      </div>

      <!-- 无权限：显式说明，绝不显示成"空列表" —— 空表会被读成"我一个仓都没有"，
           而真相是"这个账号看不到"（本项目反复在修的"假"）。 -->
      <div v-if="denied" class="state-empty">
        当前账号没有「仓库」权限，看不到仓库档案。<br>
        请联系管理员在「设置 → 权限」里为该角色勾选「库存」模块。
      </div>
      <div v-else-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="rows.length" class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th class="seq-th">序号</th><th>仓库名称</th><th>地址</th><th>联系人</th><th>联系电话</th><th>角色</th><th></th>
          </tr></thead>
          <tbody>
            <tr v-for="(w, i) in rows" :key="w.id">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>
                {{ w.name }}
                <span class="wh-id">DB{{ w.id }}</span>
              </td>
              <td>{{ w.address || '—' }}</td>
              <td>{{ w.contact_name || '—' }}</td>
              <td>{{ w.contact_phone || '—' }}</td>
              <td>
                <span v-if="Number(w.is_default) === 1" class="tag ok">默认仓</span>
                <span v-else class="wh-muted">普通仓</span>
              </td>
              <td class="wh-ops">
                <!-- v335 按钮级门禁：编辑=PUT /api/warehouses/full/{id} ⇒ stock/update；
                     删除=DELETE 同路径 ⇒ stock/delete（弹窗内的「保存」不再重复判 —— 入口已藏） -->
                <button v-if="canDo('stock', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(w)">编辑</button>
                <button
                  v-if="canDo('stock', 'delete')"
                  class="btn btn-ghost btn-sm danger"
                  :disabled="Number(w.is_default) === 1"
                  :title="Number(w.is_default) === 1 ? '默认仓不能删除' : '删除该仓库'"
                  @click="askDelete(w)"
                >删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">还没有仓库档案，先新建一个（如「总仓」「刘小顶仓」）</div>

      <p class="df-tip" style="margin-top:14px">
        仓库在这里统一维护，下游三处引用它：
        <b>员工档案 → 个人仓</b>（该员工报「本人仓」调拨单时的目标仓）、
        <b>报单配置 → 源仓 / 目标仓</b>（舟谱调拨单的调出仓与调入仓）、
        <b>库存 / 调拨</b>。
      </p>
    </div>

    <!-- 新建 / 编辑 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="editOpen" class="df-overlay" @click="editOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="editOpen" class="df-modal">
          <div class="df-modal-hd">
            <b>{{ isCreate ? '新建仓库' : ('编辑仓库 · ' + (editTarget?.name || '')) }}</b>
            <button class="df-x" @click="editOpen = false" aria-label="关闭"><Icon name="close"/></button>
          </div>
          <div class="df-modal-body">
            <label class="df-field"><span>仓库名称 <i class="req">*</i></span><input v-model="form.name" class="input" placeholder="如 刘小顶仓"></label>
            <label class="df-field"><span>地址</span><input v-model="form.address" class="input"></label>
            <label class="df-field"><span>联系人</span><input v-model="form.contact_name" class="input"></label>
            <label class="df-field"><span>联系电话</span><input v-model="form.contact_phone" class="input"></label>
            <label v-if="isCreate" class="df-check">
              <input type="checkbox" v-model="form.is_default"> 设为默认仓
            </label>
            <p class="df-tip">
              仓名会直接出现在报单模板里，<b>建议用真实叫法</b>（如「刘小顶仓」），
              不要写成「仓库1」—— 下游对账时要靠它认人。
            </p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="editOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 删除确认 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="delOpen" class="df-overlay" @click="delOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="delOpen" class="df-modal">
          <div class="df-modal-hd"><b>删除仓库</b><button class="df-x" @click="delOpen = false" aria-label="关闭"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip">确认删除「<b>{{ delTarget?.name }}</b>」？此操作不可撤销。</p>
            <p class="df-tip df-warn">
              若该仓已被引用（员工个人仓 / 报单配置的源仓目标仓 / 库存），
              请先把引用改到别的仓 —— 否则这些配置会指向一个不存在的仓。
            </p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="delOpen = false">取消</button>
            <button class="btn btn-ghost danger" :disabled="busy" @click="doDelete">{{ busy ? '删除中…' : '确认删除' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, reactive, onMounted } from 'vue'
import { toast, canDo } from '../store'
import { warehouseApi } from '../api/modules'

const rows = ref([])
const loading = ref(false)
const denied = ref(false)

const editOpen = ref(false)
const isCreate = ref(true)
const editTarget = ref(null)
const form = reactive({ name: '', address: '', contact_name: '', contact_phone: '', is_default: false })

const delOpen = ref(false)
const delTarget = ref(null)
const busy = ref(false)

async function load() {
  loading.value = true
  denied.value = false
  try {
    rows.value = await warehouseApi.list() || []
  } catch (e) {
    // 403 = 当前角色没勾「库存」模块。这与"真的一行都没有"必须分开呈现，
    // 否则老板会以为自己刚建的仓丢了。
    const msg = String((e && e.message) || '')
    if (/403|权限|无权/.test(msg)) { denied.value = true; rows.value = [] }
    else toast(msg || '加载仓库失败', 'err')
  } finally { loading.value = false }
}

function openCreate() {
  isCreate.value = true
  editTarget.value = null
  Object.assign(form, { name: '', address: '', contact_name: '', contact_phone: '', is_default: false })
  editOpen.value = true
}

function openEdit(w) {
  isCreate.value = false
  editTarget.value = w
  Object.assign(form, {
    name: w.name || '',
    address: w.address || '',
    contact_name: w.contact_name || '',
    contact_phone: w.contact_phone || '',
    is_default: Number(w.is_default) === 1,
  })
  editOpen.value = true
}

async function save() {
  const name = String(form.name || '').trim()
  if (!name) { toast('请填写仓库名称', 'err'); return }
  busy.value = true
  try {
    if (isCreate.value) {
      await warehouseApi.create({
        name,
        address: form.address || '',
        contact_name: form.contact_name || '',
        contact_phone: form.contact_phone || '',
        is_default: form.is_default ? 1 : 0,
      })
      toast('已新建仓库', 'ok')
    } else {
      // ⚠️ 这里**原样发送**每个字段（含空串）：后端 v294 起把「空串」当作"清空"，
      // 若像别处那样写成 `form.address || undefined`，删掉地址就永远存不下去。
      await warehouseApi.update(editTarget.value.id, {
        name,
        address: form.address || '',
        contact_name: form.contact_name || '',
        contact_phone: form.contact_phone || '',
      })
      toast('已保存', 'ok')
    }
    editOpen.value = false
    await load()
  } catch (e) { toast((e && e.message) || '保存失败', 'err') }
  finally { busy.value = false }
}

function askDelete(w) { delTarget.value = w; delOpen.value = true }

async function doDelete() {
  const w = delTarget.value
  busy.value = true
  try {
    await warehouseApi.remove(w.id)
    toast('已删除', 'ok')
    delOpen.value = false
    await load()
  } catch (e) {
    // 后端的拒绝是有理由的（默认仓 / 仓里还有库存）—— 原样透出，别改成"删除失败"
    toast((e && e.message) || '删除失败', 'err')
  } finally { busy.value = false }
}

onMounted(load)
</script>

<style scoped>
.wh-hd-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
.df-panel{padding:18px;margin-bottom:14px}
.df-tip{font-size:12.5px;color:var(--t2);margin:4px 0 14px;line-height:1.7}
.df-warn{color:var(--war);background:rgba(var(--war-rgb),.08);padding:8px 12px;border-radius:8px;font-size:12px}

/* 仓号（DB3）：与报单配置里的「本人仓」标识同源，方便对账时口头引用 */
.wh-id{display:inline-block;margin-left:6px;font-size:11px;padding:1px 6px;border-radius:6px;background:var(--bg2);color:var(--t3);font-variant-numeric:tabular-nums}
.wh-muted{font-size:12px;color:var(--t3)}
.wh-ops{white-space:nowrap}
.tag.ok{background:rgba(var(--suc-rgb),.12);color:var(--suc)}

.df-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);cursor:pointer}
.df-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--t2)}
.df-field .req{color:var(--err);font-style:normal}

.df-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.df-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(460px,92vw);background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.df-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.df-modal-hd b{font-size:15px;color:var(--t1)}
.df-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.df-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}
.df-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
</style>
