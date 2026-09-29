<script setup>
/**
 * v322：AI 角色头像的**唯一渲染口**。
 *
 * 🔴 为什么必须是「组件」而不是「各页面各写一遍 v-if」：
 *    同一个角色头像此前被 5 处各写了一遍判断，其中 2 处**漏了 custom_avatar**：
 *      · `.cp-who-av`（「将由 X 回答」行）—— 只打印 emoji ⇒ 明明有 3D 头像，界面显示 🚀
 *      · `.msg-avatar` 的回落分支 —— 消息没带角色快照时（存量消息 / 服务端拉回的历史）
 *        回落成 emoji，而不是回落成当前角色的 3D 头像
 *    生产真身：4 个内置角色**全部** `custom_avatar=1`（emoji 只是"没上传头像"时的兜底）
 *    ⇒ 老板看到的就是「一个抽屉里有的地方是 3D 头像、有的地方是 🚀」。
 *
 * ✅ 判据只此一处：**有自定义头像 ⇒ 渲染 PNG；否则渲染 emoji（再否则 fallback 文案）**。
 *    任何新增的头像位置都必须走这个组件 —— 别再自己写 v-if（那是本 bug 的成因）。
 *
 * 用法：
 *   <RoleAvatar :role="currentRole" img-class="cp-role-av-img" />
 *   <RoleAvatar :role="m.roleMeta || currentRole" img-class="msg-av-img" fallback="AI" />
 */
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // 角色对象：需要 role_id / custom_avatar / avatar 三个字段
  role: { type: Object, default: null },
  // 图片上的 class（各处的尺寸/形状样式，保持与原有 CSS 不变）
  imgClass: { type: String, default: '' },
  // emoji 分支上的 class（可空）
  textClass: { type: String, default: '' },
  // 连 emoji 都没有时的兜底文案（角色已删除 / 数据缺字段）
  fallback: { type: String, default: 'AI' },
  // 可选版本号：用于上传头像后打破浏览器缓存（RoleManage 在用）
  bust: { type: [String, Number], default: '' }
})

const src = computed(() => {
  const r = props.role
  if (!r || !r.custom_avatar || !r.role_id) return ''
  return `/api/ai/roles/${r.role_id}/avatar` + (props.bust ? `?t=${props.bust}` : '')
})

// PNG 加载失败（角色被删 / 文件丢）时退回 emoji —— 免得界面上出现裂图。
// 挂在 src 上 watch，换角色或重传头像后自动复位重试。
const failed = ref(false)
watch(src, () => { failed.value = false })

const text = computed(() => (props.role && props.role.avatar) || props.fallback)
</script>

<template>
  <img v-if="src && !failed" :src="src" :class="imgClass" :alt="(role && role.name) || ''" @error="failed = true">
  <span v-else :class="textClass">{{ text }}</span>
</template>
