<template>
  <!-- v717（P1）：状态徽章，全站唯一入口。
       ------------------------------------------------------------
       由来：v716 评审查出 `StatusBadge` **使用页面数 0**，而状态标签另有两套并行的
       实现 —— 全局 `.badge`（胶囊，radius 10，6 处）与全局 `.tag`（圆角矩形，
       radius 6，64 处），外加 7 个页面又各自重定义了一遍 `.tag.ok/.info/.warn`。
       后果是「已签收」在销售单是这一个绿、在本期预报是另一个绿。

       v717 收口动作（本组件依赖这三步）：
         ① 全局 `.tag` 变体补齐到 ok/suc/warn/bad/danger/risk/info/purple/teal/hot
            —— 此前 `risk`/`danger`/`suc`/`purple` 只有个别页面自己定义，
            换个页面用同名类就静默退回灰底（看起来"是标签但没颜色"）；
         ② 全部变体的前景色改走 `--st-*-txt` 令牌（浅/深各一套，均过 AA）；
         ③ 删掉那 7 处页面级重定义，统一继承全局。
       所以本组件的造型**就是** `.tag`：不要在这里另写 padding/圆角/字号，
       否则又会长出第三套。

       🔴 用法：tone 传语义，label 传文案。
          <StatusBadge tone="ok" label="已签收" />
          <StatusBadge :active="p.is_active" />     ← 兼容旧写法，等价 启用/停用
       🔴 不要为了"这一处想更红一点"去改 tone 或加内联样式 —— 语义色只有一套，
          真要新增语义（例如"锁定"）请先在 variables.css 里加 `--st-lock-txt`。 -->
  <span class="tag" :class="resolvedTone">{{ resolvedLabel }}</span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** 语义色调：ok 成功 / warn 待处理 / bad·danger·risk 失败·风险 / info 中性信息 /
      purple 客户 / teal 自有仓 / neutral 无状态 */
  tone: { type: String, default: '' },
  /** 文案。留空时按 active 推导 启用/停用 */
  label: { type: String, default: '' },
  /** 兼容旧写法：true→启用(ok) / false→停用(neutral)。显式传 tone 时以 tone 为准 */
  active: { type: [Boolean, Number], default: undefined },
})

const hasActive = computed(() => props.active !== undefined && props.active !== null)

const resolvedTone = computed(() => {
  if (props.tone) return props.tone
  if (hasActive.value) return props.active ? 'ok' : 'off'
  return 'neutral'
})

const resolvedLabel = computed(() => {
  if (props.label) return props.label
  if (hasActive.value) return props.active ? '启用' : '停用'
  return ''
})
</script>
