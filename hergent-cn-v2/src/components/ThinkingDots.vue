<template>
  <!--
    「思考中 / 等待中」动画：三个依次循环跳动的小圆点 + 文案。

    运行环境：企业微信内置浏览器里的 H5 页面（非小程序、非原生容器）。
    动画只用 transform + opacity 两个属性 —— 它们走 GPU 合成层，
    不触发重排与重绘，在企微 WebView（安卓 X5/Chromium、苹果 WKWebView）里不掉帧。

    用法：
      <ThinkingDots />                        默认：三点 + 「思考中…」，文案在右侧
      <ThinkingDots layout="below" />         文案在下方
      <ThinkingDots :active="isLoading" />    关断：false 时组件立即卸载，动画零残留

    ── 可调位置（默认值逐项对齐 Web 版副驾现有动效，见 CopilotDrawer 历史实现）──
      圆点直径  size = 6 像素
      圆点间距  gap = 4 像素
      跳动高度  lift = 2 像素（向上）
      一轮时长  duration = 1200 毫秒
      相位差    stagger = 200 毫秒（第 2、3 个圆点依次延后）
      透明度    最低 0.25 → 最高 1（写在下方 @keyframes td-bounce 里）
      颜色      color 默认 var(--t3)：浅色 = #a1a1a6，深色 = #8e8e93，随主题自动切换
                ⚠️ 若气泡底色较深、觉得点太淡，可传 color="var(--t2)" 提升对比度
      文案      text = 「思考中…」；字号 fontSize = 12 像素
  -->
  <span
    v-if="active"
    class="td"
    :class="`td-${layout}`"
    :style="cssVars"
    role="status"
    aria-live="polite"
    :aria-label="ariaText"
  >
    <span class="td-dots" aria-hidden="true">
      <i v-for="n in count" :key="n" :style="{ animationDelay: (n - 1) * stagger + 'ms' }"></i>
    </span>
    <em v-if="text" class="td-tx">{{ text }}</em>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 文案；传空字符串则只显示圆点
  text: { type: String, default: '思考中…' },
  // 圆点个数（默认 3 个，与 Web 版一致）
  count: { type: Number, default: 3 },
  // 开关：false 时整个组件不渲染 —— 请求结束 / 报错 / 用户取消时置 false 即可，动画不会残留
  active: { type: Boolean, default: true },
  size: { type: Number, default: 6 },        // 圆点直径（像素）
  gap: { type: Number, default: 4 },         // 圆点间距（像素）
  duration: { type: Number, default: 1200 }, // 一轮跳动时长（毫秒）
  stagger: { type: Number, default: 200 },   // 相邻圆点的相位差（毫秒）
  lift: { type: Number, default: 2 },        // 跳动高度（像素，向上为正）
  // 圆点与文案颜色；默认跟随主题变量 --t3，浅色/深色自动切换
  color: { type: String, default: 'var(--t3)' },
  // inline = 文案在圆点右侧；below = 文案在圆点下方
  layout: { type: String, default: 'inline' },
  fontSize: { type: Number, default: 12 }    // 文案字号（像素）
})

// 把可调参数写成 CSS 变量：外部既能用属性传，也能用 CSS 覆盖，两路都通
const cssVars = computed(() => ({
  '--td-size': props.size + 'px',
  '--td-gap': props.gap + 'px',
  '--td-dur': props.duration + 'ms',
  '--td-lift': props.lift + 'px',
  '--td-color': props.color,
  '--td-fs': props.fontSize + 'px'
}))

// 无障碍朗读去掉省略号，避免读屏念成「点点点」
const ariaText = computed(() => (props.text || '加载中').replace(/…+$/, ''))
</script>

<style scoped>
.td {
  display: inline-flex;
  align-items: center;
  /* 上下留白 4 像素：给圆点向上跳动留出空间，避免被父级容器裁掉 */
  padding: 4px 0;
  vertical-align: middle;
}

/* 文案在下方的排布 */
.td-below {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.td-dots {
  display: inline-flex;
  align-items: center;
  gap: var(--td-gap, 4px);
}

/* 只动 transform 与 opacity ⇒ 合成层动画，不触发重排，企微内不卡顿 */
.td-dots i {
  width: var(--td-size, 6px);
  height: var(--td-size, 6px);
  border-radius: 50%;
  background: var(--td-color, var(--t3));
  animation: td-bounce var(--td-dur, 1.2s) infinite;
  will-change: transform, opacity;
  transform: translate3d(0, 0, 0);
  /* 部分安卓内核合成时边缘会抖一下，这两行是常规消抖写法 */
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

@keyframes td-bounce {
  /* 一轮里：0% 起点低位、40% 跳到最高、80% 落回，之后静止到 100% —— 与 Web 版节奏一致 */
  0%, 80%, 100% { opacity: .25; transform: translate3d(0, 0, 0); }
  40% { opacity: 1; transform: translate3d(0, calc(var(--td-lift, 2px) * -1), 0); }
}

@keyframes td-breathe {
  0%, 100% { opacity: .3; }
  50% { opacity: 1; }
}

.td-tx {
  font-style: normal;
  font-size: var(--td-fs, 12px);
  line-height: 1;
  color: var(--td-color, var(--t3));
}

.td-inline .td-tx { margin-left: 7px; }

/* 系统开启「减弱动态效果」时：不再跳动，只做轻微明暗呼吸，仍可辨认「在等」 */
@media (prefers-reduced-motion: reduce) {
  .td-dots i {
    animation-name: td-breathe;
    transform: none;
  }
}
</style>
