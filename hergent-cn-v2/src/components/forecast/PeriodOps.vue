<script setup>
/* ---- 关闭期次（定稿）确认弹窗（F5 从 Forecast.vue 抽离的懒加载叶子，v560）----
   🔴 抽离铁律：函数体一字不改，只动「组件边界 + props/emits」。
   父组件保留 open / target 两个 ref + 入口分发：「关闭期次」有**两个入口**
   （横幅「就地关闭」askClose + 往期预报列表 @close → onHistoryClose）。
   🔴 控制器型收口：本组件只调后端 closePeriod 接口，成功后
      emit('close') 关自己 + emit('confirmed') 让父级做**页面级**刷新
      （重挂往期预报 + 刷新期次下拉）—— 页面状态不由弹窗持有。
   🔴 样式：专属类（.close-* / .cn-*）随组件自含；**壳层类**（.imp-modal / .imp-hd /
      .imp-x / .imp-body / .imp-tip / .del-actions / .warn-text）走全局
      `src/styles/forecast-modal.css`（v560 建立）—— 见 v558/v559 判据：
      scoped 父组件的 data-v 只打在子组件根元素上，壳层类留在父级会**静默失效**。 */
import { ref, onMounted } from 'vue'
import { forecastApi, productTargetsApi } from '../../api/modules'
import { fmt } from '../../utils/forecast/format.js'
import { toast } from '../../store'
import Icon from '../Icon.vue'

const props = defineProps({
  open:   { type: Boolean, default: false },
  target: { type: Object,  default: null },   // = 父级 closeTarget（本期要关闭的期次 row）
})
const emit = defineEmits(['close', 'confirmed'])

// 关闭期次（两处入口共用：工具栏「关闭期次」+ 往期预报列表「关闭」）
const closing = ref(false)
/* v318：定稿（= 关闭期次）确认弹窗里要列出「本次要推送给谁、每个商品加/减多少」。
   为什么必须在**弹窗里**先说清：定稿后通知就出去了，事后无法收回；而经理点这一下时
   并不知道自己上一步在汇总表填的加单量会变成 5 个人的手机通知。 */
const closeDetail = ref(null)      // { items: [...], people: N }
const closeDetailErr = ref('')
const closeExpandPid = ref(0)      // 展开逐人明细的商品

/* 拉本期分配明细，凑出确认弹窗要展示的行。
   数据源 = `GET /extra-alloc`（**只读**，不重算）—— 与业务员收到的通知**同一份数据**，
   否则会出现「弹窗说发 3 条、实际按另一份数发了 5 条」。 */
/* 原 `askClose()` 里的 `loadCloseDetail(row.id)` 改由挂载时执行 ——
   本组件是 `v-if` 懒加载，每次打开都重新挂载 ⇒ 拉到的自然是这一期的数据。 */
onMounted(() => { loadCloseDetail(props.target && props.target.id) })

async function loadCloseDetail(pid) {
  closeDetail.value = null
  closeDetailErr.value = ''
  closeExpandPid.value = 0
  if (Number(pid) <= 0) return
  try {
    const d = await productTargetsApi.extraAlloc(pid)
    /* 🔴 v629 修真缺陷（同 AllocPanel 第五例）：`api()` 已把 `{success,data}` 解包，
       这里的 `d` 就是 `{period, items, caliber}` 本体 —— **不能再取 `d.data`**。
       原写法恒 `{}` ⇒ 关闭期次确认弹窗里的「定稿推送明细」**永远空**（一行都没有），
       而后端关闭时是**按真实数据**推的 —— 恰好是上面注释最怕的
       「弹窗说的和实际发的是两个数」，只是方向反过来（弹窗说 0 条、实际发了 N 条）。
       已核对后端 product_targets.py：`return {"success":True,"data":{...items...}}` ⇒ 单层。 */
    const src = (d && d.items) || {}
    const items = []
    const seen = new Set()
    Object.keys(src).forEach(k => {
      const it = src[k] || {}
      const rows = (it.rows || []).filter(x => Math.abs(Number(x.alloc_box) || 0) > 1e-9)
      if (!rows.length) return
      const allocated = rows.reduce((s, x) => s + (Number(x.alloc_box) || 0), 0)
      rows.forEach(x => { if (Number(x.employee_id) > 0) seen.add(Number(x.employee_id)) })
      items.push({
        product_id: Number(k),
        name: it.product_name || ('商品#' + k),
        verb: allocated >= 0 ? '加单' : '减单',
        people: rows.length,
        total: allocated,
        short: Number(it.short_box) || 0,
        notFull: it.fully_applied === false && (Number(it.short_box) || 0) > 0,
        rows: rows.map(x => ({
          employee_id: Number(x.employee_id) || 0,
          employee_name: x.employee_name || ('员工' + x.employee_id),
          ratio: Number(x.ratio) || 0,
          reported_box: Number(x.reported_box) || 0,
          alloc_box: Number(x.alloc_box) || 0,
          final_box: Number(x.final_box) || 0,
        })),
      })
    })
    closeDetail.value = { items, people: seen.size }
  } catch (e) {
    // 读不到不等于"没有" ⇒ 明确说"读取失败"，不要让弹窗看起来像"本期没有加单"
    closeDetailErr.value = (e && e.message) || '读取加单/减单明细失败'
  }
}

