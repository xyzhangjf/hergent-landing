<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>供应商档案</h2>
        <span class="page-sub">管理供应商 / 厂家主档 —— 支持<b>逐笔新建</b>与外部 ERP 同步</span>
      </div>
      <div class="sup-actions">
        <span class="sup-stat" v-if="total !== null"><b>{{ total }}</b>&nbsp;家供应商</span>
        <span class="sup-sync" :class="connState">{{ connLabel }}</span>
        <!-- v335 按钮级门禁：本页写入口的接口都归后端模块 **data**（`/api/contacts`、
             `/api/datasources`）—— 注意**不是**页面注册表里的模块名本身，两回事：
              同步=POST /api/datasources/v2/*/sync ⇒ create
              新增供应商=POST /api/contacts            ⇒ create -->
        <button v-if="canDo('data', 'create')" class="btn btn-ghost btn-sm" :disabled="syncBusy" @click="onSync">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          {{ syncBusy ? '同步中…' : '同步 ERP' }}
        </button>
        <button v-if="canDo('data', 'create')" class="btn btn-primary btn-sm" @click="openAdd">+ 新增供应商</button>
      </div>
    </div>

    <div class="card sup-panel">
      <div class="sup-filters">
        <div class="sup-search">
          <svg class="sup-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input v-model="keyword" class="input sup-kw" placeholder="供应商名称 / 编码 / 助记码 / 电话" @input="onFilterChange">
        </div>
        <!-- 刻意**不**放「供应商类别」筛选下拉：生产 tenant_1 的 38 家供应商里该列只有 2 家有值
             （同一个值），筛下去只剩 1~2 行 —— 那就是一个"点了几乎恒空"的假控件。
             等这条数据被填起来（本页正是干这个的）再加，一行 `<select>` 的事。 -->
        <button class="btn btn-ghost btn-sm" @click="resetFilters">重置</button>
      </div>

      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="items.length" class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <!-- 列的选择标准：**生产真有值的才放**（tenant_1 实测 38 家）——
                   对接人 38/38（16 个不同值）、电话 38/38（35 个不同值）⇒ 放；
                   开户行 / 银行账号各只有 3 家、营业执照号 0 家、备注 3 家 ⇒ **不放**，
                   它们只在编辑弹窗里（放上去就是 35/38 行显示「—」的噪音列；
                   且银行账号是加密列，不该默认铺在列表上）。 -->
              <th class="seq-th">序号</th><th>供应商名称</th><th>供应商类别</th><th>对接人</th><th>电话</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in items" :key="c.id">
              <td class="seq-cell"><span class="seq-num">{{ (page - 1) * pageSize + i + 1 }}</span></td>
              <td class="sup-name">{{ c.name }}</td>
              <td>{{ c.supplier_category || '—' }}</td>
              <td>{{ c.contact_person || '—' }}</td>
              <td class="sup-phone">{{ c.phone || '—' }}</td>
              <td class="sup-ops">
                <!-- v335 按钮级门禁：编辑 = PUT /api/contacts/{id} ⇒ data/update
                     （弹窗里的「保存」不再重复判 —— 入口已藏就进不去） -->
                <button v-if="canDo('data', 'update')" class="btn btn-ghost btn-sm" @click="openEdit(c)">编辑</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="sup-pager" v-if="total > pageSize">
          <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <span class="sup-pageinfo">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 家供应商</span>
          <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          <select v-model="pageSize" class="input sup-size" @change="onPageSizeChange">
            <option :value="20">20 / 页</option>
            <option :value="50">50 / 页</option>
            <option :value="100">100 / 页</option>
          </select>
        </div>
      </div>
      <div v-else class="state-empty">
        {{ keyword ? '没有匹配的供应商，换个关键词试试' : '还没有供应商档案 —— 点右上角「+ 新增供应商」录入第一家' }}
      </div>
    </div>

    <Teleport to="body">
      <!-- 新增 / 编辑供应商。UI-SPEC §4.1 五条（全站尚无统一 Modal 组件，各页自建）：
           ① role/aria-modal/aria-labelledby ② tabindex=-1 + 打开后焦点移入
           ③ Esc 关闭 ④ 有未保存改动时不得直接关闭（走内联二次确认）
           ⑤ 结构 hd / body / ft -->
      <Transition name="fade"><div v-if="formOpen" class="sup-overlay" @click="tryClose"></div></Transition>
      <Transition name="pop">
        <div v-if="formOpen" ref="modalRef" class="sup-modal" role="dialog" aria-modal="true"
             aria-labelledby="sup-modal-title" tabindex="-1" @keydown.esc.stop="tryClose">
          <div class="sup-modal-hd">
            <b id="sup-modal-title">{{ editTarget ? '编辑供应商' : '新增供应商' }}</b>
            <button class="sup-x" aria-label="关闭" @click="tryClose"><Icon name="close"/></button>
          </div>
          <div class="sup-modal-body">
            <p class="sup-tip">
              只摆真实在用的字段；点「更多字段」可填编码 / 营业执照号 / 付款账期等。
              <template v-if="editTarget">没改动的项目会<b>保持原样</b>，不会被动到。</template>
            </p>
            <!-- 主区 = 3 行两列 + 2 行通栏，**恰好填满、零留白**。
                 （客户档案弹窗第 7 格右留白那个遗留，就是没按"格数 = 双数列"排造成的。） -->
            <div class="sup-form">
              <label class="sup-f"><span>供应商名称 <i aria-hidden="true">*</i></span>
                <input v-model="form.name" class="input" :class="{ err: nameErr }"
                       placeholder="必填，如「蒙牛低温奶事业部」" aria-required="true"
                       :aria-invalid="nameErr ? 'true' : 'false'"
                       aria-describedby="sup-name-err" @input="nameErr = false"></label>
              <label class="sup-f"><span>供应商类别 <em>选已有或手填</em></span>
                <input v-model="form.supplier_category" class="input" list="sup-cat-list" placeholder="如 常温奶 / 包装物"></label>
              <label class="sup-f"><span>对接人</span>
                <input v-model="form.contact_person" class="input" placeholder="如 王经理"></label>
              <label class="sup-f"><span>联系电话</span>
                <input v-model="form.phone" class="input" placeholder="对接人手机 / 座机"></label>
              <label class="sup-f"><span>开户行</span>
                <input v-model="form.bank_name" class="input" placeholder="如 中国银行襄阳分行"></label>
              <label class="sup-f"><span>银行账号 <em>加密存储</em></span>
                <input v-model="form.bank_account" class="input" placeholder="对公账号"></label>
              <label class="sup-f sup-f-full"><span>地址</span>
                <input v-model="form.address" class="input" placeholder="供应商地址"></label>
              <label class="sup-f sup-f-full"><span>备注</span>
                <textarea v-model="form.note" class="input sup-ta" placeholder="选填"></textarea></label>
            </div>
            <p v-if="nameErr" id="sup-name-err" class="field-err" role="alert">请填写供应商名称</p>

            <button class="sup-more" @click="showMore = !showMore">
              {{ showMore ? '收起更多字段' : '更多字段（选填）' }}
              <span class="sup-caret">{{ showMore ? '▲' : '▼' }}</span>
            </button>
            <div v-if="showMore" class="sup-form sup-form-more">
              <label class="sup-f"><span>编码 <em>留空即可</em></span>
                <input v-model="form.code" class="input" placeholder="一般不填"></label>
              <label class="sup-f"><span>助记码 <em>用于快速搜索</em></span>
                <input v-model="form.mnemonic" class="input" placeholder="如 MNRY"></label>
              <!-- 结算方式用「输入 + 已有值补全」而不是固定下拉：与后端 v316 定的口径一致
                   （`contacts.channel` 当年被固定 6 项逼出 12 种同义不同字的业态，代价已付过）。
                   给供应商固定「现结 / 赊账」两项也会造出"现实塞回格子"的同一个毛病。 -->
              <label class="sup-f"><span>结算方式 <em>选已有或手填</em></span>
                <input v-model="form.settlement_method" class="input" list="sup-settle-list" placeholder="如 现结 / 月结"></label>
              <label class="sup-f"><span>付款账期（天）<em>我们多久付一次</em></span>
                <input v-model="form.credit_days" class="input" type="text" inputmode="numeric" placeholder="0 = 货到即付"></label>
              <label class="sup-f"><span>营业执照号</span>
                <input v-model="form.business_license" class="input" placeholder="统一社会信用代码"></label>
              <label class="sup-f"><span>税号</span>
                <input v-model="form.tax_id" class="input" placeholder="开票用，一般同执照号"></label>
            </div>
          </div>
          <div class="sup-modal-ft">
            <span v-if="closeHint" class="sup-hint" role="alert">有未保存的改动 —— 再点一次就关闭，不会保存</span>
            <button class="btn btn-ghost" @click="onCancel">{{ cancelLabel }}</button>
            <button class="btn btn-primary" :disabled="formSaving" @click="saveForm">{{ formSaving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>

      <!-- 未连接提醒 -->
      <Transition name="fade"><div v-if="remindOpen" class="sup-overlay" @click="remindOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="remindOpen" class="sup-modal" role="dialog" aria-modal="true" aria-labelledby="sup-remind-title">
          <div class="sup-modal-hd">
            <b id="sup-remind-title">尚未连接 ERP</b>
            <button class="sup-x" aria-label="关闭" @click="remindOpen = false"><Icon name="close"/></button>
          </div>
          <div class="sup-modal-body">
            <p class="sup-tip">「同步」需要先把你的 ERP（畅捷通 / 金蝶）接入 Hergent。</p>
            <p class="sup-tip">请前往 <b>AI 引擎 › 连接器</b> 完成授权连接后，再来点「同步」。</p>
            <p class="sup-tip">还没接 ERP 也没关系 —— 用上面的「+ 新增供应商」先把供应商录进来。</p>
          </div>
          <div class="sup-modal-ft">
            <button class="btn btn-ghost" @click="remindOpen = false">知道了</button>
            <button class="btn btn-primary" @click="goConnect">去 AI 引擎</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 表单字段的「已有值」候选（datalist）：选项来自后端现取，不是前端硬编码 -->
    <datalist id="sup-cat-list"><option v-for="v in catOptions" :key="'sc' + v" :value="v"></option></datalist>
    <datalist id="sup-settle-list"><option v-for="v in settleOptions" :key="'ss' + v" :value="v"></option></datalist>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { toast, canDo } from '../store'
/* v291：页内跳转入口同判据（见 goConnect）。 */
import { canSee } from '../constants/pages'

