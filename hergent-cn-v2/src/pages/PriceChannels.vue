<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>渠道与价格</h2>
        <span class="page-sub">一个渠道 = 一个下游系统（它自己的一套商品编码 + 一套价格）。你有几个系统就建几条，加渠道不用改代码。</span>
      </div>
      <div class="pc-act">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load"><Icon name="refresh"/> 刷新</button>
        <button class="btn btn-primary btn-sm" @click="openNew"><Icon name="plus"/> 新建渠道</button>
      </div>
    </div>

    <!-- 为什么这些要客户自己配 —— 一句话讲清设计取向，避免用户以为系统"应该"预置 -->
    <div class="pc-why">
      <b>为什么渠道要你自己建</b>
      <span>不同经销商对接的系统不一样：有人只做永辉，有人做永辉＋沃尔玛＋美联，有人压根不分渠道。所以系统<b>不预置任何零售商名</b> —— 渠道由你自己命名、自己决定取哪个价、加几条都行。</span>
    </div>

    <div v-if="loading" class="pc-empty">正在加载渠道…</div>
    <div v-else-if="!channels.length" class="pc-empty">还没有渠道。点右上角「新建渠道」开始。</div>

    <div v-else class="pc-grid">
      <div
        v-for="c in channels" :key="c.id"
        class="pc-card" :class="{ 'is-off': !c.is_active, 'is-def': c.is_default }">
        <div class="pc-card-hd">
          <b>{{ c.name }}</b>
          <span v-if="c.is_default" class="pc-tag def">默认</span>
          <span v-if="!c.is_active" class="pc-tag off">已停用</span>
        </div>
        <div class="pc-card-bd">
          <div class="pc-ln"><span>取哪个价</span><em>{{ srcLabel(c.price_source) }}</em></div>
          <div class="pc-ln"><span>商品编码</span><em>{{ srcLabel(c.code_source) }}</em></div>
          <div class="pc-ln">
            <span>已录价</span>
            <em :class="{ warn: (stat[c.id] && stat[c.id].missing) > 0 }">
              {{ (stat[c.id] && stat[c.id].priced) || 0 }} / {{ (stat[c.id] && stat[c.id].total) || 0 }}
              <template v-if="stat[c.id] && stat[c.id].missing">（还缺 {{ stat[c.id].missing }} 个）</template>
            </em>
          </div>
          <div class="pc-ln"><span>用在</span><em>{{ used[c.id] || 0 }} 个报单对象</em></div>
          <div v-if="c.note" class="pc-note">{{ c.note }}</div>
        </div>
        <div class="pc-card-ft">
          <button
            v-if="c.price_source === 'matrix' || c.code_source === 'matrix'"
            class="btn btn-ghost btn-sm" @click="openMatrix(c)">管价格</button>
          <button class="btn btn-ghost btn-sm" @click="openEdit(c)">编辑</button>
          <button
            v-if="!c.is_default && c.is_active"
            class="btn btn-ghost btn-sm" @click="makeDefault(c)">设为默认</button>
          <button
            v-if="!c.is_default"
            class="btn btn-ghost btn-sm" @click="toggleActive(c)">{{ c.is_active ? '停用' : '启用' }}</button>
          <button
            v-if="!c.is_default"
            class="btn btn-ghost btn-sm pc-danger" @click="removeOne(c)">删除</button>
        </div>
      </div>
    </div>

    <!-- 试算：与模板生成同一个函数，看到的即得到的 -->
    <div class="card pc-try">
      <div class="pc-sec">
        <b>试算：这个客户的这个商品，会取到哪个价</b>
        <span class="page-sub">这里调用的取价函数，就是将来生成订单文件时用的同一个 —— 不是前端另算一份。</span>
      </div>
      <div class="pc-try-row">
        <label class="pc-f">
          <span>报单对象</span>
          <select v-model="tryMapping">
            <option value="0">（不指定，按默认渠道）</option>
            <option v-for="m in mappings" :key="m.id" :value="String(m.id)">
              {{ m.report_alias }}{{ m.channel_id ? ' · 已指定渠道' : ' · 自动' }}
            </option>
          </select>
        </label>
        <label class="pc-f">
          <span>商品（可输入关键字筛）</span>
          <input v-model="tryKw" placeholder="商品名称 / 条码"/>
        </label>
        <label class="pc-f">
          <span>&nbsp;</span>
          <select v-model="tryProduct">
            <option value="0">请选择商品</option>
            <option v-for="p in tryProducts" :key="p.id" :value="String(p.id)">
              {{ p.name }}<template v-if="p.barcode"> · {{ p.barcode }}</template>
            </option>
          </select>
        </label>
        <label class="pc-f">
          <span>渠道（可选）</span>
          <select v-model="tryChannel">
            <option value="0">按报单对象（自动）</option>
            <option v-for="c in channels" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
          </select>
        </label>
        <button
          class="btn btn-primary btn-sm pc-try-btn"
          :disabled="tryProduct === '0' || tryBusy" @click="runTry">
          {{ tryBusy ? '计算中…' : '试算' }}
        </button>
      </div>
      <div v-if="tryResult" class="pc-res" :class="{ bad: tryResult.missing }">
        <div class="pc-res-main">
          <span class="pc-res-k">取价结果</span>
          <b>{{ tryResult.missing ? '该渠道下没有这个商品的价' : ('¥ ' + fmt(tryResult.price)) }}</b>
          <span v-if="!tryResult.missing" class="pc-res-from">来自「{{ tryResult.channel_name }}」（{{ srcLabel(tryResult.price_source) }}）</span>
        </div>
        <div v-if="tryResult.code" class="pc-res-sub">
          该渠道的商品编码：<b class="pc-mono">{{ tryResult.code }}</b>
        </div>
        <div v-if="tryResult.reason" class="pc-res-warn">{{ tryResult.reason }}</div>
        <div v-if="tryResult.missing && tryResult.fallback_channel" class="pc-res-warn">
          生成时会按「{{ tryResult.fallback_channel }}」回退，并在结果里点名报出来（不会静默取错价）。
        </div>
      </div>
      <div v-else class="pc-res-hint">选一个报单对象和一个商品，点「试算」。</div>
    </div>

    <!-- 新建 / 编辑渠道 -->
    <div v-if="fmOpen" class="pc-mask" @click.self="fmOpen = false">
      <div class="pc-modal pc-modal-sm">
        <div class="pc-modal-hd">
          <b>{{ fmEdit ? '编辑渠道' : '新建渠道' }}</b>
          <button class="pc-x" @click="fmOpen = false"><Icon name="close"/></button>
        </div>
        <div class="pc-modal-bd">
          <label class="pc-f">
            <span>渠道名称（你自己叫它什么）</span>
            <input v-model="fm.name" maxlength="20" placeholder="例如：永辉系统 / 大润发 / 车销仓"/>
          </label>
          <label class="pc-f">
            <span>列名前缀（可选，留空自动取名称）</span>
            <input v-model="fm.col_prefix" maxlength="10" placeholder="导入模版里会写成「前缀价」「前缀系统商品编码」"/>
          </label>
          <label class="pc-f">
            <span>取哪个价</span>
            <select v-model="fm.price_source">
              <option v-for="o in srcOptions.price_sources" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <i class="pc-tip">{{ hintOf('price_sources', fm.price_source) }}</i>
          </label>
          <label class="pc-f">
            <span>商品编码从哪来</span>
            <select v-model="fm.code_source">
              <option v-for="o in srcOptions.code_sources" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <i class="pc-tip">{{ hintOf('code_sources', fm.code_source) }}</i>
          </label>
          <label class="pc-f">
            <span>备注（可选）</span>
            <input v-model="fm.note" maxlength="80"/>
          </label>
          <div v-if="fmErr" class="pc-err">{{ fmErr }}</div>
        </div>
        <div class="pc-modal-ft">
          <button class="btn btn-ghost btn-sm" @click="fmOpen = false">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="fmBusy || !fm.name.trim()" @click="saveChannel">
            {{ fmBusy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 商品 × 渠道 价格维护 -->
    <div v-if="mxOpen" class="pc-mask" @click.self="mxOpen = false">
      <div class="pc-modal">
        <div class="pc-modal-hd">
          <b>「{{ mxChannel.name }}」的商品价格 / 编码</b>
          <button class="pc-x" @click="mxOpen = false"><Icon name="close"/></button>
        </div>
        <div class="pc-modal-bd">
          <div class="pc-mx-bar">
            <input v-model="mxKw" placeholder="搜索商品名称 / 条码 / 厂家编码" @keyup.enter="loadMatrix(0)"/>
            <button class="btn btn-ghost btn-sm" @click="loadMatrix(0)">搜索</button>
            <span class="pc-mx-hint">
              共 {{ mxTotal }} 个商品 · 已录价 {{ mxSummary.priced }} 个<template v-if="mxSummary.missing"> · 还缺 {{ mxSummary.missing }} 个</template>
            </span>
          </div>
          <div class="pc-mx-note">
            价格是<b>「填了就覆盖」</b>（价格表每月会变，所以不是"只补空"）。留空不动已录的价；要清空就填 <b>0</b>。
          </div>
          <div v-if="mxLoading" class="pc-empty">正在加载商品…</div>
          <table v-else class="pc-tb">
            <thead>
              <tr><th>商品</th><th>条码</th><th>该渠道商品编码</th><th>该渠道价格</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in mxRows" :key="r.id" :class="{ dirty: mxDirty[r.id] }">
                <td class="pc-name">{{ r.name }}<span v-if="r.spec" class="pc-spec">规格 {{ r.spec }}</span></td>
                <td class="pc-mono">{{ r.barcode || '—' }}</td>
                <td><input v-model="mxEdit[r.id].external_code" class="pc-in" @input="touch(r.id)"/></td>
                <td><input v-model="mxEdit[r.id].price" class="pc-in" @input="touch(r.id)"/></td>
                <td>
                  <span v-if="Number(mxEdit[r.id].price) > 0" class="pc-ok">已录</span>
                  <span v-else class="pc-miss">未录</span>
                </td>
              </tr>
              <tr v-if="!mxRows.length"><td colspan="5" class="pc-empty">没有匹配的商品</td></tr>
            </tbody>
          </table>
          <div class="pc-pager">
            <button class="btn btn-ghost btn-sm" :disabled="mxOffset <= 0" @click="loadMatrix(mxOffset - mxLimit)">上一页</button>
            <span>{{ mxPageFrom }}–{{ mxPageTo }} / {{ mxTotal }}</span>
            <button class="btn btn-ghost btn-sm" :disabled="mxPageTo >= mxTotal" @click="loadMatrix(mxOffset + mxLimit)">下一页</button>
          </div>
        </div>
        <div class="pc-modal-ft">
          <span class="pc-dirty">{{ dirtyCount }} 行待保存</span>
          <button class="btn btn-ghost btn-sm" @click="mxOpen = false">关闭</button>
          <button class="btn btn-primary btn-sm" :disabled="!dirtyCount || mxBusy" @click="saveMatrix">
            {{ mxBusy ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, computed, onMounted } from 'vue'
import { priceChannelApi, reportMappingApi, productsApi } from '../api/modules'
import { toast } from '../store'

const loading = ref(false)
const channels = ref([])
const stat = ref({})
const used = ref({})
const srcOptions = ref({ price_sources: [], code_sources: [], kinds: [] })

/* ---------------- 渠道字典 ---------------- */

const SRC_FALLBACK = {
  products_factory: '用商品档案的厂价',
  products_dist: '用商品档案的分销价',
  products_code: '用商品档案的厂家编码',
  matrix: '本渠道单独维护',
  none: '不需要',
}

function srcLabel(v) {
  const all = [...(srcOptions.value.price_sources || []), ...(srcOptions.value.code_sources || [])]
  const hit = all.find(o => o.value === v)
  return hit ? hit.label : (SRC_FALLBACK[v] || v || '—')
}

function hintOf(group, v) {
  const hit = (srcOptions.value[group] || []).find(o => o.value === v)
  return hit ? hit.hint : ''
}

async function load() {
  loading.value = true
  try {
    const r = await priceChannelApi.list()
    channels.value = r.channels || []
    stat.value = r.summary || {}
    used.value = r.used || {}
  } catch (e) {
    toast(e.message || '加载渠道失败', 'err')
  } finally {
    loading.value = false
  }
}

async function loadSources() {
  try {
    srcOptions.value = await priceChannelApi.sources()
  } catch (e) {
    /* 枚举拉不到不阻塞页面：下拉回退到默认选项 */
  }
}

/* ---------------- 新建 / 编辑 ---------------- */

const fmOpen = ref(false)
const fmEdit = ref(null)
const fmBusy = ref(false)
const fmErr = ref('')
const fm = ref({ name: '', col_prefix: '', price_source: 'matrix', code_source: 'matrix', note: '' })

function openNew() {
  fmEdit.value = null
  fmErr.value = ''
  fm.value = { name: '', col_prefix: '', price_source: 'matrix', code_source: 'matrix', note: '' }
  fmOpen.value = true
}

function openEdit(c) {
  fmEdit.value = c
  fmErr.value = ''
  fm.value = {
    name: c.name, col_prefix: c.col_prefix || '',
    price_source: c.price_source || 'matrix',
    code_source: c.code_source || 'matrix', note: c.note || '',
  }
  fmOpen.value = true
}

async function saveChannel() {
  fmBusy.value = true
  fmErr.value = ''
  try {
    const body = { ...fm.value }
    if (fmEdit.value) await priceChannelApi.update(fmEdit.value.id, body)
    else await priceChannelApi.create(body)
    toast(fmEdit.value ? '渠道已更新' : '渠道已新建', 'ok')
    fmOpen.value = false
    await load()
  } catch (e) {
    fmErr.value = e.message || '保存失败'
  } finally {
    fmBusy.value = false
  }
}

async function makeDefault(c) {
  try {
    await priceChannelApi.setDefault(c.id)
    toast(`已把「${c.name}」设为默认渠道`, 'ok')
    await load()
  } catch (e) {
    toast(e.message || '设置失败', 'err')
  }
}

async function toggleActive(c) {
  try {
    await priceChannelApi.update(c.id, { is_active: c.is_active ? 0 : 1 })
    toast(c.is_active ? `「${c.name}」已停用` : `「${c.name}」已启用`, 'ok')
    await load()
  } catch (e) {
    toast(e.message || '操作失败', 'err')
  }
}

async function removeOne(c) {
  const n = used.value[c.id] || 0
  const tip = n
    ? `「${c.name}」已被 ${n} 个报单对象使用，删除会被拒绝。`
    : `确定删除「${c.name}」？它下面已录的价格/编码会一起删掉，不可恢复。`
  if (!window.confirm(tip + '\n\n确定继续吗？')) return
  try {
    const r = await priceChannelApi.remove(c.id)
    toast(`已删除「${c.name}」` + (r.matrix_rows_removed ? `，连带清掉 ${r.matrix_rows_removed} 行价格` : ''), 'ok')
    await load()
  } catch (e) {
    toast(e.message || '删除失败', 'err')
  }
}

/* ---------------- 价格矩阵 ---------------- */

const mxOpen = ref(false)
const mxChannel = ref({})
const mxRows = ref([])
const mxEdit = ref({})
const mxDirty = ref({})
const mxKw = ref('')
const mxTotal = ref(0)
const mxOffset = ref(0)
const mxLimit = ref(50)
const mxLoading = ref(false)
const mxBusy = ref(false)
const mxSummary = ref({})

const dirtyCount = computed(() => Object.keys(mxDirty.value).length)
const mxPageFrom = computed(() => (mxTotal.value ? mxOffset.value + 1 : 0))
const mxPageTo = computed(() => Math.min(mxOffset.value + mxRows.value.length, mxTotal.value))

function openMatrix(c) {
  mxChannel.value = c
  mxKw.value = ''
  mxOpen.value = true
  loadMatrix(0)
}

function touch(id) {
  mxDirty.value = { ...mxDirty.value, [id]: true }
}

async function loadMatrix(offset = 0) {
  mxLoading.value = true
  mxOffset.value = Math.max(0, offset)
  try {
    const r = await priceChannelApi.matrix(mxChannel.value.id, {
      keyword: mxKw.value, offset: mxOffset.value, limit: mxLimit.value,
    })
    mxRows.value = r.items || []
    mxTotal.value = r.total || 0
    mxSummary.value = r.summary || {}
    const e = {}
    for (const it of mxRows.value) {
      e[it.id] = { external_code: it.external_code || '', price: it.price ? String(it.price) : '' }
    }
    mxEdit.value = e
    mxDirty.value = {}
  } catch (e) {
    toast(e.message || '加载商品失败', 'err')
  } finally {
    mxLoading.value = false
  }
}

async function saveMatrix() {
  const items = Object.keys(mxDirty.value).map(id => ({
    product_id: Number(id),
    external_code: mxEdit.value[id].external_code,
    price: mxEdit.value[id].price,
  }))
  if (!items.length) return
  mxBusy.value = true
  try {
    const r = await priceChannelApi.saveMatrix(mxChannel.value.id, items)
    let msg = `已写 ${r.updated} 行（价 ${r.prices_written} 个、编码 ${r.codes_written} 个）`
    if (r.skipped) msg += `，跳过 ${r.skipped} 行空值`
    toast(msg, 'ok')
    await loadMatrix(mxOffset.value)
    await load()
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally {
    mxBusy.value = false
  }
}

/* ---------------- 试算 ---------------- */

const mappings = ref([])
const allProducts = ref([])
const tryMapping = ref('0')
const tryProduct = ref('0')
const tryChannel = ref('0')
const tryKw = ref('')
const tryBusy = ref(false)
const tryResult = ref(null)

const tryProducts = computed(() => {
  const kw = tryKw.value.trim().toLowerCase()
  const list = allProducts.value
  if (!kw) return list.slice(0, 100)
  return list.filter(p =>
    (p.name || '').toLowerCase().includes(kw) || String(p.barcode || '').includes(kw)
  ).slice(0, 100)
})

function fmt(v) {
  const n = Number(v || 0)
  return n.toFixed(2)
}

async function runTry() {
  tryBusy.value = true
  tryResult.value = null
  try {
    tryResult.value = await priceChannelApi.resolve({
      productId: Number(tryProduct.value),
      mappingId: Number(tryMapping.value) || 0,
      channelId: Number(tryChannel.value) || 0,
    })
  } catch (e) {
    toast(e.message || '试算失败', 'err')
  } finally {
    tryBusy.value = false
  }
}

onMounted(async () => {
  await loadSources()
  await load()
  try {
    const m = await reportMappingApi.list({ include_inactive: 0 })
    mappings.value = Array.isArray(m) ? m : (m.items || m.mappings || [])
  } catch (e) { /* 报单对象拉不到不影响渠道维护 */ }
  try {
    const g = await productsApi.grid()
    allProducts.value = (g && (g.items || g.products)) || []
  } catch (e) { /* 商品拉不到只是试算不可用 */ }
})
</script>

<style scoped>
.pc-act{display:flex;gap:8px;flex-wrap:wrap}
.pc-why{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;margin:0 0 14px;padding:10px 14px;
  border-radius:8px;background:var(--bg2);border:1px solid var(--bd);font-size:12.5px;line-height:1.65;color:var(--t2)}
.pc-why b{color:var(--t1);white-space:nowrap}
.pc-why>span b{color:var(--t1)}
.pc-empty{padding:26px;text-align:center;color:var(--t3);font-size:13px}

.pc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:12px;margin-bottom:16px}
.pc-card{display:flex;flex-direction:column;border:1px solid var(--bd);border-radius:10px;background:var(--bg);
  padding:12px 14px;transition:border-color .15s,box-shadow .15s}
.pc-card:hover{box-shadow:var(--shadow-sm)}
.pc-card.is-def{border-color:rgba(var(--p-rgb),.45);background:var(--p-bg)}
.pc-card.is-off{opacity:.6}
.pc-card-hd{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.pc-card-hd b{font-size:14px;color:var(--t1)}
.pc-tag{font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid var(--bd);color:var(--t2)}
.pc-tag.def{background:var(--p-dark);border-color:var(--p-dark);color:#fff}
.pc-tag.off{background:var(--bg2);color:var(--t3)}
.pc-card-bd{flex:1;display:flex;flex-direction:column;gap:4px}
.pc-ln{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;line-height:1.6}
.pc-ln span{color:var(--t3);white-space:nowrap}
.pc-ln em{font-style:normal;color:var(--t1);text-align:right}
.pc-ln em.warn{color:var(--war)}
.pc-note{margin-top:6px;font-size:11.5px;color:var(--t3);line-height:1.55}
.pc-card-ft{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)}
.pc-danger{color:var(--dan)}
.pc-danger:hover{background:var(--dan-bg);color:var(--dan)}

.pc-sec{display:flex;flex-direction:column;gap:3px;margin-bottom:12px}
.pc-sec b{font-size:13.5px;color:var(--t1)}
.pc-try-row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}
.pc-f{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--t3);min-width:0;flex:1 1 190px}
.pc-f input,.pc-f select{height:32px;padding:0 10px;font-size:13px;color:var(--t1);background:var(--bg);
  border:1px solid var(--bd);border-radius:var(--radius-sm)}
.pc-f input:focus,.pc-f select:focus{outline:none;border-color:var(--p-dark)}
.pc-tip{font-style:normal;font-size:11.5px;color:var(--t3);line-height:1.5}
.pc-try-btn{flex:0 0 auto}
.pc-res{margin-top:14px;padding:12px 14px;border-radius:8px;background:var(--bg2);border:1px solid var(--bd)}
.pc-res.bad{background:rgba(var(--war-rgb),.10);border-color:rgba(var(--war-rgb),.4)}
.pc-res-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.pc-res-k{font-size:12px;color:var(--t3)}
.pc-res-main b{font-size:19px;font-weight:600;color:var(--t1);font-variant-numeric:tabular-nums}
.pc-res.bad .pc-res-main b{font-size:14px;color:var(--war)}
.pc-res-from{font-size:12px;color:var(--t2)}
.pc-res-sub{margin-top:6px;font-size:12.5px;color:var(--t2)}
.pc-res-warn{margin-top:6px;font-size:12.5px;color:var(--war);line-height:1.6}
.pc-res-hint{margin-top:12px;font-size:12.5px;color:var(--t3)}

.pc-mask{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;
  justify-content:center;z-index:60;padding:24px}
.pc-modal{display:flex;flex-direction:column;width:100%;max-width:900px;max-height:86vh;background:var(--bg);
  border-radius:var(--radius-lg);border:1px solid var(--bd);overflow:hidden}
.pc-modal-sm{max-width:440px}
.pc-modal-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;
  border-bottom:1px solid var(--bd)}
.pc-modal-hd b{font-size:14.5px;color:var(--t1)}
.pc-x{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:none;
  background:none;border-radius:6px;color:var(--t2);cursor:pointer}
.pc-x:hover{background:var(--bg2);color:var(--t1)}
.pc-modal-bd{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.pc-modal-ft{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid var(--bd)}
.pc-modal-ft .btn{padding:0 14px}
.pc-dirty{margin-right:auto;font-size:12.5px;color:var(--t2)}
.pc-err{font-size:12.5px;color:var(--dan);line-height:1.6}

.pc-mx-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pc-mx-bar input{flex:1 1 220px;height:32px;padding:0 10px;font-size:13px;background:var(--bg);
  color:var(--t1);border:1px solid var(--bd);border-radius:var(--radius-sm)}
.pc-mx-hint{font-size:12px;color:var(--t3)}
.pc-mx-note{padding:9px 12px;border-radius:6px;background:var(--bg2);border:1px solid var(--bd);
  font-size:12px;line-height:1.6;color:var(--t2)}
.pc-mx-note b{color:var(--t1)}
.pc-tb{width:100%;border-collapse:collapse;font-size:12.5px}
.pc-tb th{text-align:left;font-weight:500;color:var(--t3);padding:7px 8px;border-bottom:1px solid var(--bd);white-space:nowrap}
.pc-tb td{padding:5px 8px;border-bottom:1px solid var(--border-subtle);vertical-align:middle}
.pc-tb tr.dirty td{background:rgba(var(--p-rgb),.07)}
.pc-tb tr.dirty td:first-child{box-shadow:inset 2px 0 0 var(--p-dark)}
.pc-name{color:var(--t1)}
.pc-spec{display:block;font-size:11.5px;color:var(--t3)}
.pc-mono{font-family:var(--font-mono,monospace);color:var(--t2)}
.pc-in{width:100%;height:28px;padding:0 8px;font-size:12.5px;color:var(--t1);background:var(--bg);
  border:1px solid var(--bd);border-radius:5px;box-sizing:border-box}
.pc-in:focus{outline:none;border-color:var(--p-dark)}
.pc-ok{color:var(--suc);font-size:12px}
.pc-miss{color:var(--t3);font-size:12px}
.pc-pager{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--t2)}
.pc-pager .btn{margin:0}
</style>
