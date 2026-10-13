<template>
  <!-- v496：快捷时间档（进销存列表页统一设计规范 §3.3）。
       五枚 chip 复用全局 .chip（32px / 8px 圆角 / 令牌化 / 选中青实底）——
       v482 已修掉基准页私有的 .ipl-qbtn（偏蓝硬编码、不跟随主题）。
       本组件只负责"亮哪颗 + 点了谁"；真实日期值由父页 useQuickRange 写进
       f.date_from/date_to（与手动填框同一条路径，不另造一份状态）。 -->
  <div class="psi-quick">
    <label class="psi-quick-lb">快捷</label>
    <div class="psi-quick-row">
      <button v-for="q in RANGES" :key="q.key" type="button"
              class="chip" :class="{ on: range === q.key }"
              @click="pick(q.key)">{{ q.text }}</button>
    </div>
  </div>
</template>

<script setup>
/* 档位键与 useQuickRange.setDateRange 逐字对应；'' = 全部（清空两个日期框）。
   🔴 加/改档位必须同步 useQuickRange.js —— 两处档位表漂移的症状是
      "点了某颗芯片没反应、零报错"。 */
const RANGES = [
  { key: 'today', text: '今' },
  { key: 'yesterday', text: '昨' },
  { key: '7', text: '近7天' },
  { key: '30', text: '近30天' },
  { key: '', text: '全部' },
]
defineProps({ range: { type: String, default: '' } })
const emit = defineEmits(['pick'])
function pick (k) { emit('pick', k) }
</script>
