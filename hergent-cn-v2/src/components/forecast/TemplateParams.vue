<template>
  <!-- v160 模板参数：生成舟谱导入模板时写进「业务员 / 部门 / 仓库」列的值（租户级）。
       原先这些值硬编码在后端代码里，且是**一家客户的值** —— 换一家客户就全错。

       v424（2026-10-10）：从 `pages/ReportMapping.vue` 抽出为本组件。
       起因：「报单配置」整页要按入口拆成四个独立子页（见 `Shell.vue::NAV`
       「报单配置」分组的四条），模板参数是其中一条 ⇒ 它必须能**单独渲染**。
       抽出后与 `AutoPeriodBlock.vue` / `ReminderConfig.vue` 同族 ——
       三者都是「报单这件事的一块设置」，各自占一个子页。
       🔴 抽的是**结构与样式**，取值/保存判据一字未改（`businessProfileApi` 唯一写口）。 -->
  <ConfigCard v-model="tpOpen" title="模板参数" subtitle="生成舟谱导入模板时，「业务员 / 部门 / 仓库」列写什么">
    <template #chip>
      <span v-if="profileMissing" class="tp-warn">未设置 · 模板对应列为空</span>
    </template>
    <div class="tp-body tp-body-flat">
      <div class="tp-grid">
        <div class="field">
          <label>公司名称</label>
          <input v-model="tp.company_name" placeholder="如：××商贸有限公司" />
        </div>
        <div class="field">
          <label>默认业务员</label>
          <input v-model="tp.salesman" placeholder="如：张三" />
        </div>
        <div class="field">
          <label>默认仓</label>
          <input v-model="tp.warehouse" placeholder="如：总仓" />
        </div>
        <div class="field">
          <label>自提单号起始序号</label>
          <input v-model.number="tp.zt_seq_start" type="number" min="1" max="99" />
        </div>
        <div class="field tp-wide">
          <label>下单主体</label>
          <input v-model="tpEntities" placeholder="逗号分隔，如：甲户,乙户" />
          <span class="tp-hint">商品名里写「（×××下单）」时，系统据此识别下单主体。只有一个户头可留空。</span>
        </div>
        <!-- v163：每个下单主体对应一个舟谱「部门」。同一商品可被两个户头下单 ⇒ 同一客户
             会拆出两张单（不合并），每张单的「部门」列按该单的户头取；留空则该单回落用
             上面的「公司名称」，并在生成模板时给出提示。 -->
        <div v-if="tpEntityList.length" class="field tp-wide">
          <label>下单主体对应的舟谱「部门」</label>
          <div class="tp-depts">
            <div v-for="e in tpEntityList" :key="e" class="tp-dept-row">
              <span class="tp-dept-name">{{ e }}</span>
              <input v-model="tpDepts[e]" :placeholder="tp.company_name || '如：××商贸有限公司'" />
            </div>
          </div>
          <span class="tp-hint">同一商品用两个户头下单时，会<u>分别生成两张单</u>，各写各的部门。留空则该单回落用「公司名称」，并在生成时提示核对。</span>
        </div>
      </div>
      <div class="tp-actions">
        <!-- v335 按钮级门禁：PUT /api/forecast/business-profile ⇒ 模块 data / 动作 update -->
        <button v-if="canDo('data', 'update')" class="btn btn-primary btn-sm" :disabled="tpSaving" @click="saveProfile">
          {{ tpSaving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </ConfigCard>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { businessProfileApi } from '../../api/modules'
import { toast, canDo } from '../../store'
import ConfigCard from './ConfigCard.vue'

// v160（2026-09-14）：模板参数 —— 舟谱模板的「业务员 / 部门 / 仓库」列、自提单号起始序号、
// 下单主体清单。原先硬编码在后端代码里且是**一家客户的值**，现改为租户自配。
const tpOpen = ref(true)
const tpSaving = ref(false)
const tp = reactive({ company_name: '', salesman: '', warehouse: '总仓', zt_seq_start: 21 })
const tpEntities = ref('')
// v163：户头 → 舟谱「部门」列值。键是下单主体名（与 tpEntities 同源）。
const tpDepts = ref({})
const tpEntityList = computed(() => (tpEntities.value || '').split(/[,，、\s]+/).filter(Boolean))
const profileMissing = computed(() => !tp.company_name || !tp.salesman)

async function loadProfile() {
  try {
    const r = await businessProfileApi.get()
    const p = r.profile || {}
    tp.company_name = p.company_name || ''
    tp.salesman = p.salesman || ''
    tp.warehouse = p.warehouse || '总仓'
    tp.zt_seq_start = p.zt_seq_start || 21
    tpEntities.value = (p.order_entities || []).join(',')
    tpDepts.value = { ...(p.entity_departments || {}) }
    if (profileMissing.value) tpOpen.value = true   // 未配置 → 自动展开引导填写
  } catch { /* 读不到不影响报单配置主流程 */ }
}

async function saveProfile() {
  tpSaving.value = true
  try {
    await businessProfileApi.save({
      company_name: tp.company_name,
      salesman: tp.salesman,
      warehouse: tp.warehouse,
      zt_seq_start: Number(tp.zt_seq_start) || 21,
      order_entities: (tpEntities.value || '').split(/[,，、\s]+/).filter(Boolean),
      // v163：只提交**当前户头清单里**且**非空**的部门名 —— 户头被删掉后它的旧部门名一并清掉，
      // 不留孤儿配置（否则以后重新加回同名户头会悄悄套用一条早已不想要的部门名）。
      entity_departments: Object.fromEntries(
        tpEntityList.value
          .map(e => [e, String(tpDepts.value[e] || '').trim()])
          .filter(([, d]) => d)
      ),
    })
    toast('模板参数已保存')
    await loadProfile()
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally {
    tpSaving.value = false
  }
}

onMounted(loadProfile)
</script>

<style scoped>
/* v160 模板参数卡片（外层已统一为 ConfigCard，这里只保留内部样式） */
.tp-warn{font-size:12px;color:var(--war);background:rgba(var(--war-rgb),.12);border:1px solid rgba(var(--war-rgb),.35);padding:1px 8px;border-radius:10px}
/* tp-body 包在 ConfigCard 内层：去掉自身内距与分隔线，避免与 cfg-body 重复叠加 */
.tp-body{padding:0 16px 14px;border-top:1px solid var(--border-subtle)}
.tp-body-flat{padding:0;border:none}
.tp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;padding:14px 0}
.tp-wide{grid-column:1/-1}
.tp-body .field{display:flex;flex-direction:column;gap:5px}
.tp-body .field label{font-size:12px;color:var(--t2)}
.tp-body .field input{padding:7px 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg2);color:var(--t1);font-size:13px;outline:none}
.tp-body .field input:focus{border-color:var(--p)}
.tp-hint{font-size:11px;color:var(--t3)}
/* v163：户头 → 部门名行（每行一个户头） */
.tp-depts{display:flex;flex-direction:column;gap:6px}
.tp-dept-row{display:flex;align-items:center;gap:8px}
.tp-dept-name{min-width:76px;font-size:12px;color:var(--t2);flex:0 0 auto}
.tp-dept-row input{flex:1;min-width:0}
.tp-actions{display:flex;gap:8px}
/* 输入框基础盒模型（原在 ReportMapping.vue 的 .field 族里，随本卡片一并迁入 ——
   它的 width/box-sizing/height 三条只在这里提供，漏抄会让输入框恢复浏览器默认宽高）。 */
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:2px}
.field input{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:0 11px;font-size:13px;background:var(--bg);color:var(--t1)}
/* C2：按钮对齐全局令牌（.btn/.btn-sm/.btn-primary 为 scoped 复刻，尺寸/圆角与 variables.css 保持一致） */
.btn{border:1px solid var(--border-subtle);background:var(--bg);border-radius:var(--radius-md);padding:7px 13px;font-size:13px;color:var(--t1);cursor:pointer}
.btn-sm{height:32px;padding:0 12px;font-size:13px;border-radius:var(--radius-sm)}
.btn-primary{background:var(--p-dark);border-color:var(--p-dark);color:#fff}
.btn:disabled{opacity:.55;cursor:not-allowed}
</style>
