# 修复：「切换期次后商品清单不立即刷新」

## 现象
在「预报订货管理」中，从一个期次跳到另一个期次时，商品列表（交叉表 / 编辑网格）不立即显示，必须手动点「刷新」才出来。

## 根因
`editMode` 默认值为 `true`（`Forecast.vue:1520`），用户默认落在**编辑网格**。两个期次切换入口的行为不一致：

- **下拉框** `@change="onPeriodChange"`（`:18`）只调用 `loadCross()`，在编辑模式下**没有调用 `loadEditGrid()`** → 编辑网格不重载（全量商品目录丢失 / 显示陈旧子集）。
- **期次按钮** `gotoPeriod`（`:4094`）则正确地 `if (editMode.value) loadEditGrid(); else loadCross()`。

即：用下拉切期次在默认（编辑）模式下是坏的，用期次按钮是正常的。

## 修复
`Forecast.vue:4753` 的 `onPeriodChange` 改为与 `gotoPeriod` 完全对称：

```js
function onPeriodChange() {
  viewPeriod.value = null
  loadOrders()
  if (viewMode.value === 'cross') { if (editMode.value) loadEditGrid(); else loadCross() }
}
```

## 验证
- 用 puppeteer 真机（dev 拦截 mock，2 期次各 100 行）复现：编辑模式下下拉切期次
  - 修复前：`cross.value.rows[0].name = "B-商品1"`（只读子集，`loadEditGrid` 没跑）
  - 修复后：`cross.value.rows[0].name = "FULL-11"`（全量目录，`loadEditGrid` 已重载）
- 只读模式路径本就正常，修复不影响该路径。
- 部署前已移除排查期临时加的 `window.__fc` 调试全局。

## 部署
- `npm run build` → 新 chunk `Forecast-C1ebHjS3.js`（492179B）
- `rsync -a --no-owner --no-group --delete dist/ root@47.113.224.140:/opt/hergent-cn-v2/` + `chown -R hergent:hergent`
- 生产已落盘新 chunk，nginx 纯静态无需重启

## 教训
所有「切换实体（期次 / 客户 / …）」的入口必须调用**同一套**重载函数，并按当前视图模式（编辑 / 只读）分派，不能让某个入口漏掉某一模式的重载。
