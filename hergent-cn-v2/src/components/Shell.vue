<template>
  <div class="shell" :class="{resizing:resizing}">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="tb-brand">
        <img class="tb-brand-logo" src="/favicon.svg" alt="Hergent" />
        <b>Hergent</b><span class="tb-sub">AI 经营副驾</span>
        <span v-if="store.demo" class="tb-demo">演示模式 · 模拟数据</span>
      </div>
      <div class="tb-ai">
        <WeatherWidget />
        <!-- v325（2026-09-29）：AI 入口按权限收窄 —— 无 `chat` 模块就不渲染。
             判据走 `store.canUseAi()`（唯一定义处，见 `store/index.js`），
             **不要**在这里直写 `canModule('chat')`：本仓有 5 个 AI 入口，抄五份必漂移。
             🔴 三态由 `canModule` 保证：`perms === null`（未加载/抖动）⇒ **显示**，
                绝不能写成"拉不到就藏"（那会把老板的按钮也藏掉）。 -->
        <button v-if="store.canUseAi()" class="tb-copilot" @click="openCopilot">
          <span class="tb-cp-ic">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
          </span>
          <span class="tb-cp-txt">AI</span>
        </button>
      </div>
      <div class="tb-right">
        <button class="tb-btn tb-bell" @click="toggleNoti" :title="notiUnread > 0 ? ('通知：' + Number(notiUnread).toLocaleString('zh-CN') + ' 条未读') : '通知'">
          <Icon name="bell" :size="17" />
          <span v-if="notiUnread > 0" class="tb-bell-n">{{ notiUnread > 99 ? '99+' : notiUnread }}</span>
        </button>
        <button class="tb-btn" @click="toggleTheme" title="切换主题">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>
        <div class="tb-user" @click.stop="toggleUserMenu">{{ store.user.name || '我' }}<svg class="tb-user-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
        <div v-if="userMenuOpen" class="tb-menu-mask" @click="userMenuOpen=false"></div>
        <div v-if="userMenuOpen" class="tb-menu" @click.stop>
          <button class="tb-menu-item" @click="openProfile">修改资料</button>
          <button class="tb-menu-item danger" @click="doLogout">退出登录</button>
        </div>
      </div>
    </header>

    <!-- 顶部栏已集成品牌 + 天气 + 问 AI 副驾，不再单独占一行 -->

    <div class="body">
      <!-- 侧栏（桌面） -->
      <aside class="sidebar" :class="{collapsed:!store.ui.sidebarOpen}">
          <!-- v291（2026-09-27）：**侧栏每一条都走同一个判据 `canSee(path)`** —— 唯一实现在
               `constants/pages.js` 的页面注册表。需求原话（老板）：
               「不同角色登录进去后只能看到自己有权限的页面」。
               两条轴（见 pages.js 文件头）：`module` = 本租户有没有买这个能力（客户可在
               「设置 › 权限」自助勾选）；`roles` = 这一页天然只给哪几类人（产品内置，
               权限页勾选也放不开 —— 价格体系/定时任务这类不该因一次误勾就对全员敞开）。
               🔴 为什么必须有 `roles` 这一轴：`data` 模块覆盖 **83 个接口**（报单要走它），
                  而员工/司机/导购都持有 `data`/`stock` ⇒ 只按模块判，员工登录后能看到
                  「定时任务」「渠道与价格」「AI 引擎」等六七个管理页。这是**模块粒度**问题
                  （`/api/cron` 恰好也归 `data`），不是配置没配对。
               ⚠️ 未知角色一律放行（fail-open，「拉不到 ≠ 没权限」）：启动瞬间 `store.user.role`
                  还是空串，此刻判 false 会让老板的菜单先消失再冒出来（一闪）。
                  深链不会因此漏 —— 路由守卫那边另用 `ensureRoleLoaded()` 先把"未知"消掉。
               历史（v267，2026-09-24）：本条最初是**单独**接门禁的 —— 业务员/员工打开
                  「预报订货管理」只会得到「一张空表 + 一排永久灰按钮 + 一句误导性的
                  『交叉表加载失败』」，因为后端 `summary` 的角色白名单只有 管理员/老板/主管，
                  而 `/api/forecast` 当时归 `data`、业务员持有 ⇒ 模块级门禁拦不住他。
                  （v347 起 `/api/forecast` 已改归窄模块 `forecast`，模块级门禁此后拦得住；
                     本段保留原貌，只为说明"当年单靠模块轴不够、必须另接角色轴"这条结论。）
                  那正是**假入口**（入口在、点进去必失败）的典型。v291 起不再单独写判据，
                  统一读 `pages.js` 的 `/forecast` 行（名单仍是 `FORECAST_SUMMARY_ROLES`）。 -->

          <!-- v274（2026-09-25）：**舟谱单据导入的侧栏入口已撤掉**，迁进
               「AI 引擎 › 连接器 › ERP 数据源」（http://…/connect 那张卡）。
               （v311 起「能力中心」已更名「AI 引擎」；页面位置与路由 `/connect` 都没动。）
               撤掉的理由：它是一个**一个月用一次**的动作，占一行侧栏不划算；而那一区
               本来就是「接入你的业务系统」的数据源清单（旁边是畅捷通 / 金蝶），
               舟谱导出的两张表就是一个数据来源 ⇒ 归到那里语义更正。
               ⚠️ 不是「下架」：路由 `/zhoupu-import` **保留**（卡片深链、刷新、收藏都还能用），
                  页面与后端 `_guard()`（admin/boss）一律未动。要再挂回侧栏就在 `NAV` 里加一行。
               🔴 回归判据（v311 更新）：本文件里搜「舟谱单据导入」应当**只命中这段注释**
                  （`NAV` 里没有任何指向 `/zhoupu-import` 的条目）。 -->

        <!-- v311（2026-09-28）：侧栏改为**表驱动**（见 `<script setup>` 里的 `NAV`）。
             v311 两处结构变更：①「渠道与价格」并入「档案管理」当第 6 个页签；
             ②「AI 中心」并入「能力中心」（已更名「AI 引擎」）当第 5 个页签；
             并新增三个分组标题（经营 / 核算 / 配置）—— 侧栏从 12 项平铺变 3 组 10 项。
             🔴 为什么必须表驱动：分组标题只有在「本组至少有一项可见」时才该出现。
                若标题另写一份路径清单去判（`paths.some(canSee)`），就与各条目的 `v-if`
                形成**两份判据**，一旦漂移就会出现「有标题、下面空着」或「有条目、没有标题」
                —— 正是本项目反复在修的"规则抄多份"。表驱动后标题由条目算出来，不可能不一致。
             ⚠️ 图标一律用 `<Icon>`（全站统一线性图标库），别再手写内联 `<svg>`。
                写错名字**不会报错** —— `Icon.vue` 的兜底是 `ICONS.settings`，会静默显示成齿轮。
                新增条目前先确认名字在库：`grep -o -E "^  [a-z0-9-]+:" components/Icon.vue`。
             ⚠️ 条目顺序 = 数组顺序；判据在 `NAV` 之外的 `canSee` 已无第二份，别在模板里补。 -->
        <nav class="sb-nav">
          <template v-for="g in navGroups" :key="g.label">
            <div class="sb-grp">{{ g.label }}</div>
            <!-- v388（2026-10-07）批次 2：条目现在有两种形态，由 `resolveNavItem` 判定：
                 ① 扁平直达项 `{path,name,icon}` —— 行为与 v311 完全一致；
                 ② 职能区 `{key,name,icon,groups}` —— 一级项**不是页面**（不是 router-link），
                    悬停展开弹窗、点击固定（触屏兜底）。
                 🔴 分支判据只有 `it.groups`（结构本身），**没有**任何权限判据 ——
                    可见性一律由 `canSee(path)` 在 `resolveNavItem` 里收口（v291/v311 纪律）。 -->
            <template v-for="it in g.items" :key="it.key || it.path">
              <router-link v-if="!it.groups" :to="it.path" class="sb-item"><Icon :name="it.icon" :size="16" /><span>{{ it.name }}</span></router-link>
              <div v-else class="sb-area" :class="{open: openArea === it.key, pinned: pinnedArea === it.key}"
                   @mouseenter="areaEnter(it.key, $event)" @mouseleave="areaLeave">
                <button type="button" class="sb-item sb-area-btn" :aria-expanded="openArea === it.key" @click="areaToggle(it.key, $event)"><Icon :name="it.icon" :size="16" /><span>{{ it.name }}</span><Icon name="chevron-right" :size="13" class="sb-caret" /></button>
                <Teleport to="body">
                  <div v-if="openArea === it.key" class="sb-pop" :style="popStyle"
                       @mouseenter="areaKeep" @mouseleave="areaLeave">
                    <template v-for="sg in it.groups" :key="sg.label">
                      <div v-if="sg.label" class="sb-pop-hd">{{ sg.label }}</div>
                      <router-link v-for="x in sg.items" :key="x.path" :to="x.path" class="sb-pop-item" @click="areaClose"><Icon :name="x.icon" :size="15" /><span>{{ x.name }}</span></router-link>
                    </template>
                  </div>
                </Teleport>
              </div>
            </template>
          </template>
        </nav>
      </aside>

      <!-- 侧栏拖拽手柄（桌面、展开时可见） -->
      <div v-show="store.ui.sidebarOpen" class="sb-resizer" :class="{active:resizing}" @mousedown.prevent="startResize" title="拖动调整侧栏宽度"></div>

      <!-- 内容区 -->
      <main class="content">
        <router-view v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </router-view>
      </main>
    </div>

    <!-- 移动端底部 Tab
         v311b（2026-09-28）：由**手写 3 条**改为读 `mnavItems`（源自 `NAV`）——
         名字/图标/路径只有一份 ⇒ 不可能再出现"同一页两个名字"。
         ⚠️ 图标一律 `<Icon>`（全站规范）；`more-horizontal` 是抽屉开关，无对应路由，故不进 NAV。 -->
    <nav class="mnav">
      <router-link v-for="it in mnavItems" :key="it.path" :to="it.path" class="mnav-item" @click="store.ui.mobileDrawer=false"><Icon :name="it.icon" :size="20" /><span>{{ it.name }}</span></router-link>
      <button class="mnav-item" @click="store.ui.mobileDrawer=!store.ui.mobileDrawer"><Icon name="more-horizontal" :size="20" /><span>更多</span></button>
    </nav>

    <!-- 移动端更多抽屉 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="store.ui.mobileDrawer" class="md-overlay" @click="store.ui.mobileDrawer=false"></div>
      </Transition>
      <Transition name="sheet">
        <div v-if="store.ui.mobileDrawer" class="md-sheet">
          <div class="md-grab"></div>
          <!-- v311（2026-09-28）：手机抽屉与桌面侧栏**共用同一份 `NAV`**（去掉底部栏已有的三项），
               分组与显隐一起算。⚠️ 桌面清干净了、手机还留着旧入口，是这类改造最常见的漏 ——
               所以两边都从这里取，别再手写第二份。 -->
          <template v-for="g in drawerGroups" :key="g.label">
            <div class="md-group-hd">{{ g.label }}</div>
            <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="md-item" @click="store.ui.mobileDrawer=false"><Icon :name="it.icon" :size="18" />{{ it.name }}</router-link>
          </template>
        </div>
      </Transition>
    </Teleport>

    <!-- AI 副驾全局抽屉 -->
    <CopilotDrawer />

    <!-- 通知面板（P0-1a：把只写不读的 message_center 接出来） -->
    <NotificationPanel :open="notiOpen" @close="notiOpen=false" @unread="notiUnread=$event" />

    <!-- 空闲自动登出（30 分钟无操作；到期前 60 秒倒计时可续期） -->
    <IdleTimeout :idle-minutes="30" :warn-seconds="60" @timeout="onIdleTimeout" />

    <!-- 命令面板（⌘Shift+K） -->
    <CommandPalette v-model="cmdOpen" />

    <!-- 修改资料弹窗 -->
    <div v-if="profileOpen" class="pf-mask" @click.self="profileOpen=false">
      <div class="pf-modal">
        <div class="pf-hd">修改资料</div>
        <div class="pf-bd">
          <label class="pf-field">
            <span>显示昵称</span>
            <input v-model="profileForm.display_name" maxlength="20" placeholder="界面上显示的名字" />
          </label>
          <label class="pf-field">
            <span>登录账号</span>
            <input v-model="profileForm.username" maxlength="32" placeholder="登录时输入的账号" />
            <small>修改后，下次请用新账号登录</small>
          </label>
          <div v-if="profileMsg" class="pf-msg" :class="profileOk ? 'ok' : 'err'">{{ profileMsg }}</div>
        </div>
        <div class="pf-ft">
          <button class="pf-btn" @click="profileOpen=false">取消</button>
          <button class="pf-btn primary" :disabled="profileSaving" @click="saveProfile">{{ profileSaving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { store, toast, setTheme, clearChatCache } from '../store'
import { auth, api, resetTenantContext } from '../api/client'
import CopilotDrawer from './CopilotDrawer.vue'
import NotificationPanel from './NotificationPanel.vue'
import CommandPalette from './CommandPalette.vue'
import WeatherWidget from './WeatherWidget.vue'
import IdleTimeout from './IdleTimeout.vue'
import Icon from './Icon.vue'
import { messagesApi } from '../api/modules'
/* v267：侧栏「预报订货管理」按角色可见性 —— 判据是后端同一份白名单的前端镜像
   （`roles.js::FORECAST_SUMMARY_ROLES`，护栏 AST 校验）。见下方 v-if 处注释。 */
import { canSee } from '../constants/pages'

/* ---------------------------------------------------------------------------
   v311（2026-09-28）：侧栏导航表 —— 桌面侧栏与手机抽屉的**唯一来源**
   ---------------------------------------------------------------------------
   需求（老板）：「对侧栏做一次整理，更简洁、易用、美观」，两处结构变更：
     · 「渠道与价格」→ 并入「档案管理」当第 6 个页签（侧栏不再单列）
     · 「AI 中心」  → 并入「AI 引擎」（原「能力中心」更名）当第 5 个页签（侧栏不再单列）
   结果：侧栏 12 项平铺 → **3 组 10 项**（分组标题：经营 / 核算 / 配置）。

   🔴 为什么把导航写成表、而不是继续手写 `<router-link>`（这是本次最关键的一个决定）：
      加了分组标题之后，标题只有在「本组至少有一项可见」时才该出现。若标题的显示条件
      另写一份清单（`paths.some(canSee)`），就与各条目的 `v-if` 组成**两份判据** ——
      漂移那天会出现「有标题、下面空着」（导购/司机就会命中：核算与配置两组对他全空）
      或「有条目、没有标题」。这正是本项目反复在修的"规则抄多份"。
      表驱动之后，标题**由条目算出来**，结构上不可能不一致。

   ⚠️ 判据全部落在 `canSee(path)`（→ `constants/pages.js` 一张表）。
      **不要**在这里写角色硬编码，也**不要**在模板里再补 `v-if`：
      v291 立下的规矩是「要改'谁看得见哪一页'，只改 (pages.js)」。
   ⚠️ 图标名必须真实存在于 `Icon.vue`（自带 50+ 个）。写错**不报错** ——
      `Icon.vue:144` 的兜底是 `ICONS.settings`，会静默显示成齿轮，肉眼很难发现配错了。
   --------------------------------------------------------------------------- */
const NAV = [
  {
    label: '经营',
    items: [
      { path: '/workbench', name: '经营工作台', icon: 'grid' },
      { path: '/forecast', name: '预报订货管理', icon: 'line-chart' },
      { path: '/rebate', name: '目标与返利', icon: 'target' },
      { path: '/bid-radar', name: '招投标雷达', icon: 'search' },
      // v380（2026-10-06）：进销存 —— 老板自研新能力。⚠️ 这里只登记**名字/图标/路径**，
      //   可见性由 `canSee('/inventory')`（→ pages.js 的 `/inventory` 行：ADMIN_ROLES + lock）裁决，
      //   不要在这里写角色判断（v291 纪律）。
      { path: '/inventory', name: '进销存', icon: 'package' }
    ]
  },
  {
    label: '核算',
    items: [
      { path: '/loss-accounting', name: '货损核算', icon: 'receipt' },
      { path: '/payroll', name: '算工资', icon: 'coins' }
    ]
  },
  {
    label: '配置',
    items: [
      /* v388（2026-10-07）批次 2 · 侧栏骨架 L0：`档案管理` 由**扁平直达项**升级为
         **职能区（area）** —— 悬停展开弹窗、内含 7 个页签直达链接。这是「先只落地档案管理区」
         的试点：本区整区没有「创建」动作，所以验骨架时不会碰到批次 3 的「双入口（行内创建）」。
         🔴 结构 = `{ key, name, icon, groups:[{ label, items }] }` —— **带 `groups` 的条目
            不再是一个页面**（见模板里 `.sb-area` 与 `.sb-pop` 的分支），批次 3 的 L1
            「行内创建」就挂在 `groups[].items[]` 上，所以这一步必须先把结构立起来。
         🔴 可见性**仍然只走** `canSee(path)`（→ `pages.js`）：弹窗只负责**排版**，
            模板里**不补任何 `v-if`**（v291 纪律）；空列/空弹窗由 `navGroups` 计算属性收口
            （v311 纪律：标题与显隐都从条目算出来，绝不写第二份判据）。
         ⚠️ `path` 刻意**不写** —— 一级项是"分区"不是页面。`/archive` 路由本身**保留**
            （已存书签/深链照常可达，落回第一个可见页签）。
         ⚠️ 图标名必须真实存在于 `Icon.vue`（写错不报错，静默变齿轮）。
            本表 7 个图标：users / building / store / gift / package / toolbox / coins —— 全部在库。 */
      {
        key: 'archive', name: '档案管理', icon: 'book',
        groups: [
          { label: '', items: [
            { path: '/archive/employees',  name: '员工档案',   icon: 'users' },
            { path: '/archive/customers',  name: '客户档案',   icon: 'building' },
            { path: '/archive/suppliers',  name: '供应商档案', icon: 'store' },
            { path: '/archive/brands',     name: '品牌档案',   icon: 'gift' },
            { path: '/archive/products',   name: '商品档案',   icon: 'package' },
            { path: '/archive/warehouses', name: '仓库档案',   icon: 'toolbox' },
            { path: '/archive/prices',     name: '渠道与价格', icon: 'coins' }
          ] }
        ]
      },
      // ⚠️ 名字是「AI 引擎」不是「能力中心」—— v311 更名，理由见 `pages.js` 该行注释。
      //   路由仍是 `/connect`（**不改路径**：它是已上线深链，改名只动显示名）。
      { path: '/connect', name: 'AI 引擎', icon: 'brain' },
      { path: '/cron', name: '定时任务', icon: 'clock' },
      { path: '/settings', name: '设置', icon: 'settings' }
    ]
  }
]

/** 手机底部栏已有的三项 —— 抽屉里不再重复出现（保持 v311 之前的行为）。 */
const MNAV_PATHS = ['/workbench', '/forecast', '/rebate']

/**
 * 🔴 **底部栏也要同一份名字**（v311b，2026-09-28）。
 *
 * 改之前这里手写了 3 条 `<router-link>`：名字/图标/路径**各抄一份**，结果与侧栏
 * **当场就不一致** —— 同一个目的地，侧栏叫「经营工作台」「预报订货管理」，
 * 底部栏叫「工作台」「预报」。用户会以为是两个不同的地方（而它们的 `to` 一模一样）。
 * 这正是本项目反复栽的「同一条规则抄两份」：**两份之间没有任何断言，只能靠肉眼**。
 *
 * ⇒ 现在从 `NAV` 里**按路径取**（名字、图标、路径都只有一份）。
 * `MNAV_PATHS` 保留为「哪几项属于底部栏」这个**设计意图**的声明（与权限无关），
 * 抽屉的排除项也读它 —— 不再有第三份。
 */
const mnavItems = computed(() => {
  const all = NAV.flatMap(g => g.items)
  return MNAV_PATHS
    .map(p => all.find(it => it.path === p))
    .filter(it => it && canSee(it.path))
})

/**
 * v388（2026-10-07）批次 2 · 侧栏骨架 L0：把 `NAV` 里的一条条目解析成「可渲染的东西」。
 *
 * 一条条目现在有两种形态：
 *   ① 扁平直达项 `{ path, name, icon }` —— 仍按 `canSee(path)` 收窄；
 *   ② 职能区 `{ key, name, icon, groups:[{ label, items }] }` —— 先把每列按 `canSee` 收窄、
 *      再丢掉**空列**；**全列皆空 ⇒ 整个一级项返回 `null`（隐藏）**。
 *
 * 🔴 为什么收口放在这里、而不是模板里补 `v-if`：
 *    v311 立下的规矩是「标题与显隐都从条目算出来」。若在模板里另写一份判据
 *    （例如 `v-if="it.groups.some(...)"`），就与这里的判断形成**两份实现** ——
 *    一旦漂移就会出现「有弹窗、里面空着」或「有内容、弹窗不出现」，
 *    正是本项目反复在修的「规则抄多份」。
 */
function resolveNavItem(it) {
  if (it.groups) {
    const groups = it.groups
      .map(sg => ({ label: sg.label, items: sg.items.filter(x => canSee(x.path)) }))
      .filter(sg => sg.items.length)
    return groups.length ? { ...it, groups } : null
  }
  return canSee(it.path) ? it : null
}

/** 桌面侧栏：按 `canSee` 收窄，**并丢掉空组**（否则导购/司机会看到两个空标题）。 */
const navGroups = computed(() => NAV
  .map(g => ({ label: g.label, items: g.items.map(resolveNavItem).filter(Boolean) }))
  .filter(g => g.items.length))

/**
 * 手机抽屉：同一份表，再减掉底部栏那三项。
 * 手机端**不做悬停**（批次 2 · 2.5）—— 职能区直接**平铺**成它内部的所有条目。
 * 🔴 平铺必须走**同一份** `resolveNavItem` 结果：桌面弹窗里因权限被隐藏的列，
 *    手机端也不能露出来，否则就变成"屏幕尺寸决定权限"（这类洞本项目出过多次）。
 */
const drawerGroups = computed(() => NAV
  .map(g => ({
    label: g.label,
    items: g.items
      .map(resolveNavItem)
      .filter(Boolean)
      .flatMap(it => it.groups ? it.groups.flatMap(sg => sg.items) : [it])
      .filter(it => !MNAV_PATHS.includes(it.path))
  }))
  .filter(g => g.items.length))

/* ---------------------------------------------------------------------------
   v388（2026-10-07）批次 2：职能区悬停弹窗的开关
   ---------------------------------------------------------------------------
   `openArea`   = 当前展开的区（鼠标悬停或被点击固定，都会置它）
   `pinnedArea` = 被**点击固定**住的区（触屏/无鼠标设备的兜底；点第二次取消）
   🔴 为什么要 180ms **延时收起**：指针从一级项移向弹窗时，必然要划过两者之间
      那一小段（`.sb-pop` 与 `.sb-area` 之间留了 8px 对齐边距）—— 即时收起会让弹窗
      在指针抵达之前就消失，表现为"鼠标一往下移，弹窗就没了"。舟谱是即时收起，
      这是主动改良（计划 §四 · 2.2 明写 180ms）。
   --------------------------------------------------------------------------- */
const openArea = ref('')
const pinnedArea = ref('')
let _closeTimer = null

/* 🔴🔴 弹窗为什么要 **Teleport 到 body**（这是本轮第三个坑，也是最隐蔽的一个）：
   1) `.sb-nav{overflow-y:auto}` 会把 `overflow-x` 一并算成 `auto` ⇒ 向外展开的弹窗被裁掉；
   2) 改用 `position:fixed` 后**仍然点不到** —— 探针的命中测试（`elementFromPoint`）
      抓到真相：该坐标下被命中的是页面正文的 `SPAN.tag`，弹窗**根本不在命中树上**。
      也就是说：`overflow` 的裁剪对 fixed 后代**照样生效**（"包含块在裁剪祖先之上就免疫"
      这条推论在 `.sidebar` 带 `backdrop-filter` 的复合情形下不成立）。
   3) 把弹窗挪出 `.sidebar` 这棵子树（Teleport 到 body）之后，两个问题**同时消失**：
      不再被任何祖先裁剪，且包含块回到视口 ⇒ 坐标就是 `getBoundingClientRect` 的视口值，
      不需要再换算 `backdrop-filter` 造成的包含块偏移。
   ⇒ 代价：弹窗不再是 `.sb-area` 的 DOM 后代，"鼠标从一级项移进弹窗"会触发 `.sb-area`
      的 mouseleave。补偿 = 弹窗自己挂 `mouseenter`（取消收起计时器）+ `mouseleave`，
      配合本来就要做的 180ms 延时，指针跨过那段 8px 缝隙时不会闪断。 */
const popStyle = ref({ top: '0px', left: '0px' })
function _placePop(ev) {
  const el = ev && ev.currentTarget
  if (!el) return
  const r = el.getBoundingClientRect()
  popStyle.value = { top: (r.top - 6) + 'px', left: (r.right + 8) + 'px' }
}

function areaKeep() {
  if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null }
}
function areaEnter(key, ev) {
  areaKeep()
  _placePop(ev)
  openArea.value = key
}
function areaLeave() {
  if (pinnedArea.value) return                    // 已固定 ⇒ 不随鼠标离开而收起
  if (_closeTimer) clearTimeout(_closeTimer)
  _closeTimer = setTimeout(() => { openArea.value = ''; _closeTimer = null }, 180)
}
/** 触屏兜底：点一级项 = 固定/取消固定弹窗（一级项本身**不是页面**，所以不导航）。 */
function areaToggle(key, ev) {
  if (pinnedArea.value === key) { pinnedArea.value = ''; openArea.value = '' }
  else { _placePop(ev); pinnedArea.value = key; openArea.value = key }
}
/** 弹窗里点走一个页签后收起（无论固定与否）—— 否则弹窗会一直挂在屏幕上。 */
function areaClose() {
  if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null }
  pinnedArea.value = ''
  openArea.value = ''
}
/* v388：弹窗的「跟随收起」两处 `watch` 见下方（必须写在 `useRoute()` **之后**）：
   `const route` 有 TDZ，提前引用会 `ReferenceError`。 */
