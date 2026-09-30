<template>
  <ConfigCard v-model="rmOpen" title="报单提醒设置"
    subtitle="谁、什么时候、用什么方式催销售报单 —— 你说了算，保存后立即生效">
    <template #chip>
      <span class="cfg-chip" :class="remind.enabled ? 'on' : 'off'">{{ remind.enabled ? '已开启' : '已关闭' }}</span>
    </template>
    <template #summary>
      <span v-if="!remindLoading" class="cfg-summary">{{ remindSummary }}</span>
    </template>

    <div v-if="remindLoading" class="state-empty"><div class="skel-line" style="width:40%;margin:0 auto"></div></div>
    <template v-else>
      <!-- 总开关 -->
      <div class="set-row remind-master">
        <b class="set-lb">启用报单提醒</b>
        <label class="switch">
          <input type="checkbox" v-model="remind.enabled">
          <span class="slider"></span>
        </label>
        <span class="set-desc">{{ remind.enabled ? '已开启：到期前会自动催报未报门店' : '已关闭：不会自动发送任何报单提醒' }}</span>
      </div>

      <!-- 节点开关 -->
      <div class="set-block">
        <div class="set-block-hd">提醒哪些环节</div>
        <label class="chk"><input type="checkbox" v-model="remind.nodes.new_period"><span>新期次发布时通知</span></label>
        <label class="chk"><input type="checkbox" v-model="remind.nodes.lead"><span>截止前提醒（临近催报）</span></label>
        <label class="chk"><input type="checkbox" v-model="remind.nodes.final"><span>最后时刻提醒（仅剩少量时间）</span></label>
        <label class="chk"><input type="checkbox" v-model="remind.nodes.summary"><span>截止后汇总给主管 / 老板</span></label>
        <p class="set-desc">四个节点各自独立：<b>新期次发布</b>在建表成功那一刻发（不靠钟点，所以不会漏）；<b>截止前</b>与<b>最后时刻</b>按下面的提前量发；<b>截止后汇总</b>默认<b>关闭</b>，勾上才会在关单后发一条统计（收件人：管理员 / 老板）。</p>
      </div>

      <!-- 按销售分组定向 -->
      <div class="set-block">
        <div class="set-block-hd">按销售分组定向（差集）</div>
        <label class="chk"><input type="checkbox" v-model="remind.per_sales"><span>催报里按销售列出「谁还差哪些店」</span></label>
        <p class="set-desc">开启后，提醒会写明「刘小顶 还差：美联保康；张俊峰 还差：东津」，便于你逐个督促。给每位销售建了独立登录账号并与员工档案绑定后，会自动升级为「只发到他本人、他人看不到」。</p>
      </div>

      <!-- 提前量 + 截止时刻 -->
      <div class="set-block">
        <div class="set-block-hd">催报时间</div>
        <div class="set-row">
          <div class="set-field" style="flex:1">
            <label>截止前提醒（提前量）</label>
            <select v-model.number="remind.lead_hours" class="input">
              <option :value="1">提前 1 小时</option>
              <option :value="2">提前 2 小时</option>
              <option :value="3">提前 3 小时</option>
              <option :value="6">提前 6 小时</option>
            </select>
          </div>
          <div class="set-field" style="flex:1">
            <label>最后时刻提醒（提前量）</label>
            <select v-model.number="remind.final_hours" class="input">
              <option :value="1">提前 1 小时</option>
              <option :value="2">提前 2 小时</option>
            </select>
          </div>
          <div class="set-field" style="flex:1">
            <label>每天报单截止时刻</label>
            <input type="time" v-model="remind.deadline_time" class="input">
          </div>
        </div>
        <p class="set-desc">催报时刻 = <b>本期实际关单时刻</b> 减去上面的提前量。关单时刻以「报单配置 → 报单自动化」里的<b>自动关单</b>为准（自动化没开时才用这个「每天报单截止时刻」）。例：关单 11:00、提前 2 小时 ⇒ 09:00 催一次；最后 1 小时 ⇒ 10:00 再催一次。期次若临截止才发布，会在发布后尽快催（不会漏）。</p>
      </div>

      <!-- 渠道 -->
      <div class="set-block">
        <div class="set-block-hd">提醒渠道</div>
        <label class="chk"><input type="checkbox" v-model="remind.channels.inapp"><span>站内信（网页 / 小程序内通知，最稳）</span></label>
        <label class="chk"><input type="checkbox" v-model="remind.channels.wecom"><span>企业微信应用消息（需先接通，未接通时自动跳过）</span></label>
      </div>

      <!-- 免打扰 -->
      <div class="set-block">
        <div class="set-block-hd">免打扰时段（仅影响企业微信推送，站内信不受影响）</div>
        <div class="set-row">
          <div class="set-field" style="flex:1">
            <label>开始</label>
            <input type="time" v-model="remind.quiet.start" class="input">
          </div>
          <div class="set-field" style="flex:1">
            <label>结束</label>
            <input type="time" v-model="remind.quiet.end" class="input">
          </div>
        </div>
        <p class="set-desc">例如 22:00 ~ 08:00 之间不推企业微信，避免深夜打扰；站内信仍可正常查看。</p>
      </div>

      <div class="set-row" style="margin-top:14px">
        <!-- v335 按钮级门禁：PUT /api/forecast/reminder-config ⇒ 模块 data / 动作 update -->
        <button v-if="canDo('data', 'update')" class="btn btn-primary" :disabled="remindSaving" @click="saveReminder">{{ remindSaving ? '保存中…' : '保存设置' }}</button>
        <span class="set-desc">保存后立即对后续所有期次生效；已发出的提醒不会撤回。</span>
      </div>
    </template>
  </ConfigCard>
