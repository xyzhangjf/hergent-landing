<template>
  <router-view />
  <Transition name="toast">
    <div v-if="store.ui.toast" class="toast" :class="store.ui.toast.type">
      {{ store.ui.toast.msg }}
    </div>
  </Transition>
</template>

<script setup>
import { store } from './store'
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
</style>