onBeforeUnmount(() => { if (_closeTimer) clearTimeout(_closeTimer) })

// 通知偏好（本地）：徽标要扣掉「被你收起的类」，且必须与面板共用同一份规则、同一个算法
// —— 两边各算一遍 = 同屏两个数字对不上。
import { badgeFromGroups } from '../composables/useNotiPrefs'

const router = useRouter()
const route = useRoute()

/* v388（2026-10-07）批次 2：切换路由 / 折叠侧栏时收起悬停弹窗。
   折叠后 `.sb-area` 已被 `display:none`，而弹窗是 `position:fixed` —— 它**不受**父级
   `display` 影响，留着就是"漂在空处的一块"。
   ⚠️ 这两行**必须**写在 `useRoute()` **之后**：`const route` 处于 TDZ，提前引用会
      `ReferenceError`（构建期不报、页面运行才炸 —— 本轮实测踩到过）。 */
watch(() => route.fullPath, areaClose)
watch(() => store.ui.sidebarOpen, areaClose)

/* v291（2026-09-27）：`canSee(path)` 直接引自 `constants/pages.js` 的页面注册表 ——
   本模板 24 处菜单项（桌面侧栏 12 + 手机底栏 3 + 手机抽屉 9）全部走它。
   🔴 别再在任何地方写 `v-if="store.user.role === 'boss'"` 这类硬编码角色判断 ——
      那样写出来的"第 25 个入口"注定与注册表漂移（本项目 v267 的假入口、
      v275 的假封锁都是这么来的）。要改"谁看得见哪一页"，只改 `constants/pages.js` 一张表。 */

