<template>
  <!-- 列设置面板（开发规范 §2.6.1「三、」：齿轮 + 固定定位面板）。
       定位/限高由 useColMenu 按齿轮 getBoundingClientRect() 现算；可见性逻辑来自宿主页 useColSettings。
       组件常驻挂载，内部用 v-if 控制显隐，并通过 open(e) 暴露给外部齿轮按钮调用。 -->
  <div v-if="showColMenu" class="col-menu-overlay" @click="showColMenu = false"></div>
  <div v-if="showColMenu" ref="colMenuEl" class="col-menu" :style="colMenuStyle" @click.stop>
    <div class="col-menu-hd">
      <span>显示列</span>
      <button class="col-menu-x" @click="showColMenu = false" title="关闭"><Icon name="close" /></button>
    </div>
    <ul class="col-menu-list">
      <li v-for="c in colList" :key="c.key" :class="{ locked: c.core }">
        <label>
          <input type="checkbox" :checked="isVisible(c.key)" :disabled="c.core"
                 @click.prevent="toggleCol(c.key)" />
          {{ c.label }}<span v-if="c.core" class="col-core-tag">固定</span>
        </label>
      </li>
    </ul>
    <div class="col-menu-reset">
      <button class="btn btn-ghost btn-xs" @click="resetCols">恢复默认</button>
    </div>
  </div>
</template>

<script setup>
import { useColMenu } from '../composables/useColMenu.js'
import Icon from './Icon.vue'

const props = defineProps({
  colList:   { type: Array,    required: true },
  isVisible: { type: Function, required: true },
  toggleCol: { type: Function, required: true },
  resetCols: { type: Function, required: true },
})

const { showColMenu, colMenuEl, colMenuStyle, toggleColMenu } = useColMenu()

/** 外部齿轮按钮调用：toggleColMenu 会读 e.currentTarget（齿轮）的 rect 来定位。 */
function open (e) { toggleColMenu(e) }
defineExpose({ open })
</script>
