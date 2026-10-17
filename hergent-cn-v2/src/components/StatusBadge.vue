<template>
  <!-- v538：启用 / 停用状态徽章。
       全复用全局 `.badge` + `.badge-green` / `.badge-red`（variables.css 593-598），
       cn-v2 的徽章是纯文字（无圆点），本组件不引入 admin 的 dot，保持现状视觉。 -->
  <span class="badge" :class="active ? 'badge-green' : 'badge-red'">
    {{ active ? '启用' : '停用' }}
  </span>
</template>

<script setup>
defineProps({
  active: { type: [Boolean, Number], default: true },
})
</script>
