/* v306c：给 useAppUpdate 测试用的 vue 桩（esbuild --alias:vue=本文件）。
   只提供该 composable 真正用到的三个 API，且把生命周期钩子收集起来供测试手动触发。 */
export const __hooks = { mounted: [], unmounted: [] }

export function ref(v) {
  return { value: v }
}

export function onMounted(cb) {
  __hooks.mounted.push(cb)
}

export function onUnmounted(cb) {
  __hooks.unmounted.push(cb)
}
