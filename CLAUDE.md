# Hergent 仓库总纲（根 CLAUDE.md）

> 🔴 **本文件只做导航，不装规范。**
> 立这条规矩的原因：以前根 `CLAUDE.md` 里堆了整套桌面版规范，结果桌面版冻结后它成了"最权威的过期文档"——
> 后人照着它做事，做的事早就没用了。**规范写在各自该在的地方，一处一份。**
>
> 接手项目 → **先读根目录 `HANDOFF.md`**（产品现状 / 部署真相 / 数据库 / 功能地图 / 踩坑 / 待办）。

---

## 一、这份仓库是什么

`laozhangai-product` 是**产品与前端聚合仓**；后端在**另一个独立仓库**。两个仓独立提交、独立部署。

| 仓库 | 路径 | 内容 | 分支 |
|------|------|------|------|
| **`laozhangai-product`**（本仓） | `~/Documents/laozhangai-product/` | 主产品前端 `hergent-cn-v2/`（= hergent.cn）、预报小程序、桌面版（**已冻结**）、行业技能、`.workbuddy/` 记忆与工具 | `main` |
| **`hergent-erp`**（独立仓） | `~/Documents/hergent-erp/` | FastAPI + SQLite 后端（erp.hergent.cn 与 `/api/`）、旧 vanilla 前端 `static/` | `upgrade/v84-international` |

---

## 二、去哪儿找什么（唯一入口表）

| 我要做的事 | 读这个 |
|------|------|
| **接手 / 交接 / 了解产品全貌** | `HANDOFF.md` ← **第一入口** |
| 改 **前端 `hergent-cn-v2`** 的代码 | `hergent-cn-v2/CLAUDE.md` |
| 改 **UI / 视觉 / 布局 / 深色 / 用户可见文案** | `hergent-cn-v2/docs/UI-SPEC.md` |
| 走 **立项 / 评审 / 上线** 流程（产品级） | `.workbuddy/SOP/PRODUCT-DEVELOPMENT-SOP.md` |
| 查 **跨仓库长期记忆**（定过的规矩、踩过的坑） | `.workbuddy/memory/MEMORY.md` |
| 查 **某天发生了什么** | `.workbuddy/memory/YYYY-MM-DD.md`（日更，append-only） |
| 判 **「这个角色该不该看见这一页」** | `hergent-cn-v2/src/constants/pages.js`（**唯一真源**） |
| **部署后端** | `HANDOFF.md` §三（含"绝不带 `*.db`"的致命陷阱） |
| **部署前端** | `hergent-cn-v2/CLAUDE.md` §5（**含本仓最危险的一条命令，先读完再跑**） |
| 改 **桌面版 `desktop-app/`** | 见本文 §四（规范已归档到 `backup/`） |

---

## 三、跨端通用铁律（与在哪个文件里干活无关，永远成立）

1. **一次只改一件事** —— 改完 → 构建 → 真机验证 → 打快照 → 再动下一件。
2. **不许只看源码就说"好了"** —— 前端用无头浏览器打真机页面，后端用只读探针查生产。**"写了" ≠ "生效"**：路由遮蔽、构建夹带、chunk 未上线，都会让代码里写着的东西到不了用户面前。
3. **部署判据必须是"生产侧的事实"** —— 文件 md5 / 生产 `index.html` 引用的入口 chunk / 接口真实返回；不是"我传上去了"。
4. 🔴 **绝不 `rsync --delete` 前端产物目录** —— 生产 `/opt/hergent-cn-v2/assets/` 是**历次构建的并集**（实测 3637 个文件），`--delete` 会一次删掉 3561 个历史 chunk，以及服务器侧的 `backups/`、`_rollback/`、`index.html.bak-*`（⇒ 老缓存页面 404、回滚手段消失）。
5. 🔴 **上传后端绝不带 `*.db`** —— 本地开发库会覆盖生产主库，报 `database disk image is malformed`。
6. **凭据不入库、不外泄** —— 生产 `.env`、PAT、网关 key 只留在服务器与本机私密文件；提交前扫一遍。
7. **未知问题先回滚再排查** —— 不要连修多个版本找根因。
8. 🔴 **文档说的 ≠ 生产实测的 ⇒ 以实测为准，并当场把文档改掉** —— 别把过期指令留给下一个人（本文件被降级成路由页，就是这个教训的直接后果）。

---

## 四、桌面版（Electron）—— 已冻结，**非主产品**

- **当前主产品** = Web 版 `hergent.cn` + 预报小程序；桌面版「AI 员工操控电脑」已暂缓。
- 原来堆在本文件里的**整套桌面版规范，已整份归档**到 **`docs/archive/CLAUDE-desktop-20261008.md`**（字节一致于归档前的本文件，**已入库**，克隆即有）。
- **只有在改 `desktop-app/` 时才去读它**；日常开发（Web / 小程序 / 后端）不要按它做事。
