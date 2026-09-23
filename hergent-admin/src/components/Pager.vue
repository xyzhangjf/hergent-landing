<template>
  <div class="pager">
    <span class="pager-info">共 {{ total }} 条 · 每页 {{ pageSize }} 条</span>
    <span class="spacer"></span>
    <button class="btn sm" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
    <span class="pager-pos">第 {{ page }} / {{ totalPages }} 页</span>
    <button class="btn sm" :disabled="page >= totalPages" @click="go(page + 1)">下一页</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 20 },
})
const emit = defineEmits(['update:page'])

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

function go(p) {
  if (p >= 1 && p <= totalPages.value) emit('update:page', p)
}
</script>