async function confirmClose() {
  const row = props.target
  if (!row) return
  // A6 防御：合成行（id<0）无真实期次记录，关闭会 UPDATE 0 行伪成功
  if (Number(row.id) <= 0) { emit('close'); toast('合成报单行不可关闭', 'warn'); return }
  closing.value = true
  try {
    const r = await forecastApi.closePeriod(row.id)
    emit('close')
    /* 页面级副作用交给父级（emit('confirmed')）：重挂往期预报 + 刷新期次下拉 / 滚动期次。
       🔴 这两个是**页面**状态，不由弹窗持有 —— 与 AllocPanel 同一条控制器型收口纪律（v560）。 */
    emit('confirmed')

    /* v318：回执里带上"通知发了几条、几个人"。这必须显示 —— 经理点了定稿就该知道
       通知到底出没出去；只回一句「已关闭期次」等于把推送这一步变成不可见的。
       ⚠️ skipped > 0 = 有人**没有**登录账号 ⇒ 通知没送到他手上（不是"发失败"），
          要点名提示去员工档案关联账号，否则「系统说通知了、业务员说没收到」。 */
    const nf = (r && r.notified) || null
    if (nf && (nf.sent || nf.skipped)) {
      const bits = ['已定稿：' + (row.name || '')]
      bits.push(`已通知 ${nf.people} 人（共 ${nf.sent} 条加单/减单明细）`)
      if (nf.skipped) bits.push(`有 ${nf.skipped} 条未发出：对应员工未关联登录账号，请到「员工档案」补关联`)
      toast(bits.join('；'), nf.skipped ? 'warn' : 'ok')
    } else {
      toast('已定稿：' + (row.name || '') + '（本期无加单/减单，未发送通知）', 'ok')
    }
  } catch (e) {
    toast('关闭失败: ' + (e.message || ''), 'err')
  } finally {
    closing.value = false
  }
}
</script>

