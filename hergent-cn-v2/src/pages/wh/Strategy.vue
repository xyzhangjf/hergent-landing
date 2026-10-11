<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>出入库策略</h2>
        <span class="page-sub">上架指引 · 补货需求 · 越库机会 · 拣货路径 —— 全部只读建议，不自动改库存</span>
      </div>
      <div class="wsp-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loadingAny" @click="reloadAll">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <div class="card wsp-bar">
      <label class="wsp-lb">作业仓库</label>
      <select v-model.number="whId" class="input wsp-sel" @change="onWhChange">
        <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>
      <span class="wsp-bar-note">补货需求 / 越库机会 / 上架建议按本仓库计算；拣货路径按波次计算。</span>
    </div>

    <div class="wsp-panels">
      <!-- ============ 补货需求（拣货面） ============ -->
      <section class="card wsp-p">
        <header class="wsp-p-hd">
          <span class="wsp-p-t"><Icon name="package" :size="15" />补货需求</span>
          <span class="wsp-p-s">拣货位现货低于下限的商品</span>
          <span v-if="rep.loading" class="wsp-p-badge">加载中…</span>
          <span v-else-if="rep.err" class="wsp-p-badge bad">读取失败</span>
          <span v-else class="wsp-p-badge">{{ rep.rows.length }} 项</span>
        </header>

        <div v-if="rep.err" class="wsp-inline-err">
          <Icon name="alert" :size="14" />{{ rep.err }}
        </div>
        <div v-else-if="!rep.loading && !rep.rows.length" class="state-empty wsp-empty">
          <div class="se-ic"><Icon name="check" :size="20" /></div>
          <p>没有需要补货的拣货位 —— 所有拣货面都在下限之上。</p>
          <p class="wsp-hint">（补货需求来自「拣货面配置」：只有配过拣货位上/下限的商品才会出现在这里。）</p>
        </div>
        <div v-else class="table-wrap wsp-tw">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>拣货位</th>
                <th class="num">现货</th>
                <th class="num">下限</th>
                <th class="num">上限</th>
                <th class="num">缺口</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rep.rows" :key="(r.product_id || 'x') + '-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.product_name || ('商品#' + r.product_id) }}</td>
                <td class="wsp-dim">{{ r.location_code || '—' }}</td>
                <td class="num">{{ fmtQty(r.pick_face_qty) }}</td>
                <td class="num wsp-dim">{{ fmtQty(r.min_qty) }}</td>
                <td class="num wsp-dim">{{ fmtQty(r.max_qty) }}</td>
                <td class="num wsp-need">{{ fmtQty(needOf(r)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="wsp-p-foot">「缺口」= 下限 − 现货。想一次补到上限，可以按「上限 − 现货」补。</p>
      </section>

      <!-- ============ 越库机会 ============ -->
      <section class="card wsp-p">
        <header class="wsp-p-hd">
          <span class="wsp-p-t"><Icon name="cross" :size="15" />越库机会</span>
          <span class="wsp-p-s">在途进货与待发订单撞上同一商品</span>
          <span v-if="dock.loading" class="wsp-p-badge">加载中…</span>
          <span v-else-if="dock.err" class="wsp-p-badge bad">读取失败</span>
          <span v-else class="wsp-p-badge">{{ (dock.data && dock.data.cross_dock_opportunities) || 0 }} 条</span>
        </header>

        <div v-if="dock.err" class="wsp-inline-err">
          <Icon name="alert" :size="14" />{{ dock.err }}
        </div>
        <template v-else-if="dock.data">
          <div class="wsp-dock-kpi">
            <span>在途进货 <b>{{ dock.data.inbound_items || 0 }}</b> 行</span>
            <span>待发订单 <b>{{ dock.data.outbound_items || 0 }}</b> 行</span>
            <span class="wsp-dock-hit">可越库 <b>{{ dock.data.cross_dock_opportunities || 0 }}</b> 条</span>
          </div>
          <div v-if="!(dock.data.opportunities || []).length" class="state-empty wsp-empty">
            <div class="se-ic"><Icon name="check" :size="20" /></div>
            <p>当前没有可越库的匹配 —— 在途进货与待发订单没有撞上同一商品。</p>
          </div>
          <div v-else class="table-wrap wsp-tw">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th>商品</th>
                  <th>在途单（供应商）</th>
                  <th class="num">可到货</th>
                  <th>待发单（客户）</th>
                  <th class="num">需出货</th>
                  <th class="num">可直配</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in dock.data.opportunities" :key="i">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td>{{ r.product_name || ('商品#' + r.product_id) }}</td>
                  <td class="wsp-dim">
                    <div class="wsp-mono">{{ r.inbound_po || '—' }}</div>
                    <div class="wsp-sub">{{ r.inbound_supplier || '—' }}</div>
                  </td>
                  <td class="num">{{ fmtQty(r.inbound_qty_available) }}</td>
                  <td class="wsp-dim">
                    <div class="wsp-mono">{{ r.outbound_so || '—' }}</div>
                    <div class="wsp-sub">{{ r.outbound_customer || '—' }}</div>
                  </td>
                  <td class="num">{{ fmtQty(r.outbound_qty_needed) }}</td>
                  <td class="num wsp-need">{{ fmtQty(r.match_qty) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <p class="wsp-p-foot">越库 = 到货不上架、直配到待发订单，省一次上架与一次拣货。<b>仅提示，不自动执行</b>。</p>
      </section>

      <!-- ============ 上架建议 ============ -->
      <section class="card wsp-p">
        <header class="wsp-p-hd">
          <span class="wsp-p-t"><Icon name="grid" :size="15" />上架建议</span>
          <span class="wsp-p-s">按 ABC 分类与动销为商品找库位</span>
        </header>

        <div class="wsp-form">
          <div class="wsp-fld wsp-fld-prod">
            <label class="wsp-lb">商品</label>
            <ProductCombo :row="putRow" :products="products" />
          </div>
          <button class="btn btn-primary btn-sm" :disabled="put.loading || !putRow.product_id" @click="doPutaway">
            <Icon name="target" :size="14" />{{ put.loading ? '计算中…' : '计算建议' }}
          </button>
        </div>

        <div v-if="put.err" class="wsp-inline-err">
          <Icon name="alert" :size="14" />{{ put.err }}
        </div>
        <!-- 🔴 后端把「仓库无可用库位」当**业务答复**（HTTP 200 的 `{error}`），不是异常 ——
             照原样展示，措辞不要改写成「失败」。 -->
        <div v-else-if="put.bizErr" class="wsp-biz">
          <Icon name="lightbulb" :size="14" />{{ put.bizErr }}
        </div>
        <div v-else-if="put.data" class="wsp-result">
          <div class="wsp-r-row">
            <span class="wsp-r-lb">ABC 分类</span>
            <span class="wsp-r-v">{{ put.data.abc_class || '—' }} 类</span>
          </div>
          <div class="wsp-r-row">
            <span class="wsp-r-lb">动销分区</span>
            <span class="wsp-r-v">{{ zoneText(put.data.velocity_zone) }}</span>
          </div>
          <div class="wsp-r-row">
            <span class="wsp-r-lb">推荐库位</span>
            <span class="wsp-r-v wsp-r-hi">{{ put.data.recommended_bin_code || '—' }}</span>
          </div>
          <div class="wsp-r-row">
            <span class="wsp-r-lb">所在库区</span>
            <span class="wsp-r-v">{{ put.data.recommended_zone || '—' }}</span>
          </div>
          <div class="wsp-r-row">
            <span class="wsp-r-lb">匹配评分</span>
            <span class="wsp-r-v">{{ put.data.score }}</span>
          </div>
          <p class="wsp-reason">{{ put.data.reason }}</p>
        </div>
        <div v-else class="wsp-idle">
          <Icon name="target" :size="16" />
          <span>选一个商品，点「计算建议」—— 只给建议，不会真的移动库存。</span>
        </div>
      </section>

      <!-- ============ 拣货路径 ============ -->
      <section class="card wsp-p">
        <header class="wsp-p-hd">
          <span class="wsp-p-t"><Icon name="link" :size="15" />拣货路径</span>
          <span class="wsp-p-s">按波次给最短走位顺序</span>
        </header>

        <div class="wsp-form">
          <div class="wsp-fld">
            <label class="wsp-lb">波次编号</label>
            <input v-model.number="waveId" class="input wsp-wave" type="number" min="1" step="1" placeholder="输入波次 id" />
          </div>
          <button class="btn btn-primary btn-sm" :disabled="pick.loading || !waveId" @click="doPickPath">
            <Icon name="link" :size="14" />{{ pick.loading ? '计算中…' : '计算路径' }}
          </button>
        </div>

        <div v-if="pick.err" class="wsp-inline-err">
          <Icon name="alert" :size="14" />{{ pick.err }}
        </div>
        <div v-else-if="pick.bizErr" class="wsp-biz">
          <Icon name="lightbulb" :size="14" />{{ pick.bizErr }}
        </div>
        <template v-else-if="pick.data">
          <div class="wsp-dock-kpi">
            <span>本波次 <b>{{ pick.data.items_total || 0 }}</b> 个待拣项</span>
            <span>估算路程 <b>{{ fmtQty(pick.data.estimated_distance) }}</b></span>
            <span>算法 <b>{{ pick.data.method || '—' }}</b></span>
          </div>
          <div v-if="!(pick.data.path || []).length" class="state-empty wsp-empty">
            <div class="se-ic"><Icon name="check" :size="20" /></div>
            <p>本波次没有待拣项。</p>
          </div>
          <div v-else class="table-wrap wsp-tw">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="seq-th">顺序</th>
                  <th>库位</th>
                  <th>库区</th>
                  <th>商品</th>
                  <th class="num">数量</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in pick.data.path" :key="i">
                  <td class="seq-cell"><span class="seq-num">{{ r.position || (i + 1) }}</span></td>
                  <td class="wsp-mono">{{ r.bin_code || '—' }}</td>
                  <td class="wsp-dim">{{ r.zone || '—' }}</td>
                  <td>{{ r.product_name || ('货项#' + (r.item_id || '')) }}</td>
                  <td class="num">{{ fmtQty(r.quantity) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <div v-else class="wsp-idle">
          <Icon name="link" :size="16" />
          <span>输入波次编号，点「计算路径」—— 用最近邻算法排一次走位顺序。</span>
        </div>
      </section>
    </div>

    <p class="wsp-foot">
      口径说明：本页四项**全部只读**，只给建议、不写库存、不改库位。
      「上架建议」与「拣货路径」依赖库位档案（`bin_locations`）与波次（`pick_wave_items`）——
      没建库位/没有波次时后端会回一句业务说明（如「仓库无可用库位」），那是**正常答复**，不是故障。
      补货需求只针对<b>配过拣货位上/下限的商品</b>，没配过的商品不会出现在这里。
    </p>
  </div>
</template>

<script setup>
/* 出入库策略（仓配管理 · 仓库作业）—— 数据源：**复用** `/api/wms/*`（v86/v88 既有，只读）。
   ------------------------------------------------------------------
   🔴 本页**全部只读**：四个端点都只是"算给你看"，不会写库存、不改库位。
      所以没有新建/保存按钮，也不需要二次确认 —— 这与出库单/盘点单是本质区别。

   🔴 `{"error": ...}` 是**业务答复**，不是异常：
      `putaway_strategy` 在没有任何库位时 `return {"error": "仓库无可用库位"}`，
      `pick_path_optimize` 在波次无待拣项时 `return {"error": "波次无可拣货项"}` ——
      两者都是 HTTP **200**（handler 直接 return，没 raise）。前端 `api()` 只在 `!res.ok`
      时抛错 ⇒ 这两个形状会**正常 resolve**。必须显式判 `r.error` 并按"提示"展示，
      否则页面会渲染一张空表 + 空字段（看起来像坏了，实际是正常空态）。
      同理：绝不能因为拿到 `{error}` 就 toast「失败」——那是把正常答复报成故障。

   🔴 「补货需求」只覆盖**配过拣货位上下限**的商品（后端 SQL：
      `pick_face_config WHERE pick_face_qty < min_qty`）。不是"全仓低于安全库存"，
      别把它和 P0 的「库存预警」混为一谈 —— 两者数据源与口径都不同。

   🔴 仓库选择器是**页面级**的（补货 / 越库 / 上架三块共用）：
      这三块语义上都是"某个仓库里怎么放/怎么补"，用同一个仓库上下文才自洽。
      换成每块各一个选择器，同一屏会出现三个不同仓库的建议并列（读数无从比对）。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast } from '../../store'
import ProductCombo from '../inventory/new/ProductCombo.vue'

const whId = ref(1)
const warehouses = ref([])
const products = ref([])

const rep = ref({ loading: false, err: '', rows: [] })
const dock = ref({ loading: false, err: '', data: null })
const put = ref({ loading: false, err: '', bizErr: '', data: null })
const pick = ref({ loading: false, err: '', bizErr: '', data: null })

const putRow = ref({ product_id: 0 })
const waveId = ref(null)

const loadingAny = computed(() =>
  rep.value.loading || dock.value.loading || put.value.loading || pick.value.loading)

function fmtQty (n) {
  const v = Number(n || 0)
  if (!Number.isFinite(v)) return '—'
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}
function needOf (r) {
  return Number(r.min_qty || 0) - Number(r.pick_face_qty || 0)
}
function zoneText (z) {
  return { fast: '快流区', medium: '中流区', slow: '慢流区' }[z] || (z || '—')
}

async function loadRep () {
  rep.value = { loading: true, err: '', rows: [] }
  try {
    rep.value = { loading: false, err: '', rows: await whApi.wmsReplenNeeded(whId.value) }
  } catch (e) {
    rep.value = { loading: false, err: e.message || '补货需求读取失败', rows: [] }
  }
}

async function loadDock () {
  dock.value = { loading: true, err: '', data: null }
  try {
    const d = await whApi.wmsCrossDock(whId.value)
    dock.value = { loading: false, err: '', data: d || null }
  } catch (e) {
    dock.value = { loading: false, err: e.message || '越库机会读取失败', data: null }
  }
}

async function doPutaway () {
  if (put.value.loading) return
  const pid = Number(putRow.value.product_id || 0)
  if (!pid) { toast('请先选择商品', 'warn'); return }
  put.value = { loading: true, err: '', bizErr: '', data: null }
  try {
    const r = await whApi.wmsPutaway(pid, whId.value)
    if (r && r.error) {
      put.value = { loading: false, err: '', bizErr: r.error, data: null }
    } else {
      put.value = { loading: false, err: '', bizErr: '', data: r || null }
    }
  } catch (e) {
    put.value = { loading: false, err: e.message || '上架建议计算失败', bizErr: '', data: null }
  }
}

async function doPickPath () {
  if (pick.value.loading) return
  const wid = Number(waveId.value || 0)
  if (!wid) { toast('请先输入波次编号', 'warn'); return }
  pick.value = { loading: true, err: '', bizErr: '', data: null }
  try {
    const r = await whApi.wmsPickPath(wid)
    if (r && r.error) {
      pick.value = { loading: false, err: '', bizErr: r.error, data: null }
    } else {
      pick.value = { loading: false, err: '', bizErr: '', data: r || null }
    }
  } catch (e) {
    pick.value = { loading: false, err: e.message || '拣货路径计算失败', bizErr: '', data: null }
  }
}

function reloadAll () {
  loadRep()
  loadDock()
  /* 主动计算过的两块**不重置** —— 用户点"刷新"是想要最新的仓库级建议，
     不是想把自己刚算出来的上架/路径结果清掉。 */
}
function onWhChange () {
  rep.value = { loading: false, err: '', rows: [] }
  dock.value = { loading: false, err: '', data: null }
  put.value = { loading: false, err: '', bizErr: '', data: null }
  loadRep()
  loadDock()
}

onMounted(async () => {
  const [w, p] = await Promise.allSettled([whApi.warehouses(), whApi.products()])
  warehouses.value = w.status === 'fulfilled' ? w.value : []
  products.value = p.status === 'fulfilled' ? p.value : []
  if (warehouses.value.length && !warehouses.value.some(x => Number(x.id) === 1)) {
    whId.value = warehouses.value[0].id
  }
  loadRep()
  loadDock()
})
defineExpose({ load: reloadAll })
</script>

<style scoped>
/* 页面私有类一律 `wsp-` 前缀（仓配·出入库策略）。 */
.wsp-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.wsp-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px }
.wsp-lb { font-size: 12px; color: var(--t3); white-space: nowrap }
/* 🔴 必须给显式宽度 + `flex:none`：全局 `.input` 是 `width:100%`，
   在本 flex 行里它的 flex-basis 就成了「整行宽」，`flex-shrink` 按基准宽度分摊，
   结果是这个下拉吃掉几乎整行、把右边的说明文字挤到下一行（实测截图确认过）。
   scoped 规则带 `[data-v-*]` ⇒ 特异性 (0,2,0) 胜过 `.input` 的 (0,1,0)，这里能覆盖住。 */
.wsp-sel { width: 220px; min-width: 220px; flex: none }
.wsp-bar-note { font-size: 12px; color: var(--t3) }

.wsp-panels {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
}

.wsp-p { display: flex; flex-direction: column; min-width: 0 }
.wsp-p-hd {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle);
}
.wsp-p-t {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 14px; font-weight: 600; color: var(--t1);
}
.wsp-p-s { font-size: 12px; color: var(--t3) }
.wsp-p-badge {
  margin-left: auto; font-size: 12px; color: var(--t3);
  font-variant-numeric: tabular-nums;
}
.wsp-p-badge.bad { color: var(--dan) }
.wsp-p-foot { font-size: 12px; color: var(--t3); margin-top: 10px; line-height: 1.7 }

.wsp-tw { max-height: 380px; overflow: auto }
.wsp-dim { color: var(--t3); font-size: 12px }
.wsp-sub { color: var(--t3); font-size: 11px; margin-top: 2px }
.wsp-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.wsp-need { color: var(--p-ink); font-weight: 600; font-variant-numeric: tabular-nums }

.wsp-empty { padding: 28px 12px }
.wsp-hint { font-size: 12px; color: var(--t3); margin-top: 6px }

.wsp-inline-err {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--dan);
  border-radius: var(--radius-md); background: var(--bg2); color: var(--danger-txt);
}
.wsp-biz {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--war);
  border-radius: var(--radius-md); background: var(--bg2); color: var(--war);
}

.wsp-dock-kpi {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  margin-bottom: 10px; font-size: 12px; color: var(--t2);
}
.wsp-dock-kpi b { color: var(--t1); font-variant-numeric: tabular-nums }
.wsp-dock-hit b { color: var(--p-ink) }

.wsp-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 12px }
.wsp-fld { display: flex; flex-direction: column; gap: 4px; min-width: 140px }
.wsp-fld-prod { flex: 1; min-width: 240px }
.wsp-wave { width: 160px }
/* 同上（见 `WhItems.vue` 同段注释）：`ProductCombo` 未选中时是空 span ⇒ 本页是**手动触发**的
   面板，一个看不见的点击区尤其致命（用户不知道要先去哪儿选商品）。做成输入框外观 + 占位文案。 */
.wsp-p :deep(.ipn-v) {
  min-height: 38px; line-height: 36px; padding: 0 14px;
  border: 1px solid var(--bd); border-radius: var(--radius-md);
  background: var(--bg3); font-size: 13px;
}
.wsp-p :deep(.ipn-v.is-ph)::before { content: '点击搜索商品'; color: var(--t3) }

.wsp-result {
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2); padding: 12px 14px;
}
.wsp-r-row { display: flex; align-items: baseline; gap: 12px; padding: 3px 0; font-size: 13px }
.wsp-r-lb { width: 76px; flex: none; color: var(--t3); font-size: 12px }
.wsp-r-v { color: var(--t1) }
.wsp-r-hi { font-weight: 600; color: var(--p-ink); font-variant-numeric: tabular-nums }
.wsp-reason {
  margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-subtle);
  font-size: 12px; color: var(--t2); line-height: 1.7;
}

.wsp-idle {
  display: flex; align-items: center; gap: 8px;
  padding: 18px 12px; font-size: 12px; color: var(--t3);
}

.wsp-foot { font-size: 12px; color: var(--t2); margin-top: 14px; line-height: 1.7 }
</style>