const router = useRouter()

/* ---- 列表 ---- */
const items = ref([])
const total = ref(null)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const keyword = ref('')
const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageSize.value)))

/* ---- 表单的「已有值」候选 ---- */
const catOptions = ref([])
const settleOptions = ref([])

/* ---- ERP 同步 ---- */
const chanjetLinked = ref(false)
const kingdeeLinked = ref(false)
const syncBusy = ref(false)
const remindOpen = ref(false)
const connState = computed(() => (chanjetLinked.value || kingdeeLinked.value) ? 'linked' : 'unlinked')
const connLabel = computed(() => {
  if (chanjetLinked.value && kingdeeLinked.value) return '畅捷通 + 金蝶 已连接'
  if (chanjetLinked.value) return '畅捷通 已连接'
  if (kingdeeLinked.value) return '金蝶 已连接'
  return '未连接 ERP'
})

/* ---- 新增 / 编辑 ---- */
/* 表单字段清单 = 提交白名单的**唯一来源**（校验、diff、新建三条路都读它）。
   🔴 后端 `contact_create` / `contact_update` **各有自己的 allowed 白名单**；
      两边不对齐就是「填了不生效、零报错」那一族缺陷（v316 修过一次，v387 又修过一次：
      `bank_name`/`bank_account`/`supplier_category`/`business_license` 四列当时
      **只在 `contact_update` 里、不在 `contact_create` 里**）。
      往这里加字段时，**必须同时确认那两个白名单里有它** ——
      护栏脚本：`tools/v387-form-whitelist-align.py`（本清单 ↔ 两个白名单逐字段比对）。
   ⚠️ 刻意**不含** `credit_limit`（信用额度）：那是"我们给客户赊多少"的客户侧概念，
      供应商侧没有对应业务含义（计划 §三·1.2「去掉信用/账期」）。
      `credit_days` 保留了，但**降级放进「更多字段」**并改文案为「付款账期（天）」——
      理由：生产 38 家供应商该列**全部有值**（舟谱导入），若整条去掉，
      老板发现某个供应商账期填错了将**没有任何入口**能改 = 又一个"填了改不了"。 */