/* ---------------------------------------------------------------------------
   v275（2026-09-25）：被路由守卫拒了以后的落地提示
   ---------------------------------------------------------------------------
   `router/index.js` 的守卫发现角色不够时，会把用户送回 `#/workbench?denied=<页面名>`。
   这里负责把这件事**说出来** —— 否则 URL 悄悄变了却没有任何解释，
   用户只会以为"点坏了/页面没了"。这正是我们反复在修的那类静默失败。
   顺手把 query 清掉：不清的话刷新 / 回退 / 把链接转给别人都会再弹一次
   （即使对方本来就有权限，也会先看到一句"没有权限"）。

   ⚠️ `immediate: true` 是必须的：深链首次进入时守卫的跳转发生在 Shell 挂载**之前**，
      这个 watch 装得太晚就漏掉那一次（表现为"被弹回来了但没有任何提示"）。
   --------------------------------------------------------------------------- */
watch(() => route.query.denied, (v) => {
  if (!v) return
  toast('没有「' + String(v) + '」这一页的访问权限，已回到经营工作台', 'warn')
  Promise.resolve(router.replace({ path: route.path, query: {} })).catch(() => {})
}, { immediate: true })

/* 通知中心（P0-1a）：铃铛拉的是**聚合简报**（briefing 按 (event_key,msg_type) 归并后的少量
   分组，tenant_1 实测只有 7 组），不是流水 —— 明细由面板按需拉，
   避免每 2 分钟把 2 万条流水拖下来。
   为什么不用 list({limit:1}) 取 unread_count：那个数扣不掉「按你的设置收起的类」，
   铃铛会一直红着而面板里空空如也。
   badgeFromGroups 是**纯函数**，与通知面板头部共用 —— 同一份规则、同一批 groups
   必然得出同一个数，不会出现「铃铛 3、面板 2」。 */
