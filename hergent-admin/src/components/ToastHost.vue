<template>
  <div>
    <div v-for="t in toast.items" :key="t.id" class="toast" :class="t.type">{{ t.message }}</div>
  </div>
</template>

<script setup>
import { useToastStore } from '../store/toast'
const toast = useToastStore()
</script>
