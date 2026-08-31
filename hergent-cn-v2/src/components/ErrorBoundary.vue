<template>
  <slot v-if="!errored" />
  <div v-else class="err-boundary">
    <div class="err-card">
      <div class="err-title">页面出错了</div>
      <div class="err-msg">{{ msg }}</div>
      <button class="err-btn" @click="retry">点此重试</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'

const errored = ref(false)
const msg = ref('')

function retry() {
  errored.value = false
  msg.value = ''
  window.location.reload()
}

// 捕获子孙组件渲染/生命周期中的未处理错误，避免整页白屏（P0 评审清单）。
onErrorCaptured((err) => {
  errored.value = true
  msg.value = (err && err.message) ? err.message : '渲染时发生未知错误'
  console.error('[ErrorBoundary]', err)
  return false // 阻止继续向上冒泡，由本边界统一兜底
})
</script>

<style scoped>
.err-boundary{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg);z-index:99999}
.err-card{padding:28px 32px;border-radius:16px;background:var(--bg2);box-shadow:var(--shadow-lg);max-width:420px;text-align:center}
.err-title{font-size:17px;font-weight:600;color:var(--t1);margin-bottom:8px}
.err-msg{font-size:13px;color:var(--t2);margin-bottom:16px;word-break:break-word;line-height:1.5}
.err-btn{padding:8px 18px;border:none;border-radius:10px;background:var(--p);color:#fff;font-size:13px;cursor:pointer}
.err-btn:hover{opacity:.9}
</style>