const notiOpen = ref(false)
const notiUnread = ref(0)
let notiTimer = null

async function loadNotiUnread() {
  try {
    const b = await messagesApi.briefing()
    notiUnread.value = badgeFromGroups(b.groups || [])
  } catch (_) { /* 通知拉取失败不打扰用户，等下一轮重试 */ }
}
function toggleNoti() {
  userMenuOpen.value = false          // 与用户菜单互斥，避免两个浮层叠在一起
  notiOpen.value = !notiOpen.value
  if (notiOpen.value) loadNotiUnread()
}
onMounted(() => {
  loadNotiUnread()
  notiTimer = setInterval(loadNotiUnread, 120000)   // 2 分钟一次：够及时，又不至于打后端
})
onBeforeUnmount(() => { if (notiTimer) clearInterval(notiTimer) })

/* ---------------------------------------------------------------------------
   v296（2026-09-27）权限联动兜底 —— 「人一直停在某个页面」也要能跟上权限变化
   ---------------------------------------------------------------------------
   🔴 为什么必须有这一层：设置页保存时前端会强制重拉（那是最快路径，见 `Settings.vue`），
      但**别的会话**没有任何触发点 —— 如果那个人正停在报表页、不点导航、也不刷新，
      他会一直按旧权限用下去，而系统里没有任何一处能自证这件事。
   两个触发点，覆盖两种"人回来的时刻"：
     · `visibilitychange` → 可见：切回标签页就查一次。这正是真实场景 —— 老板改完权限，
       在微信里喊一声"你重新进一下"，对方切回浏览器标签页，这一刻必须已经生效。
     · 60 秒轮询：一直盯着屏幕、没切走的情形。
   🔴 两个触发点都走 `store.refreshPermsIfChanged()`（内部 20 秒节流 + 全静默 + 并发去重），
      所以最坏情况也只是每个周期多打一个**几十字节**的请求，不会给后端添负担。
   ⚠️ 与上面的通知轮询（2 分钟）分开两个 timer：两者周期不同、失败语义也不同，
      合并会让"通知失败"和"权限失败"互相拖累，也会让任一个的改动都要重算另一个。
--------------------------------------------------------------------------- */
let permsTimer = null
function onVisibilityCheck() {
  if (document.visibilityState === 'visible') store.refreshPermsIfChanged(true)
}
onMounted(() => {
  permsTimer = setInterval(() => store.refreshPermsIfChanged(true), 60000)
  document.addEventListener('visibilitychange', onVisibilityCheck)
})
onBeforeUnmount(() => {
  if (permsTimer) clearInterval(permsTimer)
  document.removeEventListener('visibilitychange', onVisibilityCheck)
})

