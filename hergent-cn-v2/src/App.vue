<template>
  <ErrorBoundary>
    <router-view />
  </ErrorBoundary>

  <!-- v306c：部署自检提示 —— 服务器上已发新版本、而当前页面还跑着旧代码时显式提示。
       🔴 为什么需要它：SPA 一旦打开就把 JS 留在内存里，服务器重新部署不会自动生效，
          表现就是「你说修好了，我点了还是失败」，且**毫无提示**（只能靠人猜）。
       位置沿用 toast 的「底部居中」安全带（不压页头控件、不压左侧导航），
       上移 44px 与 toast 错开，两者不会叠在一起。 -->
  <Transition name="toast">
    <button v-if="updateReady" class="upd-tip" type="button" @click="reloadApp">
      <span class="upd-dot"></span>
      有新版本可用
      <span class="upd-act">点击刷新</span>
    </button>
  </Transition>

  <Transition name="toast">
    <div v-if="store.ui.toast" class="toast" :class="store.ui.toast.type">
      {{ store.ui.toast.msg }}
    </div>
  </Transition>
</template>

<script setup>
import { store } from './store'
import ErrorBoundary from './components/ErrorBoundary.vue'
import { useAppUpdate } from './composables/useAppUpdate'

/* v306c：部署自检 —— 只提示，不自动刷新（老板可能正在输入框里打字）。 */
const { hasNew: updateReady, reload: reloadApp } = useAppUpdate()
</script>

<style scoped>
.toast{
  position:fixed;left:50%;bottom:96px;transform:translateX(-50%);
  z-index:9999;padding:10px 18px;border-radius:12px;
  background:var(--t1);color:var(--bg);font-size:13px;
  box-shadow:var(--shadow-lg);max-width:80vw;
}
.toast.error{background:var(--dan);color:#fff}
.toast.success{background:var(--suc);color:#fff}
.toast-enter-active,.toast-leave-active{transition:all .25s}
.toast-enter-from,.toast-leave-to{opacity:0;transform:translateX(-50%) translateY(8px)}

/* v306c：部署自检提示（底部居中小胶囊，避开页头与左侧导航，不与 toast 重叠） */
.upd-tip{
  position:fixed;left:50%;bottom:140px;transform:translateX(-50%);
  z-index:var(--z-toast, 9999);
  display:inline-flex;align-items:center;gap:8px;
  padding:9px 16px;border-radius:999px;border:1px solid transparent;
  background:var(--t1);color:var(--bg);font:inherit;font-size:13px;line-height:1;
  cursor:pointer;box-shadow:var(--shadow-lg);
}
.upd-tip:hover{opacity:.92}
.upd-dot{width:7px;height:7px;border-radius:50%;background:var(--suc);flex:none}
.upd-act{opacity:.72;text-decoration:underline;text-underline-offset:2px}
.upd-tip.toast-enter-from,.upd-tip.toast-leave-to{opacity:0;transform:translateX(-50%) translateY(8px)}
</style>
