<template>
  <section class="ch-fig">
    <div class="ch-fig-hd">
      <div class="ch-fig-ti">
        <b v-if="title">{{ title }}</b>
        <span v-if="sub" class="ch-fig-sub">{{ sub }}</span>
      </div>
      <div class="ch-fig-ctl">
        <slot name="ctl" />
        <!-- 导出图片：只在"确实画出来了"的时候给（没画出来就没有可导的东西，
             给一个点了没反应的按钮 = 本项目定义的假入口） -->
        <button
          v-if="showExport && svgReady && !loading && !error && !empty"
          type="button" class="ch-act" :disabled="busy"
          :title="busy ? '正在生成图片' : '导出为 PNG 图片，可直接贴进 PPT 或发给别人'"
          @click="doExport"
        >
          <Icon name="download" :size="13" />{{ busy ? '正在导出' : '导出图片' }}
        </button>
      </div>
    </div>

    <!-- 图例：放在标题下、画布上（与数据同一视线，不必来回找归属） -->
    <slot name="legend" />

    <!-- 载入态 -->
    <div v-if="loading" class="ch-state" :style="{ height: bodyH }">
      <div class="ch-skel" :style="{ height: '100%' }">
        <i v-for="i in 12" :key="i" :style="{ height: (35 + ((i * 37) % 50)) + '%' }"></i>
      </div>
    </div>

    <!-- 🔴 错误态：接口挂了必须说清楚 + 给出口。
         此前 Dashboard 的 catch 是空的 ⇒ 页面只剩骨架屏，用户以为"今天没生意"。
         这是本项目「绝不静默失效」铁律的正面实现。 -->
    <div v-else-if="error" class="ch-state ch-state-err" :style="{ height: bodyH }">
      <div class="ch-err-ti">{{ errorTitle }}</div>
      <div>{{ error }}</div>
      <button type="button" class="btn btn-ghost btn-sm ch-retry" @click="emit('retry')">
        <Icon name="refresh" :size="13" />重试
      </button>
    </div>

    <!-- 空态：「没有数据」与「值是 0」必须分得开 —— 所以这里说的是"这段时间没有…"，
         而不是画一排零高柱子（那会让读者以为"有数据，只是都是 0"）。 -->
    <div v-else-if="empty" class="ch-state" :style="{ height: bodyH }">
      <div>{{ emptyText }}</div>
      <slot name="empty-action" />
    </div>

    <!-- 画布 -->
    <slot v-else />

    <div v-if="note && !loading && !error" class="ch-note">{{ note }}</div>
  </section>
</template>

<script setup>
/* ============================================================================
   ChartFigure.vue —— 图表统一外壳（v491）
   ============================================================================
   收口三件事，让四个图型组件不必各写一遍：
     ① 标题 / 副标题 / 图例 / 操作区的版位；
     ② **载入 / 空 / 错误三态**（错误态带重试出口 —— 不许静默）；
     ③ 「导出图片」按钮：通过 provide/inject 拿到子组件里的 <svg>，不必把 ref 一层层传。
   ⚠️ 三个状态是**互斥**的，且都**占同样高度**（bodyH）——否则切态时页面会跳一下。
   ============================================================================ */
import { computed, provide, ref, shallowRef } from 'vue'
import Icon from '../Icon.vue'
import { toast } from '../../store'
import { exportSvgToPng } from './chartExport'

const props = defineProps({
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  /** 错误文案（人类可读的中文原因）。非空即进错误态 */
  error: { type: String, default: '' },
  /** 错误态标题；默认一句话说清"是图没画出来，不是没有数据" */
  errorTitle: { type: String, default: '图表没画出来' },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '' },
  /** 三态占位高度（px）—— 与真实画布高度对齐，避免切态跳动 */
  height: { type: Number, default: 240 },
  note: { type: String, default: '' },
  showExport: { type: Boolean, default: true },
  /** 导出文件名（不含扩展名） */
  exportName: { type: String, default: '图表' },
})
const emit = defineEmits(['retry'])

const bodyH = computed(() => props.height + 'px')

/* —— 子组件登记它的 <svg> ——
   这样"导出"按钮不必知道是哪种图型；Four 个图型组件各自 watchEffect 登记即可。 */
const svgEl = shallowRef(null)
const svgReady = computed(() => !!svgEl.value)
provide('chFigure', {
  setSvg: (el) => { svgEl.value = el || null },
})

const busy = ref(false)
async function doExport() {
  if (!svgEl.value || busy.value) return
  busy.value = true
  try {
    const ok = await exportSvgToPng(svgEl.value, props.exportName || props.title || '图表')
    // 🔴 不静默：导出失败必须让用户知道（个别浏览器会因安全策略拒绝把图形写进画布）。
    //    成功不弹提示 —— 文件已经出现在下载目录，那本身就是回执。
    if (!ok) toast('图片没能生成，换个浏览器再试一次', 'err')
    else emit('export-result', true)
  } finally {
    busy.value = false
  }
}
</script>