function toggleTheme() {
  setTheme(store.ui.theme === 'light' ? 'dark' : 'light')
}

async function logout() {
  // 先通知服务端销毁会话（失败不阻塞本地清理；silent401 保证 401 时不重复跳转）
  try { await api('/api/auth/logout', { method: 'POST', silent401: true }) } catch (_) {}
  resetTenantContext()   // 清本地 tenant_id + hergent_tenant cookie，避免污染下一次登录
  clearChatCache()       // 清本地会话缓存，避免下一个登录的账号看到上一个账号的对话
  store.resetPerms()     // v291：清权限缓存（同租户换账号会串味，见 store/index.js::resetPerms）
  auth.token = ''
  auth.user = null
  router.push('/login')
}

/* 空闲超时（IdleTimeout 组件）→ 走与手动登出同一路径，额外给出原因提示 */
function onIdleTimeout() {
  toast('已因长时间无操作自动退出登录')
  logout()
}

/* 用户菜单 + 修改资料 */
const userMenuOpen = ref(false)
const profileOpen = ref(false)
const profileSaving = ref(false)
const profileForm = ref({ display_name: '', username: '' })
const profileMsg = ref('')
const profileOk = ref(false)

function toggleUserMenu() { userMenuOpen.value = !userMenuOpen.value }
function openProfile() {
  userMenuOpen.value = false
  const u = auth.user || {}
  profileForm.value = { display_name: u.display_name || '', username: u.username || '' }
  profileMsg.value = ''
  profileOk.value = false
  profileOpen.value = true
}
function doLogout() { userMenuOpen.value = false; logout() }
async function saveProfile() {
  profileSaving.value = true
  profileMsg.value = ''
  try {
    const body = { display_name: profileForm.value.display_name, username: profileForm.value.username }
    await api('/api/auth/profile', { method: 'PUT', body })
    const u = auth.user || {}
    u.display_name = profileForm.value.display_name || u.display_name
    u.username = (profileForm.value.username || '').trim() || u.username
    auth.user = u
    store.user.name = u.display_name || u.username || '我'
    profileOk.value = true
    profileMsg.value = '已保存'
    toast('资料已更新')
    setTimeout(() => { profileOpen.value = false }, 700)
  } catch (e) {
    profileOk.value = false
    profileMsg.value = (e && e.message) ? e.message : '保存失败'
  } finally {
    profileSaving.value = false
  }
}

