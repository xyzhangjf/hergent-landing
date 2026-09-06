# 预报订单小程序 · 真机 E2E 测试清单

> 用途：小程序上传发布后，在**真机（iOS / Android 各一台）+ 微信体验版**逐条执行。
> 所有用例基于已落地代码（`forecast-order-miniprogram-20260812T023419087Z/`）。
> 前置：A1 真实 appid 已替换、A2 request 合法域名已配、B1 已上传发布。

---

## 一、发版前必须通过的 P0 用例

| 编号 | 用例 | 前置 | 步骤 | 预期结果 | 关联代码点 |
|---|---|---|---|---|---|
| E1 | 隐私同意拦截 | 清 Storage（`fs_privacy_agreed` 不存在） | 1. 冷启动小程序 2. 观察是否直接进入登录页 | 先弹「隐私保护指引」覆盖层；点击「同意并继续」后才展示登录表单；「暂不同意」保持弹窗、无法登录 | `login.js` showPrivacy、`login.wxml` 覆盖层 |
| E2 | 隐私标记持久化 | E1 已同意 | 杀进程重进 | 不再弹隐私层，直接登录页 | `wx.setStorageSync('fs_privacy_agreed','1')` |
| E3 | 真实账号登录 | A1/A2 完成；有可用账号 | 输入 username/password → 登录 | 成功写入 `fs_token/fs_user`，按 `fs_redirect`（无则 `/pages/fill/fill`）跳转；`wx.reportAnalytics('login')` 触发 | `login.js` login() |
| E4 | 合法域名下接口可达 | 真机联网 | 登录后进入 fill 页 | `open-periods`、`fill-search` 正常返回（非 `request:fail` 域名拦截）；若未配域名则**必定失败**，属 A2 阻塞 | `utils/api.js` request |
| E5 | 填写并提交主流程 | 已登录、有可用期次 | 1. 选门店 2. 搜商品 3. 填数量 4. 提交 | 提交成功 Toast「今日 XX 已报 N 件」；`fs_cart` 清空；`wx.reportAnalytics('submit')` 触发 | `fill.js` submit() |
| E6 | 我的提交-详情展开 | E5 已提交 | mine 页点一条记录 | 展开显示商品明细 + 状态徽标（待审批） | `mine.js` toggleExpand |
| E7 | 我的提交-撤回 | E6，状态为待审批 | 点「撤回」→ 二次确认 | 状态变「已撤回」；后端 `recall` 成功；汇总不再计入 | `mine.js` recall() + `POST /{sid}/recall` |
| E8 | 移动审批-通过 | 用审批角色账号登录 | approval 页→选待审→「通过并生成采购申请」 | 状态变「已通过」；`wx.reportAnalytics('approve')` | `approval.js` doApprove() |
| E9 | 移动审批-驳回 | 审批角色 | approval 页→「驳回」填原因→确认 | 状态变「已驳回」；原因入库；`reportAnalytics('reject')` | `approval.js` doReject() |
| E10 | 汇总页 + 复制 | 已有提交 | summary 页查看；点复制 | 汇总表展示；复制成功 Toast | `summary.js` copySummary |
| E11 | 登出清租户 | E3 已登录 | mine 页登出 | `fs_token/fs_user/fs_tenant_id/fs_period_id/fs_store_id/fs_cart/fs_redirect` 全部清除；`app.globalData.tenantId=''`；reLaunch 登录页 | `mine.js` logout() |
| E12 | 埋点上报 | 公众平台「自定义分析」已开启事件 | 执行 E3/E5/E8 | 后台「自定义分析」能看到 login/submit/approve 事件（未开启则静默 no-op，不报错） | `utils/track.js` |

---

## 二、边界与异常 P1 用例

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| B1 | 空购物车提交拦截 | fill 页未加任何商品直接提交 | 不发起请求，Toast「请先添加预报商品」 |
| B2 | 期次为空提示 | 后端无开放期次（或接口异常） | `loadPeriods` 失败仅告警 + 非阻断 toast「暂无可预报期次」，不闪退 |
| B3 | 网络失败 + 草稿保留 | 提交时断网 | `api.js` fail → 存本地草稿 + Toast「提交失败，已存草稿」；恢复网络后 cart 仍在 |
| B4 | 重复提交幂等 | 同一门店+期次连续提交两次 | 第二次返回「已存在」（或更新），不产生两单 |
| B5 | 非审批角色看不到入口 | 用销售角色登录 | mine 页无「待审预报」卡片；直接访问 approval 页被后端 403 |
| B6 | 撤回后不可再撤回 | E7 后再次点撤回 | 按钮消失或提示「已撤回」 |
| B7 | 已审单不可撤回 | 审批通过的单点撤回 | 后端返回「仅待审批可撤回」错误，前端提示 |
| B8 | 登录过期跳转 | token 失效后任意请求返回 401 | 清本地会话、reLaunch 登录页，不无限报错 |

---

## 三、兼容性与体验 P2 用例

| 编号 | 用例 | 预期 |
|---|---|---|
| C1 | iOS / Android 双端 | 弹窗、列表、复制在各端表现一致 |
| C2 | 微信基础库低版本（≥2.10.0） | 无 `wx.reportAnalytics` 不可用导致的崩溃（track 已做能力检测） |
| C3 | 弱网（开发者工具 Network 限速） | 提交有 loading，超时给明确失败提示而非白屏 |
| C4 | 长商品明细 | 我的提交详情可滚动、不溢出 |

---

## 四、执行记录表（测试时填写）

| 用例 | 设备 | 微信版本 | 结果(P/F) | 备注 |
|---|---|---|---|---|
| E1-E12 | | | | |
| B1-B8 | | | | |
| C1-C4 | | | | |

> 通过标准：P0 全部 P，且 B1-B8 无 blocker，方可进入灰度。