</template>

<script setup>
import { reactive, ref, computed } from 'vue'
import { api } from '../../api/client'
import { toast, canDo } from '../../store'
import ConfigCard from './ConfigCard.vue'

/* ---- 报单提醒控制面板（从设置页迁至「预报订货管理 → 报单配置」，与报单自动化并列） ---- */
const REMIND_DEFAULT = () => ({
  enabled: true,
  lead_hours: 3,
  final_hours: 1,
  deadline_time: '18:00',
  per_sales: true,
  channels: { inapp: true, wecom: true },
  quiet: { start: '22:00', end: '08:00' },
  nodes: { new_period: true, lead: true, final: true, summary: false },
})
const remind = reactive(REMIND_DEFAULT())
const remindLoading = ref(false)
const remindSaving = ref(false)
const rmOpen = ref(true) // 默认展开，状态芯片/摘要在头部始终可见

// 折叠态头部的一句话摘要：开启时聚合当前催报策略，关闭时一句话说明
const remindSummary = computed(() => {
  if (!remind.enabled) return '提醒已关闭，不会自动发送'
  const parts = []
  if (remind.nodes.lead) parts.push(`截止前${remind.lead_hours}小时催报`)
  if (remind.nodes.final) parts.push(`最后${remind.final_hours}小时`)
  parts.push(remind.per_sales ? '按销售分组' : '全员')
  return parts.join(' · ')
})

async function loadReminder() {
  remindLoading.value = true
  try {
    const d = await api('/api/forecast/reminder-config')
    if (d && d.config) {
      const c = d.config
      Object.assign(remind, REMIND_DEFAULT(), c)
      remind.channels = Object.assign({ inapp: true, wecom: true }, c.channels || {})
      remind.quiet = Object.assign({ start: '22:00', end: '08:00' }, c.quiet || {})
      remind.nodes = Object.assign({ new_period: true, lead: true, final: true, summary: false }, c.nodes || {})
    }
  } catch (e) {
    // 后端无配置时退回默认值即可，不打断
  } finally {
    remindLoading.value = false
  }
}

async function saveReminder() {
  if (remindSaving.value) return
  remindSaving.value = true
  try {
    const d = await api('/api/forecast/reminder-config', {
      method: 'PUT',
      body: JSON.parse(JSON.stringify(remind)),
    })
    if (d && d.ok) toast('报单提醒设置已保存，立即生效', 'success')
    else toast('保存失败', 'error')
  } catch (e) {
    toast((e && e.message) || '保存失败', 'error')
  } finally {
    remindSaving.value = false
  }
}

// 进入「报单配置」tab 即随 ReportMapping 挂载 → 自动加载当前配置
loadReminder()
</script>

<style scoped>
/* 以下为提醒面板专有样式（其余布局类 .card/.btn/.input/.page-sub/.panel-hd/.state-empty/.skel-line 为全局，无需重复） */
.remind-master{align-items:center}
.set-block{margin-top:16px;padding-top:14px;border-top:1px solid var(--bd)}
.set-block-hd{font-size:13px;font-weight:600;color:var(--t1);margin-bottom:10px}
.chk{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t1);padding:5px 0;cursor:pointer}
.chk input{width:16px;height:16px;accent-color:var(--p)}
.set-row{display:flex;align-items:center;gap:10px;padding:8px 0;flex-wrap:wrap}
.set-row>.input{flex:1 1 240px;width:auto;min-width:0}
.set-row>.set-desc{flex:1 1 260px;min-width:0}
.set-lb{display:inline-block;min-width:88px;font-size:13px;color:var(--t2)}
.set-desc{font-size:12px;color:var(--t3);margin:0;line-height:1.7}
/* iOS 风格开关（沿用主题色变量） */
.switch{position:relative;display:inline-block;width:42px;height:24px;flex:none}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;cursor:pointer;inset:0;background:var(--bd);border-radius:999px;transition:.2s}
.slider::before{content:'';position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.switch input:checked + .slider{background:var(--p)}
.switch input:checked + .slider::before{transform:translateX(18px)}
</style>