function openCopilot() {
  store.ui.copilotOpen = true
}

const cmdOpen = ref(false)

/* 快捷键：⌘K / Ctrl+K 唤起 AI 副驾；⌘Shift+K / Ctrl+Shift+K 唤起命令面板（均对输入框豁免） */
function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    const t = e.target
    const tag = t && t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return
    /* v325（2026-09-29）：无 AI 权限 ⇒ **不拦这个键**。
       🔴 顺序很重要：`preventDefault()` 必须在判据**之后**。
          若先 preventDefault 再判权限，没有 AI 的角色按 ⌘K 会被"吃掉"——
          浏览器什么都没发生、命令面板（Shift+K 那条）也进不去，用户只会以为系统卡了。 */
    if (!e.shiftKey && !store.canUseAi()) return
    e.preventDefault()
    if (e.shiftKey) cmdOpen.value = true
    else store.ui.copilotOpen = !store.ui.copilotOpen
  }
}

onMounted(() => {
  if (auth.user) store.user.name = auth.user.display_name || auth.user.name || auth.user.username || '我'
  /* v206：拉本账号在**当前租户**下的模块权限（幂等，租户变了会自己重取）。
     失败时 store 保持「未知」⇒ canModule 一律 true（不隐藏），边界仍在后端。 */
  store.loadPerms()
  window.addEventListener('keydown', onKeydown)
  /* 恢复用户上次拖拽保存的侧栏宽度 */
  try {
    const saved = parseFloat(localStorage.getItem('hergent_sidebar_w'))
    if (!isNaN(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
      document.documentElement.style.setProperty('--sidebar-w', saved + 'px')
    }
  } catch (_) {}
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', stopResize)
})

/* ---- 侧栏拖拽调宽 ---- */
const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 420
const resizing = ref(false)
let _startX = 0
let _startW = 0

function _sidebarW() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')
  const n = parseFloat(v)
  return isNaN(n) ? 248 : n
}
function startResize(e) {
  if (!store.ui.sidebarOpen) return
  resizing.value = true
  _startX = e.clientX
  _startW = _sidebarW()
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
function onResizeMove(e) {
  let w = _startW + (e.clientX - _startX)
  if (w < SIDEBAR_MIN) w = SIDEBAR_MIN
  if (w > SIDEBAR_MAX) w = SIDEBAR_MAX
  document.documentElement.style.setProperty('--sidebar-w', w + 'px')
}
function stopResize() {
  if (!resizing.value) return
  resizing.value = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  try { localStorage.setItem('hergent_sidebar_w', getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) } catch (_) {}
}
</script>

<style scoped>
.shell{display:flex;flex-direction:column;height:100vh;background:radial-gradient(1200px 420px at 72% -8%,rgba(6,182,212,.07),transparent 60%),var(--bg2)}
.topbar{height:var(--topbar-h);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-bottom:1px solid var(--glass-border);flex-shrink:0;z-index:10}
.tb-demo{margin-left:10px;font-size:11px;background:rgba(255,149,0,.15);color:#b76e00;padding:2px 10px;border-radius:8px}
.tb-brand{display:flex;align-items:center;gap:8px}
.tb-brand-logo{width:22px;height:22px;border-radius:5px;display:block}
.tb-brand b{font-size:16px;font-weight:600;letter-spacing:.2px}
.tb-sub{font-size:12px;color:var(--t3);padding:3px 8px;border-radius:8px;background:var(--p-bg);color:var(--p-dark)}
.tb-right{display:flex;align-items:center;gap:8px}
.tb-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t2)}
.tb-btn:hover{background:var(--bg2);color:var(--p-dark)}
/* 通知铃铛：未读数用中文数目直接显示，不用英文缩写 */
.tb-bell{position:relative}
.tb-bell-n{position:absolute;top:2px;right:2px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:var(--dan);color:#fff;font-size:10px;line-height:15px;text-align:center;font-weight:600;box-shadow:0 0 0 2px var(--bg)}
.tb-user{height:32px;display:flex;align-items:center;padding:0 12px;border-radius:16px;background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer}

.tb-ai{display:flex;align-items:center;gap:12px}
.tb-copilot{display:flex;align-items:center;gap:8px;height:34px;padding:0 13px 0 11px;border:1px solid transparent;border-radius:18px;background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s}
.tb-copilot:hover{background:var(--p);color:#fff;box-shadow:0 4px 14px rgba(6,182,212,.22)}
.tb-cp-ic{display:flex;align-items:center;justify-content:center}

.body{flex:1;display:flex;overflow:hidden;position:relative}
.sidebar{width:var(--sidebar-w);flex-shrink:0;display:flex;flex-direction:column;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-right:1px solid var(--glass-border);transition:width .2s}
/* 拖拽时关闭过渡，保证实时跟手 */
.shell.resizing .sidebar{transition:none}
.sb-resizer{position:absolute;top:0;bottom:0;left:var(--sidebar-w);width:8px;margin-left:-4px;cursor:col-resize;z-index:12}
.sb-resizer::after{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);background:transparent;transition:background .15s}
.sb-resizer:hover::after,.sb-resizer.active::after{background:var(--p)}
.sb-nav{flex:1;overflow-y:auto;padding:12px 10px}
.sb-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:10px;color:var(--t2);text-decoration:none;font-size:13px;transition:all .15s}
.sb-item:hover{background:var(--bg);color:var(--t1)}
.sb-item.router-link-active{background:var(--p-bg);color:var(--p-dark);font-weight:500}
/* v311：侧栏分组标题（经营 / 核算 / 配置）。
   样式刻意**轻**：11px、字色 --t3（最浅一档）、不写 font-weight 600 ——
   分组标题是"路标"不是"条目"，比条目抢眼就会把侧栏切成三块硬邦邦的隔断，
   反而更不清爽。上间距 14px 相当于一条看不见的分隔线，不另画 border。
   ⚠️ `:first-child` 去掉第一组的上边距：否则「经营」之上会多出一段空白，
      看起来像侧栏顶部被压塌了（移动端 `.md-group-hd` 同理，见下）。 */
