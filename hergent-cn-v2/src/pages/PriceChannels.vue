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

    <!-- 客户专属价（v228）：与上面的「渠道价」互补 —— 渠道价按渠道统一定价，
         专属价只对**某一个客户**生效，且在定价引擎里优先级更高（第 4 层 customer_specific）。
         生产 tenant_1 已有 8024 行，但此前前端零界面 ⇒「数据存在却看不见」，本区块把它接出来。 -->
    <div class="card pc-cust">
      <div class="pc-sec">
        <b>客户专属价</b>
        <span class="page-sub">某个客户（门店）的专供货价。一行 = 一个「客户 × 商品」，小 / 中 / 大单位三档价可分别填。</span>
        <div class="pc-act">
          <button class="btn btn-ghost btn-sm" :disabled="cpLoading" @click="loadCustPrices(cpOffset)"><Icon name="refresh"/> 刷新</button>
          <button class="btn btn-primary btn-sm" :disabled="!cpDirtyCount || cpBusy" @click="saveCustPrices">
            {{ cpBusy ? '保存中…' : ('保存改动' + (cpDirtyCount ? '（' + cpDirtyCount + ' 行）' : '')) }}
          </button>
        </div>
      </div>

      <div class="pc-mx-bar">
        <input v-model="cpKw" placeholder="搜客户名 / 商品名 / 条码" @keyup.enter="cpSearch"/>
        <button class="btn btn-ghost btn-sm" @click="cpSearch">搜索</button>
        <label class="pc-ck">
          <input type="checkbox" v-model="cpOnlyPriced" @change="cpSearch"/> 只看有价的
        </label>
        <a class="btn btn-ghost btn-sm" :href="cpTemplateUrl" download="客户专属价导入模板.xlsx">下载导入模板</a>
      </div>

      <div v-if="cpSummary.total_rows != null" class="pc-mx-hint pc-cust-sum">
        共 <b>{{ cpSummary.total_rows }}</b> 行 ·
        小单位价 <b>{{ cpSummary.priced_rows || 0 }}</b> 行 ·
        中单位价 <b :class="{ warn: !(cpSummary.medium_rows > 0) }">{{ cpSummary.medium_rows || 0 }}</b> 行 ·
        大单位价 <b :class="{ warn: !(cpSummary.large_rows > 0) }">{{ cpSummary.large_rows || 0 }}</b> 行 ·
        覆盖 {{ cpSummary.customers || 0 }} 个客户 / {{ cpSummary.products || 0 }} 个商品
      </div>
      <div class="pc-mx-note">
        <b>三档价是联动的</b> —— 填了「小单位价」，中 / 大单位价按这个商品的换算比<b>自动算</b>
        （如 88 元/杯 × 8 = 704 元/组）。灰色斜体是算出来的价，直接留空即可；
        只有实际存在非整倍的特价时才手工填，填了就以你填的为准（标「手工」）。
        <br/>改动<b>只覆盖你填了的档</b>：某一档留空 = 不动库里已有的价（所以只改「中单位价」不会把小单位价清掉）。
      </div>

      <div v-if="cpLoading" class="pc-empty">正在加载客户专属价…</div>
      <template v-else-if="cpRows.length">
        <table class="pc-tb">
          <thead>
            <tr>
              <th>客户</th><th>商品</th><th>规格</th>
              <th>小单位价</th><th>中单位价</th><th>大单位价</th><th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in cpRows" :key="r._k" :class="{ dirty: cpDirty[r._k] }">
              <td class="pc-name">
                {{ r.customer_name || ('#' + r.customer_id) }}
                <span v-if="r.customer_code" class="pc-spec">编码 {{ r.customer_code }}</span>
              </td>
              <td class="pc-name">
                {{ r.product_name || ('#' + r.product_id) }}
                <span v-if="r.barcode" class="pc-spec">{{ r.barcode }}</span>
              </td>
              <td class="pc-mono">{{ r.spec || '—' }}</td>

              <!-- 小单位价：基准档，始终可填。中/大两档都是从这一档推出来的。 -->
              <td class="pc-px">
                <input v-model="cpEdit[r._k].price" class="pc-in" placeholder="留空不动"
                       @input="cpTouch(r._k, 'price')"/>
                <span class="pc-px-u">{{ r.unit || '小单位' }}</span>
              </td>

              <!-- 中单位价：只有三级商品才有（杯→组→件）。两级/单单位商品显示「无中单位」，
                   而不是给一个永远填不出意义的输入框。 -->
              <td class="pc-px">
                <template v-if="cpHasUnit(r, 'medium')">
                  <input v-model="cpEdit[r._k].medium_unit_price" class="pc-in"
                         :placeholder="cpPh(r, 'medium')"
                         @input="cpTouch(r._k, 'medium_unit_price')"/>
                  <span class="pc-px-u">
                    {{ r.medium_unit || '中单位' }}
                    <b v-if="cpClearedOf(r, 'medium_unit_price')" class="pc-flag"
                       title="该手工价将被清除，改回按换算比自动计算">将改为自动</b>
                    <b v-else-if="cpHand(r, 'medium_unit_price')" class="pc-flag hand">手工</b>
                    <b v-else-if="cpAutoOf(r, 'medium') != null" class="pc-flag auto"
                       title="按这个商品的换算比自动算出；留空即以系统计算为准">自动</b>
                  </span>
                  <button v-if="cpHand(r, 'medium_unit_price')" class="pc-clear"
                          title="清除手工价，改回按换算比自动计算"
                          @click="cpRestoreAuto(r, 'medium_unit_price')">恢复自动</button>
                </template>
                <span v-else class="pc-na">该商品无中单位</span>
              </td>

              <!-- 大单位价：两级与三级商品都有。 -->
              <td class="pc-px">
                <template v-if="cpHasUnit(r, 'large')">
                  <input v-model="cpEdit[r._k].large_unit_price" class="pc-in"
                         :placeholder="cpPh(r, 'large')"
                         @input="cpTouch(r._k, 'large_unit_price')"/>
                  <span class="pc-px-u">
                    {{ r.large_unit || '大单位' }}
                    <b v-if="cpClearedOf(r, 'large_unit_price')" class="pc-flag"
                       title="该手工价将被清除，改回按换算比自动计算">将改为自动</b>
                    <b v-else-if="cpHand(r, 'large_unit_price')" class="pc-flag hand">手工</b>
                    <b v-else-if="cpAutoOf(r, 'large') != null" class="pc-flag auto"
                       title="按这个商品的换算比自动算出；留空即以系统计算为准">自动</b>
                  </span>
                  <button v-if="cpHand(r, 'large_unit_price')" class="pc-clear"
                          title="清除手工价，改回按换算比自动计算"
                          @click="cpRestoreAuto(r, 'large_unit_price')">恢复自动</button>
                </template>
                <span v-else class="pc-na">该商品无大单位</span>
              </td>

              <td class="pc-mono">{{ fmtDay(r.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="pc-pager">
          <button class="btn btn-ghost btn-sm" :disabled="cpOffset <= 0" @click="loadCustPrices(cpOffset - cpLimit)">上一页</button>
          <span>{{ cpPageFrom }}–{{ cpPageTo }} / {{ cpTotal }}</span>
          <button class="btn btn-ghost btn-sm" :disabled="cpPageTo >= cpTotal" @click="loadCustPrices(cpOffset + cpLimit)">下一页</button>
        </div>
      </template>
      <div v-else class="pc-empty">
        没有匹配的客户专属价。
        <div class="pc-empty-sub">
          ① 点上方「下载导入模板」填好再导入（列：客户名称、商品名称、条码、小单位价、中单位价、大单位价）；
          ② 或先去「客户档案」「商品档案」把客户与商品建出来。
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
import { priceChannelApi, reportMappingApi, productsApi, custPriceApi } from '../api/modules'
import { toast } from '../store'

const loading = ref(false)
const channels = ref([])
const stat = ref({})
const used = ref({})
const srcOptions = ref({ price_sources: [], code_sources: [], kinds: [] })

/* ---------------- 渠道字典 ---------------- */

const SRC_FALLBACK = {
  products_factory: '用商品档案的进价',
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

/* ---------------- 客户专属价（v228） ---------------- */

const cpRows = ref([])
const cpLoading = ref(false)
const cpBusy = ref(false)
const cpKw = ref('')
const cpOnlyPriced = ref(false)
const cpOffset = ref(0)
const cpLimit = ref(30)
const cpTotal = ref(0)
const cpSummary = ref({})
const cpEdit = ref({})
const cpDirty = ref({})
/* 用户点了「恢复自动」的档：`{ _k: { medium_unit_price: true } }`。
   🔴 为什么需要它：输入框清空 ≠ 清掉库里的价 —— 空值在提交时被当作「不动这一档」跳过
   （`saveCustPrices` 的既有语义，也是 v228 修掉"整行 REPLACE 清零"后的正确行为）。
   所以「把已有的手工价改回自动」必须**显式写 0**，不能靠清空输入框。 */
const cpCleared = ref({})

const cpTemplateUrl = custPriceApi.templateUrl()
const cpDirtyCount = computed(() => Object.keys(cpDirty.value).length)
const cpPageFrom = computed(() => (cpTotal.value ? cpOffset.value + 1 : 0))
const cpPageTo = computed(() => Math.min(cpOffset.value + cpLimit.value, cpTotal.value))

function fmtDay(s) {
  const t = String(s || '').trim()
  return t ? t.slice(0, 10) : '—'
}

/* ---- 三档价联动（v229）：中/大单位价由小单位价 × 商品换算比「反推」 ----

   🔴 口径必须与后端逐字一致 —— `domain/pricing_engine._get_standard_price()`（:337）
      与 `db/queries/sales.py::_cp_auto_unit()` 都是 `round(小单位价 × ratio, 2)`。
      Python 的 `round()` 是**银行家舍入**（.5 取偶），JS `Math.round()` 是四舍五入，
      在 `.xx5` 边界上会差 0.01（界面显示 2.68、系统实算 2.67）⇒ 这里实现同款 pyRound。

      界面上算出的自动值只是**预告**：真正下单取价由后端算，保存后以后端返回值为准。

   🔴 为什么不是「三档各填各的」：用户口径原话「中单位/大单位价可以用小单位价反推呀，
      它们之间的价是联动的」。实证 —— 生产 93 个同时有分销价/厂价的商品里 **88 个**严格命中
      `大单位价 = 小单位价 × 换算数 × 0.9`（0.9 是厂价特有的整箱折扣，属厂价链）。
      所以中/大两档**留空即可**：库里的 0 会被定价引擎当成「没有专属价」而退回按换算比推算
      （`_check_customer_price`：专属档 > 0 优先，否则 `price × ratio`）。
      只有真实存在非等比例外价（实测有 0.81 = 两重折扣的样本）才需要手工覆盖。 */

/** 与 Python `round(v, n)` 同款（含 .5 取偶）。 */
function pyRound(v, n = 2) {
  const m = Math.pow(10, n)
  const x = v * m
  const f = Math.floor(x)
  if (Math.abs((x - f) - 0.5) < 1e-9) return (f % 2 === 0 ? f : f + 1) / m
  return Math.round(x) / m
}

/** 换算比 / 价格列的宽松取数。库里的 `medium_ratio` 可能是**空串**（两级商品没有中单位，
    实测 272 行）或 text 型空串，`Number('')` 是 0 所以安全；这里再挡住 null / 非数字串。 */
function cpNum(v) {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 这个商品有没有这一档单位 —— 决定要不要显示输入框。
    判据用**换算比**（定价引擎真正用的那个），不用 `medium_unit` 名字。
    实测两者一致（99 个三级商品既有单位名也有 ratio），但 ratio 才是算价依据。 */
function cpHasUnit(r, level) {
  return level === 'medium' ? cpNum(r.medium_ratio) > 0 : cpNum(r.large_ratio) > 0
}

/** 推算基准 = 小单位价。**优先取「正在编辑但还没保存」的输入框**，这样用户改小单位价时
    中/大的自动值会即时跟着变；输入框为空则退回库里已有的小单位价。 */
function cpBaseOf(r) {
  const e = cpEdit.value[r._k] || {}
  const s = String(e.price == null ? '' : e.price).trim()
  if (s !== '') {
    const n = Number(s)
    if (Number.isFinite(n) && n > 0) return n
  }
  return cpNum(r.small_unit_price) || cpNum(r.price)
}

/** 该档的自动推算值。推不出返回 `null` ⇒ 界面显示「留空即自动」而不是一个假的 0。 */
function cpAutoOf(r, level) {
  if (level === 'small') return null
  const field = level === 'medium' ? 'medium_unit_price' : 'large_unit_price'
  if (cpHand(r, field)) return null       // 手工填了 → 不再提示自动值
  if (cpClearedOf(r, field)) return null  // 点了「恢复自动」→ 回到未填状态
  const base = cpBaseOf(r)
  const ratio = cpNum(level === 'medium' ? r.medium_ratio : r.large_ratio)
  if (!(base > 0) || !(ratio > 0)) return null
  return pyRound(base * ratio, 2)
}

/** 输入框的 placeholder：中/大档直接显示算出来的价，用户一眼看到「不用填」。 */
function cpPh(r, level) {
  if (level === 'small') return '留空不动'
  const v = cpAutoOf(r, level)
  return v == null ? '留空即自动' : String(v)
}

async function loadCustPrices(offset = 0) {
  cpLoading.value = true
  cpOffset.value = Math.max(0, offset)
  try {
    const r = await custPriceApi.list({
      keyword: cpKw.value,
      onlyPriced: cpOnlyPriced.value ? '1' : '',
      offset: cpOffset.value,
      limit: cpLimit.value,
    })
    cpRows.value = (r.items || []).map(it => ({ ...it, _k: it.customer_id + '-' + it.product_id }))
    cpTotal.value = r.total || 0
    cpSummary.value = r.summary || {}
    const e = {}
    for (const it of cpRows.value) {
      e[it._k] = {
        price: it.price ? String(it.price) : '',
        medium_unit_price: it.medium_unit_price ? String(it.medium_unit_price) : '',
        large_unit_price: it.large_unit_price ? String(it.large_unit_price) : '',
      }
    }
    cpEdit.value = e
    cpDirty.value = {}
    cpCleared.value = {}
  } catch (e) {
    toast(e.message || '加载客户专属价失败', 'err')
  } finally {
    cpLoading.value = false
  }
}

function cpSearch() { loadCustPrices(0) }

/** 这一格的输入框里有没有用户填的值（空串 = 没填 = 提交时跳过这一档）。 */
function cpHasInput(r, field) {
  const e = cpEdit.value[r._k] || {}
  return String(e[field] == null ? '' : e[field]).trim() !== ''
}

/** 该档被**手工**填了值（区别于「恢复自动」标记出来的空）。 */
function cpHand(r, field) {
  return cpHasInput(r, field) && !cpClearedOf(r, field)
}

/** 该档被标了「恢复自动」⇒ 提交时显式写 0（见 `cpCleared` 的说明）。 */
function cpClearedOf(r, field) {
  const c = cpCleared.value[r._k]
  return !!(c && c[field])
}

/** 清除某一档的手工价，改回按换算比自动计算。 */
function cpRestoreAuto(r, field) {
  const e = cpEdit.value[r._k]
  if (e) e[field] = ''
  cpCleared.value = {
    ...cpCleared.value,
    [r._k]: Object.assign({}, cpCleared.value[r._k] || {}, { [field]: true }),
  }
  // 直接标脏，**不要**走 cpTouch —— 它会把刚设的「恢复自动」标记清掉（那是给手工输入用的）
  cpDirty.value = { ...cpDirty.value, [r._k]: true }
}

function cpTouch(k, field) {
  cpDirty.value = { ...cpDirty.value, [k]: true }
  // 用户重新手输 ⇒ 取消这一格的「恢复自动」标记，否则会把手工值提交成 0
  if (field) {
    const c = cpCleared.value[k]
    if (c && c[field]) {
      const nc = Object.assign({}, c)
      delete nc[field]
      cpCleared.value = { ...cpCleared.value, [k]: nc }
    }
  }
}

async function saveCustPrices() {
  const keys = Object.keys(cpDirty.value)
  if (!keys.length) return
  const byKey = {}
  for (const r of cpRows.value) byKey[r._k] = r
  const jobs = []
  const skipped = []
  for (const k of keys) {
    const r = byKey[k]
    if (!r) continue
    const e = cpEdit.value[k] || {}
    const cleared = cpCleared.value[k] || {}
    const body = { customer_id: r.customer_id, product_id: r.product_id }
    let any = false, invalid = false, autoN = 0
    for (const field of ['price', 'medium_unit_price', 'large_unit_price']) {
      if (cleared[field]) {
        // 「恢复自动」⇒ **显式写 0**。清空输入框做不到这件事 —— 空值在下面被当作
        // 「不动这一档」跳过，库里的手工价会留下来。写 0 后定价引擎才回退到按换算比推算。
        body[field] = 0
        any = true
        autoN++
        continue
      }
      const s = String(e[field] == null ? '' : e[field]).trim()
      if (s === '') continue // 🔴 留空 = 不动这一档（后端只覆盖传进去的列，不会清零）
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0) { invalid = true; break }
      body[field] = n
      any = true
    }
    if (invalid || !any) { skipped.push(k); continue }
    jobs.push(custPriceApi.save(body).then(res => ({ res, autoN })))
  }
  if (!jobs.length) {
    toast('没有可保存的改动（价格要填非负数字；留空表示不动）', 'err')
    return
  }
  cpBusy.value = true
  try {
    const rs = await Promise.allSettled(jobs)
    const okN = rs.filter(x => x.status === 'fulfilled').length
    const failN = rs.length - okN
    const autoN = rs.reduce((s, x) => s + ((x.status === 'fulfilled' && x.value && x.value.autoN) || 0), 0)
    let msg = `已保存 ${okN} 行`
    if (autoN) msg += `，其中 ${autoN} 档改回自动计算`
    if (failN) msg += `，失败 ${failN} 行`
    if (skipped.length) msg += `，跳过 ${skipped.length} 行（没有任何一档填了值）`
    toast(msg, failN ? 'err' : 'ok')
    await loadCustPrices(cpOffset.value)
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally {
    cpBusy.value = false
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
  // 客户专属价是独立区块：**不 await** —— 它不该拖慢渠道列表的首屏
  // （内部已有 try/catch，不会产生未处理的 rejection）。
  loadCustPrices(0)
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

/* v228 客户专属价：与「渠道价」互补的独立区块 */
.pc-cust{padding:18px;margin-top:14px}
.pc-cust .pc-tb{margin-top:2px}
.pc-cust-sum{margin:10px 0 6px;line-height:1.9}
.pc-cust-sum b{color:var(--t1);font-weight:600}
.pc-cust-sum b.warn{color:var(--war)}
.pc-ck{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--t2);
  cursor:pointer;user-select:none;white-space:nowrap}
/* 🔴 必须覆盖上面 `.pc-mx-bar input` 的 `flex:1 1 220px; height:32px`
   —— 否则「只看有价的」复选框会被拉成 220px 宽 32px 高（后代选择器会命中它）。 */
.pc-ck input{flex:0 0 auto;width:14px;height:14px;padding:0;margin:0;border:none;background:none}
.pc-empty-sub{margin-top:6px;font-size:12px;color:var(--t3);line-height:1.7}

/* v229：三档价联动 —— 每个价格格 = 输入框 + 单位名 + 「自动 / 手工」标记。
   中/大两档的输入框 placeholder 直接显示按换算比算出来的价，用户一眼看到「不用填」。 */
.pc-cust .pc-px{min-width:104px}
.pc-cust .pc-px-u{display:block;margin-top:2px;font-size:11px;color:var(--t3);
  line-height:1.45;white-space:nowrap}
.pc-cust .pc-flag{margin-left:4px;font-size:10.5px}
.pc-cust .pc-flag.hand{color:var(--war);font-weight:600}
.pc-cust .pc-flag.auto{color:var(--t3);font-weight:400}
/* 没有这一档单位的商品（实测 263 个两级商品没有中单位）—— 明说「无」，不给假输入框 */
.pc-cust .pc-na{font-size:11.5px;color:var(--t3)}
/* 「恢复自动」是个**可点的操作**（清手工价、改回按换算比算），字号比旁边只读的
   单位名/标记略大，否则在真机上小到看不见（v229 实测：10.5px 在整页截图里几乎认不出）。 */
.pc-cust .pc-clear{display:block;margin-top:2px;padding:0;border:0;background:none;
  font-size:11.5px;color:var(--p-dark);cursor:pointer;text-decoration:underline}
.pc-cust .pc-clear:hover{opacity:.75}
</style>
