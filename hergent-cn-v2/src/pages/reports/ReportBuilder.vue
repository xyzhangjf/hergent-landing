<template>
  <div class="rp-builder">
    <div v-if="loading" class="rp-state">报表定义加载中…</div>
    <div v-else-if="err" class="rp-state rp-err"><Icon name="alert-triangle" :size="18" /><span>{{ err }}</span></div>

    <div v-else-if="def" class="rp-bwrap">
      <div class="rp-head">
        <h2>报表设计器 · {{ def.title || name }}</h2>
        <span class="rp-kind" :class="def.kind">{{ def.kind }}</span>
      </div>

      <div v-if="!isBoss" class="rp-warn">
        🔒 报表口径修改仅老板账号可用（改口径 = 改所有人看到的数的口径）。后端已二次拦截。以下为只读视图。
      </div>

      <div class="card rp-form">
        <label class="rp-lbl">报表标题</label>
        <input class="ipt" v-model="title" :disabled="!isBoss" />

        <label class="rp-lbl">口径说明（note，展示给看报表的人）</label>
        <textarea class="ipt ta" v-model="note" rows="2" :disabled="!isBoss" />

        <template v-if="def.kind === 'unavailable'">
          <label class="rp-lbl">未启用原因（必填）</label>
          <textarea class="ipt ta" v-model="reason" rows="2" :disabled="!isBoss" />
        </template>

        <template v-else>
          <label class="rp-lbl">SQL（只读连接执行；只能 SELECT/WITH，禁止写与敏感表）</label>
          <textarea class="ipt ta mono" v-model="sql" rows="10" :disabled="!isBoss" />
        </template>

        <template v-if="isBoss">
          <div class="rp-actions">
            <button class="btn btn-ghost" :disabled="busy" @click="doPreview">试算（校验 + 试跑）</button>
            <button class="btn btn-primary" :disabled="busy" @click="doSave">保存</button>
          </div>
        </template>
        <div v-if="msg" class="rp-msg" :class="msgCls">{{ msg }}</div>
      </div>

      <div class="card rp-readonly">
        <div class="rp-lbl">列定义（columns，只读）</div>
        <pre class="rp-pre">{{ pretty(def.columns) }}</pre>
        <div class="rp-lbl">筛选项（filters，只读）</div>
        <pre class="rp-pre">{{ pretty(def.filters) }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { reportEngineApi } from '../../api/modules'
import { auth } from '../../api/client'
import Icon from '../../components/Icon.vue'

const route = useRoute()
const name = route.params.name || route.meta.reportName || ''
const isBoss = !!(auth.user && (
  auth.user.role === 'boss' || auth.user.role === 'admin' ||
  (auth.user.roles || []).includes('boss') || (auth.user.roles || []).includes('admin')
))

const def = ref(null)
const err = ref('')
const loading = ref(false)
const title = ref('')
const note = ref('')
const reason = ref('')
const sql = ref('')
const busy = ref(false)
const msg = ref('')
const msgCls = ref('')

function pretty(v) {
  try { return JSON.stringify(v, null, 2) } catch (e) { return String(v) }
}

function buildBody() {
  const body = {
    kind: def.value.kind || 'sql',
    title: title.value,
    note: note.value,
    sql: sql.value,
    columns: def.value.columns || [],
    filters: def.value.filters || [],
    total_row: def.value.total_row || [],
    add_total_row: def.value.add_total_row ? 1 : 0,
    chart: def.value.chart || null,
  }
  if (body.kind === 'unavailable') body.reason = reason.value
  return body
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    const [d, raw] = await Promise.all([
      reportEngineApi.getDef(name),
      isBoss ? reportEngineApi.getRaw(name).catch(() => ({})) : Promise.resolve({}),
    ])
    def.value = d
    title.value = d.title || ''
    note.value = d.note || ''
    reason.value = d.reason || ''
    sql.value = (raw && raw.sql) ? raw.sql : (d.sql || '')
  } catch (e) {
    err.value = (e && e.message) ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function setMsg(text, cls) { msg.value = text; msgCls.value = cls }

async function doPreview() {
  busy.value = true; setMsg('', '')
  try {
    const res = await reportEngineApi.preview(buildBody())
    if (res && res.columns) {
      setMsg('试算通过：返回 ' + (res.row_count != null ? res.row_count : (res.returned || 0)) + ' 行。可保存。', 'ok')
    } else {
      setMsg('试算通过。', 'ok')
    }
  } catch (e) {
    setMsg('试算失败：' + ((e && e.message) || '未知错误'), 'bad')
  } finally { busy.value = false }
}

async function doSave() {
  busy.value = true; setMsg('', '')
  try {
    const res = await reportEngineApi.save(name, buildBody())
    setMsg('已保存（is_seed 置 0，后续 patch 不会覆盖）。', 'ok')
    if (res && res.title != null) { def.value = res; title.value = res.title || ''; note.value = res.note || '' }
  } catch (e) {
    setMsg('保存失败：' + ((e && e.message) || '未知错误'), 'bad')
  } finally { busy.value = false }
}

onMounted(load)
</script>

<style scoped>
.rp-builder { padding: 16px; max-width: 920px; margin: 0 auto; }
.rp-state { padding: 28px; text-align: center; color: #6b7280; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.rp-state.rp-err { color: #dc2626; }
.rp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.rp-head h2 { margin: 0; font-size: 18px; }
.rp-kind { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: #eef2ff; color: #4338ca; }
.rp-kind.unavailable { background: #fef2f2; color: #b91c1c; }
.rp-form, .rp-readonly { padding: 16px; margin-bottom: 12px; }
.rp-lbl { display: block; font-size: 12px; color: #6b7280; margin: 12px 0 4px; }
.rp-lbl:first-child { margin-top: 0; }
.ipt { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; font-size: 13px; box-sizing: border-box; }
.ta { resize: vertical; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.rp-actions { display: flex; gap: 10px; margin-top: 14px; }
.rp-msg { margin-top: 12px; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.rp-msg.ok { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.rp-msg.bad { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
.rp-pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; font-size: 12px; overflow-x: auto; max-height: 320px; }
.rp-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
.btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.btn-ghost { background: #fff; }
.btn:disabled { opacity: 0.6; cursor: default; }
</style>
