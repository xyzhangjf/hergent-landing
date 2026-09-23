<template>
  <teleport to="body">
    <div class="modal-mask" v-if="show" @click.self="$emit('close')">
      <div class="modal">
        <div class="modal-head">
          <span>{{ title }}</span>
          <span class="close" @click="$emit('close')">×</span>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div class="modal-foot" v-if="$slots.footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
defineProps({ show: Boolean, title: String })
defineEmits(['close'])
</script>
