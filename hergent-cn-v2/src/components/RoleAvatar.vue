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

// v484：后端确认「连内置头像都没有」的角色（自定义角色）记在这里，
//   避免消息流里每条 AI 消息都发一次注定 404 的请求。
//   ⚠️ 模块级（跨实例共享）：一旦某处加载成功会立即移除（见 onImgLoad）。
const NO_AVATAR = new Set()

const src = computed(() => {
  const r = props.role
  if (!r || !r.role_id) return ''
  // v484：🔴 不再要求 custom_avatar=1。
  //   后端 GET /api/ai/roles/{role_id}/avatar 的回落链是：
  //     本租户自定义头像 → 主租户(tenant 1) 的内置 3D 人物头像 → 404
  //   ⇒「本租户没传头像」时，会按 role_id 精确匹配到 boss 账号**该角色自己的那一张**
  //     3D 人物头像（copilot→copilot.png、accountant→accountant.png、cs→cs.png、
  //     secretary→secretary.png —— 四个角色是四张互不相同的图，不是共用一张），
  //     只有连内置图都没有（纯自定义角色）才 404 → 回落 emoji。
  //   此前只认 custom_avatar ⇒ 未上传头像的租户一律显示 🚀（老板实测）。
  //   bust 存在时（刚上传头像）强制重试，不被 NO_AVATAR 拦住。
  if (!props.bust && NO_AVATAR.has(r.role_id)) return ''
  return `/api/ai/roles/${r.role_id}/avatar` + (props.bust ? `?t=${props.bust}` : '')
})

// PNG 加载失败（角色被删 / 连内置图都没有）时退回 emoji —— 免得界面上出现裂图。
// 挂在 src 上 watch，换角色或重传头像后自动复位重试。
const failed = ref(false)
watch(src, () => { failed.value = false })

function onImgError() {
  if (props.role && props.role.role_id) NO_AVATAR.add(props.role.role_id)
  failed.value = true
}

function onImgLoad() {
  // 加载成功 ⇒ 该角色确实有头像（可能是刚上传的），从黑名单移除让其它位置也显示。
  if (props.role && props.role.role_id) NO_AVATAR.delete(props.role.role_id)
}

const text = computed(() => (props.role && props.role.avatar) || props.fallback)
</script>

<template>
  <img v-if="src && !failed" :src="src" :class="imgClass" :alt="(role && role.name) || ''" @error="onImgError" @load="onImgLoad">
  <span v-else :class="textClass">{{ text }}</span>
</template>