const FORM_FIELDS = ['name', 'supplier_category', 'contact_person', 'phone',
                     'bank_name', 'bank_account', 'address', 'note',
                     'code', 'mnemonic', 'settlement_method', 'credit_days',
                     'business_license', 'tax_id']
const NUM_FIELDS = ['credit_days']
const formOpen = ref(false)
const formSaving = ref(false)
const showMore = ref(false)
const editTarget = ref(null)
const form = ref({})
const baseline = ref({})
const modalRef = ref(null)
const nameErr = ref(false)
const closeHint = ref(false)

/* 未保存改动的判据 —— 同时服务三件事：关闭二次确认、取消按钮文案、遮罩点击拦截。
   🔴 口径必须与 `saveForm` 的 diff 口径**完全一致**（都走 `normVal`），
      否则会出现"提示说没改动、其实有"或反之。 */
const isDirty = computed(() => {
  const f = form.value || {}
  const b = baseline.value || {}
  if (!editTarget.value) {
    // 新建：任意一个字段非空就算有改动
    return FORM_FIELDS.some(k => normVal(k, f[k]) !== '')
  }
  return FORM_FIELDS.some(k => normVal(k, f[k]) !== b[k])
})
const cancelLabel = computed(() => (isDirty.value || closeHint.value) ? '放弃改动' : '取消')

