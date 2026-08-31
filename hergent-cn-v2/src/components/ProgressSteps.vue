<template>
  <div class="ps">
    <div v-for="(s, i) in steps" :key="i" class="ps-step" :class="'ps-' + (s.status || autoStatus(i))">
      <div class="ps-node">
        <svg v-if="s.status === 'done' || autoDone(i)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span v-else class="ps-dot"></span>
      </div>
      <div class="ps-label">{{ s.label }}</div>
      <div v-if="i < steps.length - 1" class="ps-line" :class="{ on: s.status === 'done' || autoDone(i) }"></div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  steps: { type: Array, required: true } // [{ label, status?: 'done'|'active'|'todo' }]
})

// 未显式给状态时的推断：第一个非 done 视为 active，其后为 todo
function autoDone(i) { return props.steps[i].status === 'done' }
function autoStatus(i) {
  if (props.steps[i].status) return props.steps[i].status
  const firstActive = props.steps.findIndex(s => s.status !== 'done')
  if (firstActive === -1) return 'done'
  return i < firstActive ? 'done' : (i === firstActive ? 'active' : 'todo')
}
</script>

<style scoped>
.ps{display:flex;align-items:flex-start;width:100%;padding:4px 2px;overflow-x:auto}
.ps-step{position:relative;display:flex;flex-direction:column;align-items:center;flex:1;min-width:54px}
.ps-node{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid var(--bd);color:#fff;background:var(--bg);flex-shrink:0;z-index:1}
.ps-dot{width:8px;height:8px;border-radius:50%;background:var(--t3)}
.ps-label{font-size:11px;color:var(--t3);margin-top:5px;text-align:center;line-height:1.3}
.ps-line{position:absolute;top:11px;left:50%;width:100%;height:2px;background:var(--bd);z-index:0}

.ps-done .ps-node{background:var(--suc);border-color:var(--suc)}
.ps-done .ps-label{color:var(--t2)}
.ps-active .ps-node{border-color:var(--p-dark);background:var(--p-bg);animation:ps-pulse 1.4s infinite}
.ps-active .ps-label{color:var(--p-dark);font-weight:600}
.ps-active .ps-dot{background:var(--p-dark)}
.ps-todo .ps-node{border-color:var(--bd)}
.ps-done .ps-line.on{background:var(--suc)}

@keyframes ps-pulse{0%,100%{box-shadow:0 0 0 0 rgba(6,182,212,.35)}50%{box-shadow:0 0 0 5px rgba(6,182,212,0)}}
</style>
