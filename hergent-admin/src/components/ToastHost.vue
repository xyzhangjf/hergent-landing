<template>
  <div class="toast-host" role="status" aria-live="polite">
    <div v-for="t in toast.items" :key="t.id" class="toast" :class="t.type">
      <span>{{ t.message }}</span>
      <button v-if="t.action" type="button" class="toast-act" @click="toast.runAction(t.id)">
        {{ t.action.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { useToastStore } from '../store/toast'
const toast = useToastStore()
</script>
