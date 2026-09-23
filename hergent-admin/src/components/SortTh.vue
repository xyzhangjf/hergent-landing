<template>
  <th
    class="sortable"
    :class="{ sorted: sortKey === field }"
    @click="$emit('toggle', field)"
  >
    <span>{{ label }}</span>
    <span class="arrow">{{ sortKey === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕' }}</span>
  </th>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  field: { type: String, required: true },
  sortKey: { type: String, default: '' },
  sortDir: { type: String, default: 'asc' },
})
defineEmits(['toggle'])
</script>