/* 数值归一化：中文输入法常打出**全角数字**（１２３）与中文标点（。、，）。
   先 NFKC 折半角，再把「。」当小数点、「、」「，」当千分位去掉 —— 与站内数字格同一套规则。
   ⚠️ 本项目数字格的病根在**输入层**：用 `type=number` 时浏览器会直接吞掉这些字符，
      用户看到的是「打了没反应」，所以这里用 `type=text + inputmode=numeric`。 */
function numNorm(v) {
  let s = String(v ?? '').trim()
  if (!s) return ''
  s = s.normalize('NFKC').replace(/。/g, '.').replace(/[、，,]/g, '')
  const n = Number(s)
  return isFinite(n) ? n : ''
}
function normVal(k, v) {
  if (NUM_FIELDS.includes(k)) return numNorm(v)
  return String(v ?? '').trim()
}

async function loadList() {
  loading.value = true
  try {
    const q = ['type=supplier',                     // 🔴 必须显式传：不传会把 702 个客户 + 14 个员工一起列出来
               'limit=' + pageSize.value,
               'offset=' + ((page.value - 1) * pageSize.value)]
    if (keyword.value) q.push('keyword=' + encodeURIComponent(keyword.value))
    const d = await api('/api/contacts?' + q.join('&'))
    items.value = d.items || []
    total.value = d.total || 0
  } catch (e) { toast(e.message || '加载供应商失败', 'err') }
  finally { loading.value = false }
}

async function loadOptions() {
  try {
    const d = await api('/api/contacts/options?type=supplier')
    const o = (d && d.options) || {}
    catOptions.value = o.supplier_category || []
    settleOptions.value = o.settlement_method || []
  } catch (e) { /* 候选是增强项，失败不影响主流程 */ }
}

let _t = null
function onFilterChange() {
  clearTimeout(_t)
  _t = setTimeout(() => { page.value = 1; loadList() }, 250)
}
function resetFilters() { keyword.value = ''; page.value = 1; loadList() }
function goPage(p) { if (p < 1 || p > totalPages.value) return; page.value = p; loadList() }
function onPageSizeChange() { page.value = 1; loadList() }

function blankForm() {
  const f = {}
  for (const k of FORM_FIELDS) f[k] = ''
  return f
}
function openAdd() {
  editTarget.value = null
  form.value = blankForm()
  baseline.value = {}
  showMore.value = false
  formSaving.value = false
  nameErr.value = false
  closeHint.value = false
  formOpen.value = true
}
function openEdit(c) {
  editTarget.value = c
  const f = {}
  for (const k of FORM_FIELDS) f[k] = c[k] == null ? '' : String(c[k])
  form.value = f
  baseline.value = { ...f }        // 编辑走 diff：基线就是"打开时看到的值"
  showMore.value = false
  formSaving.value = false
  nameErr.value = false
  closeHint.value = false
  formOpen.value = true
}