.sb-grp{font-size:11px;color:var(--t3);letter-spacing:.8px;padding:14px 10px 4px}
.sb-grp:first-child{padding-top:2px}

/* ---------------------------------------------------------------------------
   v388（2026-10-07）批次 2 · 职能区（area）+ 悬停弹窗
   ---------------------------------------------------------------------------
   全部复用既有变量（--bg / --p-bg / --p-dark / --t1 / --t2 / --t3 / --bd /
   --glass-bg-strong / --glass-blur），**不新造任何色值** —— 深色模式换的只是
   变量取值，这里不需要第二份暗色规则（v362/363/367 的幽灵变量教训）。
   🔴 弹窗**不能**用 `position:absolute; left:100%` —— 实测会被祖先 `.sb-nav` 的
      `overflow-y:auto` 裁掉（`overflow-y:auto` 会把 `overflow-x` 一并算成 `auto`），
      表现为"hover 了但弹窗不出现"。故坐标由 JS 实测后写进 `:style`，见 `_placePop`。
      `.sb-area` 仍需 `position:relative` 作为语义锚点（不含定位职责）。 */
.sb-area{position:relative}
.sb-area-btn{font:inherit;border:none;background:none;cursor:pointer;text-align:left}
.sb-area.open>.sb-area-btn{background:var(--p-bg);color:var(--p-dark);font-weight:500}
.sb-area.pinned>.sb-area-btn{box-shadow:inset 0 0 0 1px var(--bd)}
.sb-caret{margin-left:auto;opacity:.55;transition:transform .15s}
.sb-area.open .sb-caret{transform:rotate(90deg)}

