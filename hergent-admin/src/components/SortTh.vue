<template>
  <th class="sortable" :class="{ sorted: sortKey === field }" :aria-sort="ariaSort">
    <button type="button" class="th-btn" @click="$emit('toggle', field)">
      <span>{{ label }}</span>
      <span class="arrow" aria-hidden="true">{{
        sortKey === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'
      }}</span>
    </button>
  </th>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  field: { type: String, required: true },
  sortKey: { type: String, default: '' },
  sortDir: { type: String, default: 'asc' },
})
defineEmits(['toggle'])

// 无障碍：向屏幕阅读器播报当前列的排序状态
const ariaSort = computed(() => {
  if (props.sortKey !== props.field) return 'none'
  return props.sortDir === 'asc' ? 'ascending' : 'descending'
})
</script>