/* ---- 关闭（UI-SPEC §4.1-④：有未保存改动不得直接关闭） ---- */
function tryClose() {
  if (formSaving.value) return                 // 保存中不许关，避免"关掉了但其实写进去了"
  if (isDirty.value) { closeHint.value = true; return }   // 内联二次确认：再点一次才关
  formOpen.value = false
}
function onCancel() {
  if (formSaving.value) return
  if (isDirty.value && !closeHint.value) { closeHint.value = true; return }
  formOpen.value = false
}

/* 打开后把焦点移入弹窗（§4.1-③）—— 否则 Esc 监听不到、键盘用户拿不到焦点。 */
watch(formOpen, async (v) => {
  if (!v) return
  await nextTick()
  try { modalRef.value && modalRef.value.focus() } catch (e) { /* 忽略 */ }
})

async function saveForm() {
  const f = form.value
  nameErr.value = false
  if (!String(f.name || '').trim()) {
    // §4「错误」：字段级呈现优先，toast 只作兜底、不能是唯一呈现
    nameErr.value = true
    toast('请填写供应商名称', 'err')
    return
  }
  formSaving.value = true
  try {
    if (editTarget.value) {
      // **只提交真的改动过的字段**（与商品/客户编辑弹窗同一范式）：
      // 不整表回传 ⇒ 不误清空、不留假痕迹、并发时不吃掉别人刚改的字段。
      const body = {}
      for (const k of FORM_FIELDS) {
        const nv = normVal(k, f[k])
        if (nv === baseline.value[k]) continue
        if (nv === '' && NUM_FIELDS.includes(k)) continue   // 数字留空 = 不动（不写成 0）
        body[k] = nv
      }
      if (!Object.keys(body).length) { toast('没有改动', 'warn'); formSaving.value = false; return }
      await api('/api/contacts/' + editTarget.value.id, { method: 'PUT', body })
      toast('已保存 ' + Object.keys(body).length + ' 处改动', 'ok')
    } else {
      // 🔴 `type` 必须原样传「供应商」：后端 `POST /api/contacts` 早期把请求体 `**d` 展开，
      //    而 `contact_create` 的形参叫 `contact_type` ⇒ `type` 被白名单丢掉、**恒落 customer**
      //    （v387 修，见 `routers/data.py::create_contact` 的长注释）。这里传的值现在真的生效。
      const body = { name: String(f.name).trim(), type: 'supplier' }
      for (const k of FORM_FIELDS) {
        if (k === 'name') continue
        const nv = normVal(k, f[k])
        if (nv === '') continue
        body[k] = nv
      }
      const r = await api('/api/contacts', { method: 'POST', body })
      toast(r && r.id ? '供应商已新建' : '已提交', 'ok')
    }
    formOpen.value = false
    await Promise.all([loadList(), loadOptions()])
  } catch (e) { toast(e.message || '保存失败', 'err') }
  finally { formSaving.value = false }
}

/* ---- ERP 同步 ---- */
async function probeConnectors() {
  try { const s = await api('/api/datasources/v2/chanjet/status'); chanjetLinked.value = !!s.connected } catch { chanjetLinked.value = false }
  try { const s = await api('/api/datasources/v2/kingdee/status'); kingdeeLinked.value = !!s.connected } catch { kingdeeLinked.value = false }
}
async function onSync() {
  if (!chanjetLinked.value && !kingdeeLinked.value) { remindOpen.value = true; return }
  syncBusy.value = true
  try {
    const jobs = []
    if (chanjetLinked.value) jobs.push(api('/api/datasources/v2/chanjet/sync', { method: 'POST', body: { objects: ['suppliers'] } }))
    if (kingdeeLinked.value) jobs.push(api('/api/datasources/v2/kingdee/sync', { method: 'POST', body: { objects: ['suppliers'] } }))
    await Promise.all(jobs)
    toast('已同步供应商档案', 'ok')
    loadList()
  } catch (e) { toast(e.message || '同步失败', 'err') }
  finally { syncBusy.value = false }
}
function goConnect() {
  /* v291（2026-09-27）：入口同判据 —— 能进档案的人**不一定**能进「AI 引擎」
     （业务员能进档案，但不能进连接器/数据源配置）⇒ 不判就会出现"点了被弹回工作台"（假入口）。
     ⚠️ v311：容器已由「能力中心」更名「AI 引擎」——**提示文案必须跟着改**。 */
  if (!canSee('/connect')) { toast('你没有访问「AI 引擎」的权限', 'warn'); return }
  remindOpen.value = false
  router.push('/connect')
}