/* ⚠️ 弹窗是 `<Teleport to="body">` + `position:fixed`：
   · 不能在 `.sb-area` 里用 `position:absolute; left:100%` —— 会被 `.sb-nav` 的
     `overflow-y:auto` 裁掉；
   · 也不能"留在原地 + 只改成 fixed" —— 实测（探针 `elementFromPoint`）**照样被裁**：
     坐标处命中的是正文元素，弹窗不在命中树上 ⇒ 看得见、点不到。
   · Teleport 出侧栏子树后，裁剪消失、包含块回到视口，坐标即 `getBoundingClientRect` 值。 */
.sb-pop{position:fixed;min-width:168px;
  background:var(--glass-bg-strong);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);
  border:1px solid var(--bd);border-radius:12px;padding:6px;z-index:30;
  box-shadow:0 8px 24px rgba(0,0,0,.12)}
.sb-pop-hd{font-size:11px;color:var(--t3);letter-spacing:.8px;padding:6px 10px 2px}
.sb-pop-item{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;border-radius:8px;
  color:var(--t2);text-decoration:none;font-size:13px;white-space:nowrap;transition:all .15s}
.sb-pop-item:hover{background:var(--bg);color:var(--t1)}
.sb-pop-item.router-link-active{background:var(--p-bg);color:var(--p-dark);font-weight:500}

.md-group-hd{font-size:11px;font-weight:500;color:var(--t3);padding:14px 20px 4px;letter-spacing:.8px}

.content{flex:1;overflow-y:auto;padding:20px;background:var(--bg)}

.page-enter-active,.page-leave-active{transition:opacity .18s,transform .18s}
.page-enter-from{opacity:0;transform:translateY(6px)}
.page-leave-to{opacity:0}

.mnav{display:none}
/* v136 全局模态层基准：遮罩 1125 / 内容 1130。
   必须高于页面内浮层上限（.tb-pop 1120、.wx-pop 1121），否则在预报页这类带工具栏
   下拉的页面里，触发按钮会浮在模态之上、可点穿（实测 3/3 按钮遮挡）。
   仍低于系统级：空闲超时 9998 / toast 9999 / ErrorBoundary 99999。 */
.md-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1125}
.md-sheet{position:fixed;left:0;right:0;bottom:0;background:var(--glass-bg-strong);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-radius:16px 16px 0 0;padding:8px 0 calc(12px + env(safe-area-inset-bottom));z-index:1130}
.md-grab{width:36px;height:4px;border-radius:2px;background:var(--bd);margin:6px auto 10px}
.md-item{display:flex;align-items:center;gap:12px;width:100%;padding:14px 20px;border:none;background:none;font-size:15px;color:var(--t1);text-align:left}
.md-item:active{background:var(--bg4)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.sheet-enter-active,.sheet-leave-active{transition:transform .25s ease}
.sheet-enter-from,.sheet-leave-to{transform:translateY(100%)}

.tb-user-caret{margin-left:5px;opacity:.7;transition:transform .15s}
.tb-menu-mask{position:fixed;inset:0;z-index:40}
.tb-menu{position:absolute;top:44px;right:18px;background:var(--bg);border:1px solid var(--glass-border);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.14);padding:6px;min-width:150px;z-index:50}
.tb-menu-item{display:block;width:100%;text-align:left;padding:9px 12px;border:none;background:none;border-radius:8px;color:var(--t1);font-size:13px;cursor:pointer;transition:background .15s}
.tb-menu-item:hover{background:var(--bg2)}
.tb-menu-item.danger{color:var(--dan)}

/* v136：全局模态层基准 1130（同 .md-sheet）。原 1000 低于预报页 .tb-pop(1120)，
   于是「修改资料」打开时工具栏的导出/复制报单/品牌三个按钮浮在遮罩之上、可点穿。
   本元素非 Teleport（在 .shell 内），而 .shell 无 stacking context，改值即生效。 */
.pf-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1130;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.pf-modal{width:380px;max-width:92vw;background:var(--bg);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden}
.pf-hd{padding:16px 20px;font-size:15px;font-weight:600;color:var(--t1);border-bottom:1px solid var(--border-subtle)}
.pf-bd{padding:18px 20px;display:flex;flex-direction:column;gap:14px}
.pf-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--t2)}
.pf-field input{height:38px;padding:0 12px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg2);color:var(--t1);font-size:14px;outline:none}
.pf-field input:focus{border-color:var(--p)}
.pf-field small{color:var(--t3);font-size:11px}
.pf-msg{font-size:12px}
.pf-msg.ok{color:var(--suc)}
.pf-msg.err{color:var(--dan)}
.pf-ft{padding:14px 20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border-subtle)}
.pf-btn{height:36px;padding:0 18px;border-radius:10px;border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t1);font-size:13px;cursor:pointer;transition:all .15s}
.pf-btn:hover{background:var(--bg3)}
.pf-btn.primary{background:var(--p);border-color:var(--p);color:#fff}
.pf-btn.primary:hover{opacity:.92}
.pf-btn:disabled{opacity:.6;cursor:default}

@media(max-width:768px){
  .sidebar{display:none}
  .sb-resizer{display:none}
  .tb-sub{display:none}
  .wx{display:none}
  .mnav{display:flex;position:fixed;bottom:0;left:0;right:0;height:calc(56px + env(safe-area-inset-bottom));background:var(--glass-bg-strong);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-top:1px solid var(--glass-border);z-index:800;padding-bottom:env(safe-area-inset-bottom)}
  .mnav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:none;background:none;color:var(--t3);font-size:11px}
  .mnav-item.router-link-active{color:var(--p-dark)}
  /* v311b：底部栏名字改回与侧栏**同源**（「工作台」→「经营工作台」等）后变长，
     窄屏（320px / 4 格 ≈ 80px）下不许换行把图标顶歪；也防「预报订货管理」挤出格。 */
  .mnav-item span{white-space:nowrap}
  .content{padding:14px 12px calc(72px + env(safe-area-inset-bottom))}
}
</style>