<template>
<!-- 关闭期次确认弹窗（始终渲染，确保两入口可唤起） -->
<Teleport to="body">
  <Transition name="fade"><div v-if="open" class="imp-overlay" @click="emit('close')"></div></Transition>
  <Transition name="pop">
    <div v-if="open" class="imp-modal del-modal close-modal">
      <div class="imp-hd"><b>确认定稿 · 关闭期次</b><button class="imp-x" @click="emit('close')"><Icon name="close"/></button></div>
      <div class="imp-body">
        <!-- v219：原文案只说「不可再编辑」，**没说**关闭会连带关掉销售的报单通道 ——
             那是这条操作最容易被忽略的副作用（定稿 = 停止收报单）。同时补上「可重开」，
             否则「仅可删除」会让人以为关闭不可逆（2026-09-21 前确实不可逆，现在不是了）。
             🔴 v319：原文案让用户去点「重开」，但那条路会**连带重开销售报单通道**
             （副作用远大于"只想改个数"）。现拆成两个语义入口，文案必须指向对的那个。 -->
        <p class="imp-tip warn-text">确认关闭期次「{{ target && target.name }}」？<b>关闭 = 定稿</b>：该期次不可再编辑，且<b>销售的小程序报单通道会同时关闭</b>（不再接收新报单）。如需改动：到「往期预报」里点<b>「解锁编辑」</b>（只放开改数，销售照旧报不了单）；确实还要让销售补报，再点<b>「恢复报单」</b>。</p>
        <!-- v318：定稿会把加单/减单明细**逐人推送**到小程序「我的通知」，推送出去就收不回来
             ⇒ 推送内容必须在这一步先亮出来让人核对（而不是点完才知道发了什么）。 -->
        <div class="close-nf">
          <div class="close-nf-hd">定稿后将推送给相关人员的加单 / 减单明细</div>
          <p v-if="closeDetailErr" class="close-nf-none bad">
            读取加单/减单明细失败（{{ closeDetailErr }}）—— 仍可定稿，但**推送内容未经核对**。
          </p>
          <template v-else-if="closeDetail">
            <p v-if="!closeDetail.items.length" class="close-nf-none">
              本期没有加单 / 减单 ⇒ 定稿后<b>不会发送任何通知</b>。
            </p>
            <template v-else>
              <div class="close-nf-wrap">
                <table class="close-nf-tbl">
                  <thead>
                    <tr><th>商品</th><th>方向</th><th class="num">涉及</th><th class="num">合计(箱)</th><th></th></tr>
                  </thead>
                  <tbody>
                    <template v-for="it in closeDetail.items" :key="it.product_id">
                      <tr :class="{ 'not-full': it.notFull }">
                        <td class="cn-name">{{ it.name }}</td>
                        <td>{{ it.verb }}</td>
                        <td class="num">{{ it.people }} 人</td>
                        <td class="num">{{ it.total >= 0 ? '+' : '−' }}{{ fmt(Math.abs(it.total)) }}</td>
                        <td class="num">
                          <button type="button" class="cn-exp"
                                  @click="closeExpandPid = (closeExpandPid === it.product_id ? 0 : it.product_id)">
                            {{ closeExpandPid === it.product_id ? '收起' : '逐人明细' }}
                          </button>
                        </td>
                      </tr>
                      <tr v-if="closeExpandPid === it.product_id" class="cn-detail">
                        <td colspan="5">
                          <div v-for="p in it.rows" :key="p.employee_id" class="cn-p">
                            <span class="cn-pname">{{ p.employee_name }}</span>
                            <span>占比 {{ fmt(p.ratio) }}%</span>
                            <span>报 {{ fmt(p.reported_box) }} ⇒ 定稿 {{ fmt(p.final_box) }} 箱</span>
                            <b :class="p.alloc_box >= 0 ? 'cn-add' : 'cn-cut'">
                              {{ p.alloc_box >= 0 ? '加' : '减' }} {{ fmt(Math.abs(p.alloc_box)) }} 箱
                            </b>
                          </div>
                          <!-- 「分不满」必须点名：否则经理以为全都推出去了，而实际有人的数据没分完 -->
                          <div v-if="it.notFull" class="cn-p bad">
                            ⚠ 该商品<b>未分满</b>，还差 {{ fmt(it.short) }} 箱
                            （成因：目标分解占比合计不足 100%，或减单时有人报量不够被夹到 0）
                          </div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <p class="close-nf-sum">
                定稿后把以上明细<b>逐人推送</b>到各自的「我的通知」（小程序 / 网页端铃铛都能查），
                共涉及 <b>{{ closeDetail.people }}</b> 人。
              </p>
            </template>
          </template>
          <p v-else class="close-nf-none">正在读取加单 / 减单明细…</p>
        </div>
        <div class="del-actions">
          <button class="btn btn-ghost" @click="emit('close')">取消，继续修改</button>
          <button class="btn btn-primary" :disabled="closing" @click="confirmClose">{{ closing ? '定稿并推送中…' : '确定定稿' }}</button>
        </div>
      </div>
    </div>
  </Transition>
</Teleport>
</template>

<style scoped>
.close-modal{width:min(660px,94vw)}
.close-nf{margin:10px 0 2px;padding:9px 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg2)}
.close-nf-hd{font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px}
.close-nf-none{margin:4px 0;font-size:12px;color:var(--t3);line-height:1.6}
.close-nf-none.bad{color:var(--danger-txt)}
.close-nf-wrap{max-height:216px;overflow:auto;border:1px solid var(--bd);border-radius:4px;background:var(--bg)}
.close-nf-tbl{width:100%;border-collapse:collapse;font-size:12px}
.close-nf-tbl th{position:sticky;top:0;z-index:1;background:var(--bg3);color:var(--t2);font-weight:600;text-align:left;padding:5px 7px;border-bottom:1px solid var(--bd);white-space:nowrap}
.close-nf-tbl td{padding:5px 7px;border-bottom:1px solid var(--bd);vertical-align:top;color:var(--t1)}
.close-nf-tbl .num{text-align:right}
.close-nf-tbl tr.not-full td{background:var(--warn-amber-bg)}
.cn-name{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cn-exp{font-size:11px;padding:1px 6px;border:1px solid var(--bd);border-radius:3px;background:var(--bg);color:var(--t3);cursor:pointer}
.cn-exp:hover{border-color:var(--p-dark);color:var(--p-dark)}
.cn-detail td{background:var(--bg3)}
.cn-p{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--t2);padding:2px 0;line-height:1.6}
.cn-p.bad{color:var(--danger-txt)}
.cn-pname{min-width:64px;font-weight:600;color:var(--t1)}
.cn-add{color:var(--p-dark);font-weight:600}
.cn-cut{color:var(--danger-txt);font-weight:600}
.close-nf-sum{margin:7px 0 0;font-size:12px;color:var(--t2);line-height:1.6}
</style>