onMounted(() => { loadList(); loadOptions(); probeConnectors() })
onBeforeUnmount(() => { clearTimeout(_t) })
</script>

<style scoped>
/* 前缀 sup- = 供应商档案（UI-SPEC §6.1）。
   能走全局层的一律走全局层：.page / .page-hd / .card / .btn* / .input / .table-wrap
   / .tbl / .num / .state-empty / .field-err —— 本页**不重定义**任何一个全局件（§6.2）。 */
.sup-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap}
.sup-stat{font-size:12.5px;color:var(--t2)}
.sup-stat b{font-size:15px;color:var(--t1)}
.sup-sync{font-size:11.5px;padding:3px 10px;border-radius:10px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.sup-sync.linked{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.sup-sync.unlinked{background:rgba(var(--war-rgb),.12);color:var(--war)}

.sup-panel{padding:18px;margin-bottom:14px}
.sup-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.sup-search{position:relative;display:flex;align-items:center;flex:0 1 300px;min-width:180px}
.sup-search-ico{position:absolute;left:10px;width:15px;height:15px;color:var(--t3);pointer-events:none}
.sup-kw{width:100%;padding-left:32px}

.tbl td.sup-name{font-weight:600;color:var(--t1)}
.sup-phone{font-variant-numeric:tabular-nums}
.sup-ops{text-align:right;white-space:nowrap}

.sup-pager{display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}
.sup-pageinfo{font-size:12.5px;color:var(--t2)}
.sup-size{height:30px;width:auto}

/* 弹窗：令牌与结构对齐 UI-SPEC §4.1 / §1.5 / §1.6 / §1.7 */
.sup-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:var(--z-overlay)}
.sup-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(580px,94vw);max-height:88vh;
  display:flex;flex-direction:column;background:var(--bg);border-radius:var(--radius-lg);z-index:var(--z-modal);box-shadow:var(--shadow-lg)}
.sup-modal:focus{outline:none}   /* 弹窗本体不画焦点环；键盘可达性由「焦点移入 + Esc」保证 */
.sup-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.sup-modal-hd b{font-size:15px;color:var(--t1)}
.sup-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.sup-x:hover{color:var(--t1)}
.sup-modal-body{padding:18px 20px;overflow-y:auto}
.sup-modal-ft{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.sup-tip{font-size:12px;color:var(--t2);line-height:1.7;margin:0 0 12px;background:var(--bg2);padding:8px 12px;border-radius:8px}
.sup-hint{font-size:12px;color:var(--war);margin-right:auto}

.sup-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px}
.sup-form-more{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border-subtle)}
.sup-f{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.sup-f>span{display:flex;align-items:baseline;gap:6px}
.sup-f i{color:var(--dan);font-style:normal}
.sup-f em{font-size:11px;color:var(--t3);font-style:normal}
.sup-f .input{height:32px;padding:0 10px}
.sup-f-full{grid-column:1 / -1}
.sup-ta{height:auto;min-height:60px;padding:8px 10px;line-height:1.6;resize:vertical;font-family:inherit}
.sup-more{width:100%;margin-top:12px;padding:8px;border:1px dashed var(--border-subtle);border-radius:8px;
  background:none;color:var(--t2);font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.sup-more:hover{color:var(--p);border-color:var(--p)}
.sup-caret{font-size:10px}

/* 全局过渡类在其它页各自 scoped 定义（ConnectCenter / DataLedger 等）——
   本页若不自带，`<Transition name="fade|pop">` 就是**空转**（无动画、零报错）。 */
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.pop-enter-active,.pop-leave-active{transition:transform .2s ease,opacity .2s ease}
.pop-enter-from,.pop-leave-to{transform:translate(-50%,-48%);opacity:0}

/* UI-SPEC §3.3：表单型页面**必须**有 640px 断点（四个档案页曾全部为 0 个 @media）。 */
@media (max-width:640px){
  .sup-form{grid-template-columns:1fr}
  .sup-modal{width:96vw;max-height:92vh}
  .sup-search{flex:1 1 100%}
}
</style>
