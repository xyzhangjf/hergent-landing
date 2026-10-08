#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""界面「实现细节泄漏」审计 —— 只读，零写入。

用途：找 *.vue 里**用户真的会看到**的文案中的开发/运维口径
（版本号、「让位」这类内部机制词、`后端`/`接口`/`缓存`、`出厂默认`、「后端推送未部署」…）。

🔴 覆盖三处，缺一处就会漏（v326 实测漏过第三处）：
  ① `<template>` 文本节点
  ② `title` / `placeholder` / `aria-label` 属性（**也是看得见的**）
  ③ `<script>` 里 `confirm()` / `toast()` / `alert()` / `prompt()` 的字符串字面量
     —— v326 实测：`confirm('…恢复为出厂默认？')` 只躲在这里，只扫模板的版本报「OK」。

不覆盖（刻意）：`<script>`/`<style>` 注释、HTML 注释 `<!-- -->`。
本仓注释**大量引用被禁止的写法本身**（例：v325 在 `Shell.vue` 写「不要在这里直写 `canMake('chat')`」），
把它们算进来会产生假红 —— 假红会让所有人学会忽略这个脚本。

自带**反例自证**：往样本里注入一条 `v296` 文案，判据必须转红（证明它不是恒绿的空转断言）。

用法：  python3 ui-devtext-leak-audit.py [--root <hergent-cn-v2 目录>]
       逐条人工审 🟡 提示段时：HERGENT_COPY_AUDIT_FULL=1 python3 ui-devtext-leak-audit.py
"""
import io, os, re, sys

DEFAULT_ROOT = os.environ.get('HERGENT_CN_V2') or os.path.expanduser(
    '~/Documents/laozhangai-product/hergent-cn-v2')

# 逐条人工审时置 1 ⇒ 每个文件列全量（默认只列前 6 条，够定位不够审）
FULL = bool(os.environ.get('HERGENT_COPY_AUDIT_FULL'))

# 高信号 + 低误报：宁可少收，也不要让判据出现假红
BAD = [
    (r'v[123]\d\d',                  '版本号'),
    ('让位',                          '内部机制（角色门槛让位）'),
    ('模块键',                        '内部术语'),
    ('_DEFAULT_PERMS',               '内部标识符'),
    ('_ALL_MODULES',                 '内部标识符'),
    ('custom_roles',                 '内部标识符'),
    ('MINI_MODULES',                 '内部标识符'),
    ('后端',                          '实现层'),
    ('接口',                          '实现层'),
    ('数据库',                        '实现层'),
    ('缓存',                          '实现层'),
    ('落库',                          '实现层'),
    ('出厂默认',                      '实现层'),
    ('提审',                          '开发流程'),
    ('未部署',                        '发版状态'),
    ('SSH',                          '运维细节'),
    ('生产库',                        '运维细节'),

    # ---- v331（2026-09-29）新增：老板定的四条判定标准 --------------------------
    # ① 内部模块依赖 ② 数据读取链路 ③ 菜单/入口影响范围 ④ 仅对开发运维有意义
    # ⚠️ 只收**字面固定串**；`'引擎'` `'字段'` `'模块'` 这类单名太宽（「AI 引擎」是菜单名、
    #    「改动过的字段」是业务话）⇒ 一律**不收**，否则恒红 = 判据失效。
    ('不影响菜单',                     '菜单影响范围'),
    ('勾了才会出现',                    '菜单影响范围'),
    ('每行下方已注明',                  '菜单影响范围（悬挂指针）'),
    ('菜单与入口',                     '菜单影响范围'),
    ('本机菜单',                      '菜单影响范围'),
    ('按模块放开的页面',                 '内部机制'),
    ('走角色门槛',                     '内部机制'),
    ('里的数据要靠它',                  '数据读取链路'),
    ('数据来自你的真实库表',               '数据读取链路'),
    ('数据源表',                      '内部表名'),
    ('不强制外键',                     '内部实现'),
    ('跨表因果',                      '内部实现'),
    ('不实际建表',                     '内部实现'),
    ('只记日志',                      '内部实现'),
    ('Hermes',                      '内部引擎名'),
    ('网关凭据',                      '运维细节'),
    ('本租户',                       '多租户实现'),
    ('已收敛到',                      '内部迁移'),
    ('不是前端另算一份',                 '内部实现'),
    ('取价函数',                      '内部实现'),
    ('符合不自研边界',                   '内部战略决策'),
    ('将于 P1 上线',                  '研发排期'),
    ('暂未开放',                      '研发排期'),

    # ---- v338（2026-09-30）新增：老板第三次点名后补的判据 -----------------------
    # 🔴 事故背景：v326 清权限面板 / v327 清面板外 9 处 / v331 全站清 54 处 ——
    #    三轮共 63 处之后，**v334 自己新写的 UI 又冒出一句同类**
    #    （`Settings.vue`「点某个角色的「配置权限」，进入它自己的权限配置页」）。
    #    根因不是"忘了规则"，而是**规则只活在记忆里、从没进过技能，且判据是枚举黑名单**
    #    ⇒ 枚举抓不住新形式。故本轮①补串 ②新增 SELFREF 一类**正则判据**（见下）。
    ('不用改代码',                    '研发视角'),
    ('改代码',                        '研发视角'),
    ('只提交你',                      '写入机制（PUT/PATCH 语义）'),
    ('一律不写',                      '写入机制（PUT/PATCH 语义）'),
    ('rebate_contracts',             '数据库表名'),
    ('forecast_orders',              '数据库表名'),
    ('sale_orders',                  '数据库表名'),
    ('purchase_orders',              '数据库表名'),
    ('交付文档',                      '研发协作'),
    ('契约见',                        '研发协作'),
    ('小程序工程另立',                 '研发协作'),
    ('Web 侧闭环',                    '研发视角'),

    # ---- v339（2026-09-30）新增：第四类病灶 —— **内部枚举值 / 字段名直接渲染** ------
    # 见下方 ENUM 组（**必须与 BAD 分开**：它们要看得到 `{{ }}` 插值，而 BAD 看不见 ——
    # visible_items 默认会把插值抹掉，否则「{{ pageNamesFor(m).join('、') }}」这类
    # 正常表达式会被当文案扫，凭空造出假红）。
]

# 🔴 v339 新增 **ENUM** 组：第四类病灶 —— **后端英文枚举 / 字段名被原样渲染到界面上**。
#
# 事故背景：v338 逐条人工过 🟡 提示段 48 处时，**又**抓出这一整类（此前从没进过判据）。
# 生产实测（只读探针读的是真库，不是推测）：
#   · `ai_reports.source`         = `copilot`                     ⇒ 界面印英文
#   · `brand_pending.source`      = `backfill` / `unit_test`      ⇒ 界面印英文
#   · `purchase_orders.status`    = `received` / `draft`           ⇒ 界面印英文
#   · `ai_fallback_log.kind`      = `failure` / `low_confidence`   ⇒ 界面印英文
#   · `arrivalPreview.source`     = `arrival`（**恒为定值**）       ⇒ 界面印「口径 arrival」
#
# 与 BAD 的机理区别：BAD 抓「文案里写了不该写的词」；
# 这一类是「文案本身没问题，但它**插了一个英文值进来**」⇒ 只能靠**正则看结构**抓。
#
# ⚠️ 判据必须同时满足「抓得住真问题」与「不误伤已修好的写法」——
#    每一次调用都会跑 self-check ④⑤ 双向自证，改这几条正则前先看那两行输出。
#
# 🔴 v339 实测踩到的**分组**教训（第一次写错的就是这里）：
#    判据要看的文本**不是同一份** ——
#      · ① ② 看的是**插值本身** ⇒ 必须用 `keep_interp=True` 那份；
#      · ③ 看的是**字面文案** ⇒ 只能用默认那份。
#    一开始四条混在一组跑「保留插值」的文本 ⇒ 判据③把 `{{ fmt(r.created_at) }}`
#    里的 `created_at` 当成"字段名泄漏"**误伤**（那是表达式，不是文案）⇒ self-check⑤ 当场拦住。
ENUM_TPL = [
    # ① **裸枚举插值**：整个 `{{ }}` 就是「某对象.枚举字段」，没有任何映射包裹。
    #    ✅ 命中 `{{ r.source }}` / `{{ f.kind }}` / `{{ po2Data.status }}`
    #    ✅ 放行 `{{ repSrcLabel(r.source) }}`（被函数包住 ⇒ 已映射）
    (r'\{\{\s*[\w.$\[\]]+\.(source|status|kind|mode|state|type)\s*\}\}',
     '内部枚举值直接渲染（无中文映射）'),
    # ② **三元/兜底分支回落英文**：`… ? '运行中' : m.status` 或 `… || p.status`
    #    ⇒ 最阴的一类：**主分支是中文、兜底分支是英文**，平时看不见，遇到新枚举值才漏。
    #    ✅ 命中 `: m.status }}` / `|| p.status }}`
    #    ✅ 放行 `{{ ST_LABEL[p.status] || '未知' }}`（兜底也是中文）
    (r'(?:[:|]\|?)\s*[\w.$\[\]]+\.(source|status|kind|mode|state|type)\s*\}\}',
     '兜底分支回落英文枚举'),
]

ENUM_TXT = [
    # ④ **「口径」后面直接跟英文**：`（本月 5 次、口径 arrival）`
    #    ⚠️ 特意**不允许**中间隔 `{` —— 因为 `口径 {{ pricingLabel }}` 是**已映射**的合法写法
    #       （真实存在于 `LossDashboard.vue`）；若把 `{` 放进来，它就会被误伤。
    (r'口径\s*[A-Za-z_]',            '内部枚举值直接渲染（口径 + 英文）'),
]

# ⚠️ 曾经把「蛇形字段名 `xxx_yyy` 出现在可见文案里」当**违规**判据，**实测必须降级**：
#    · `title(bind)` / 属性抽取拿到的是**表达式源码**，不是渲染值
#      ⇒ `r.subject_label` / `r.rate_den == null ? …` / `role.end_locked_web ? …`
#        这些**全都是假红**（真渲染出来的是中文）。
#    · 文本节点抽取也会漏表达式残片（属性里含 `>`、插值里嵌套 `{}`）
#      ⇒ `(impResult.results?.products_affected_count || 0)">` 这类残片也假红。
#    · 还有**合法的**照抄型文案：`对象类型填 store（门店）或 self_warehouse（本人仓）。`
#      —— 用户**必须**照抄这个值，它是必要信息不是泄漏。
#    ⇒ 结论：这条**判不了**「泄漏」与「用户要照抄的值」，只配进 🟡 提示段（见 snake_hits）。

# 🔴 v338 新增 **SELFREF** 组：与上面的「枚举违禁词」**机理不同** ——
#    上面抓「出现了不该出现的词」，这里抓「整句话在复述用户眼前就能看到的事」。
#    判定标准（老板给的，可复用）：**这段字所指的对象，在同一屏里是否已经可见/可推断？**
#       · 可见  ⇒ 零信息增量 ⇒ 删（例：「点『配置权限』进入权限配置页」——按钮就在旁边）
#       · 不可见 ⇒ 有增量     ⇒ 留（例：「仓库还没建？去『档案管理 → 仓库档案』先建」）
#    ⚠️ 只收**有「点/点击」这个动作锚点**的形式，不收「本页读的是…」这类**因果说明**
#       （后者回答的是"数字为什么没更新"，删了用户会更困惑 ⇒ 那是假红）。
#    ⚠️ 但**正则抓不住这条标准的真正边界**：本轮实测 `(点|点击)…(进入|切到|跳转)` 一次抓出 7 处，
#       其中「点柱子可切到该月详情」「（可点击跳转）」是**有用的交互提示**（用户不知道能点 ⇒ 有增量）
#       ⇒ 假红。真正的判据是**元素名复述**（见 quote_echo_hits）：句子里引用的元素名，
#       是否就在**同一屏**的按钮/标签里。在 ⇒ 用户眼皮底下 ⇒ 删；不在 ⇒ 是跨屏指路 ⇒ 留。
SELFREF = [
    (r'(四|五|三|两)列(分别)?是[「"\']', '自描述：复述表头'),
    (r'每一行是一个', '自描述：复述表格结构'),
    (r'(页面上|界面上)(点|按|点一下)', '自描述：复述眼前操作'),
]


def strip_html_comments(s):
    out, i = [], 0
    while True:
        j = s.find('<!--', i)
        if j < 0:
            out.append(s[i:]); break
        out.append(s[i:j])
        k = s.find('-->', j)
        if k < 0:
            break
        i = k + 3
    return ''.join(out)


def call_args(src, open_idx):
    """取 `(` 起、按**括号配平**切出参数文本（忽略字符串里的括号）。

    ⚠️ 别用「正则匹配到某个收尾字符」——v326 实测两次都栽在这里：
       ① `toast('x')` 紧跟 `</script>` 时收尾不属于 `[\\n;)]` ⇒ **整条漏掉**；
       ② 消息里含 `(a+b)` 拼接时按第一个 `)` 切 ⇒ 截断 ⇒ **后半句漏扫**。
    """
    depth, i, n, q = 0, open_idx, len(src), ''
    while i < n:
        c = src[i]
        if q:
            if c == '\\':
                i += 2
                continue
            if c == q:
                q = ''
        elif c in '\'"`':
            q = c
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return src[open_idx + 1:i]
        i += 1
    return src[open_idx + 1:open_idx + 300]


def visible_items(src, keep_interp=False):
    """返回 [(来源, 文案)] —— 只含**会渲染出来**的东西。

    keep_interp=False（默认）：把 `{{ }}` 插值抹成空格 —— 常规判据（BAD / SELFREF）用这版。
    keep_interp=True：**保留插值原文** —— 只给 ENUM 判据用（它要看的正是插了什么值进来）。
    🔴 v339 实测教训：默认那版会把插值抹掉 ⇒ 枚举判据**根本看不见** `{{ r.source }}`，
       第一次跑 probe④ 只命中 2/6，就是这个原因（判据写对了、数据源却把它滤没了）。
    """
    # ⚠️ 抓顶层 `<template>` 用「首个 `<template>` → **最后**一个 `</template>`」。
    #    不能用 `\n</template>` 收尾（v326 实测：那样会把「不带换行就闭合」的文件**整份跳过**
    #    ⇒ 该文件被判为"干净" = **假绿**，而反例自证当场抓住了它），
    #    也不能用非贪婪到**第一个** `</template>`（Vue 里 `<template v-if>` 遍地都是 ⇒ 会截断）。
    i, j = src.find('<template>'), src.rfind('</template>')
    tpl = strip_html_comments(src[i + len('<template>'):j]) if 0 <= i < j else ''
    if not keep_interp:
        tpl = re.sub(r'\{\{[^}]*\}\}', ' ', tpl)      # 插值占位，别当文案
    body = re.sub(r'<(script|style)\b[\s\S]*?</\1>', ' ', tpl)
    items = [('文本', t) for t in (' '.join(x.split()) for x in re.sub(r'<[^>]+>', '\n', body).split('\n')) if t]
    for mm in re.finditer(r'(?:\s|^)(title|placeholder|aria-label)="([^"]*)"', tpl):
        items.append((mm.group(1), mm.group(2)))
    for mm in re.finditer(r':title="([^"]*)"', tpl):
        items.append(('title(bind)', mm.group(1)))
    for mm in re.finditer(r'\b(confirm|toast|alert|prompt)\s*\(', src):
        for lit in re.findall(r"'([^']*)'", call_args(src, mm.end() - 1)):
            items.append(('script:' + mm.group(1), lit))
    return items


def element_names(src):
    """本文件**同一屏**内已有的元素名（按钮 / 标签 / 表头里的短文本）。

    只取 ≤10 字、且不含 `<` `>` `{` `}` 的文本节点 —— 长句是正文不是元素名，
    插值表达式不是静态名。
    """
    i, j = src.find('<template>'), src.rfind('</template>')
    if not (0 <= i < j):
        return set()
    tpl = strip_html_comments(src[i + len('<template>'):j])
    body = re.sub(r'<(script|style)\b[\s\S]*?</\1>', ' ', tpl)
    names = set()
    for t in re.findall(r'>([^<>{}]{1,10})<', body):
        t = ' '.join(t.split())
        if t:
            names.add(t)
    return names


def quote_echo_hits(src):
    """🔴 v338 的核心判据：**复述本屏已有的元素名**。

    判定：可见文案里 `「X」` 的 X **恰好等于**本文件的某个元素名，**且**该文案是个动作句
    （含 点 / 点击 / 按）⇒ 它在告诉用户「点你面前这个按钮会怎样」⇒ 零信息增量 ⇒ 违规。

    正反两侧都实测过：
      · 正例 `Settings.vue`「点某个角色的「配置权限」，进入它自己的权限配置页」
        —— 同文件确有 `<button …>配置权限</button>` ⇒ 命中。
      · 反例 `LossDashboard.vue`「点柱子可切到该月详情」—— 「柱子」不是元素名 ⇒
        **不命中**（这是有用的交互提示，不是复述眼前物）。
    """
    names = element_names(src)
    if not names:
        return []
    out = []
    for kind, txt in visible_items(src):
        t = ' '.join(txt.split())
        if not re.search(r'(点|点击|按)', t):
            continue
        for q in re.findall(r'[「『]([^」』]{1,12})[」』]', t):
            if q.strip() in names:
                out.append(('自描述：复述本屏已有的元素名「%s」' % q.strip(), kind, t[:120]))
    return out


# 🔴 v339 **ENUM_OK 放行名单** —— 逐条查过真实取值域后才放行，**每条必须写理由**。
#
# 为什么必须有它：判据只看「结构」（`{{ x.字段 }}`），看不出这个字段的**值域是不是中文**。
# 若不放行，脚本会**永远红着** —— 而一个永远红的脚本 = 所有人学会忽略它（v326 的原始教训）。
# ∅ 但反过来：**放行必须留痕**。没有理由的放行，就是下一次事故的种子。
#
# 键 = (文件基名, 字段名)；值 = 放行理由（**须写清"值域从哪看的"，不是"我觉得没事"**）。
ENUM_OK = {
    ('CommitmentsTab.vue', 'kind'):
        '值域全中文 —— 后端常量 COMMITMENT_KINDS = ("返利","费用支持","赠品","陈列费","其他")'
        '（commitments.py:31），且下拉选项与列表同源同值。',
    ('BidRadar.vue', 'type'):
        '值域全中文 —— 生产 bid_radar.db 实测 25 个公告类型全部中文'
        '（招标公告/中标公告/废标公告/结果公告/采购意向…），无英文项。',
    ('Forecast.vue', 'kind'):
        '值域全中文 —— `saveFailed.kind` 只在赋值处写死中文'
        '（Forecast.vue:5308 "数据校验未通过" / 5324 kind 由 5327 行按"保存超时"等中文分支给出）。',
    ('ResultCard.vue', 'source'):
        '**不是枚举** —— SOUL.md:29 规定 AI 在这里写人话「数据来源：预报提交 + 库存快照」，'
        '是模型生成的中文说明，不是后端代码值。',
}


def enum_hits(src, rel=''):
    """🔴 v339 违规段（第四类）：内部英文枚举 / 字段名被渲染到界面。

    🔴 **两组判据必须分别跑在不同的文本上**（v339 第一次写错就在这）：
      · `ENUM_TPL`（裸枚举插值 / 兜底回落英文）⇒ 看 `keep_interp=True` 那份，**插值要保留**；
        默认那份把 `{{ }}` 抹成空格，看不见插了什么值进来。
      · `ENUM_TXT`（口径+英文）⇒ 只能看**默认那份**，否则表达式残片会造出假红。
    ⚠️ 两组都只跑 ENUM*，**不跑 `BAD`**：BAD 是给「抹掉插值后的纯文案」设计的，
       放它去扫带插值的文本会凭空造出假红（例如 `{{ pageNamesFor(m).join('、') }}`）。
    ⚠️ 命中后先查 `ENUM_OK`：值域本身就是中文的字段**放行**（否则脚本永远红着 = 等价失效）。
    """
    base = os.path.basename(rel) if rel else ''
    out = []

    def _push(why, kind, t):
        field = ''
        for pat, _w in ENUM_TPL:
            mm = re.search(pat, t)
            if mm and mm.lastindex:
                field = mm.group(1)
                break
        if (base, field) in ENUM_OK:
            return
        out.append((why, kind, t[:120]))

    for kind, txt in visible_items(src, keep_interp=True):
        t = ' '.join(txt.split())
        for pat, why in ENUM_TPL:
            if re.search(pat, t):
                _push(why, kind, t)
    for kind, txt in visible_items(src):
        t = ' '.join(txt.split())
        for pat, why in ENUM_TXT:
            if re.search(pat, t):
                out.append((why, kind, t[:120]))
    return out


def snake_hits(src):
    """🟡 v339 新增提示：**可见文案里出现 `xxx_yyy` 蛇形标识符** —— 疑似字段名泄漏。

    🔴 为什么不进违规段（实测教训，写清楚免得下次又把它挪回去）：
      · `title(bind)` / 属性抽取拿到的常常是**表达式源码**，不是渲染值
        ⇒ `r.subject_label`、`role.end_locked_web ? '…' : ''` 全部假红；
      · 文本节点抽取会漏表达式残片（属性含 `>`、插值嵌套 `{}`）⇒ 更多假红；
      · 还有**合法的照抄型文案** —— `对象类型填 store（门店）或 self_warehouse（本人仓）。`
        用户必须照抄这个值，它是必要信息、不是泄漏。
      ⇒ 这条**分不出**「字段名泄漏」与「用户要照抄的值」⇒ 只配机器找、人判。

    实测正例：`Workbench.vue`「可追溯率（source_ref 非空）」（已改为「每条都有来源依据」）。
    为压低噪音，只看**来源=文本**、且**不含表达式特征字符**的项（排除 `{{ ( ' " ? | $`）。
    """
    out = []
    for kind, txt in visible_items(src):
        if kind != '文本':
            continue
        t = ' '.join(txt.split())
        if re.search(r'''[{}()'"`?|$=<>]''', t):
            continue
        for m in re.findall(r'[a-z]{2,}_[a-z]{2,}', t):
            out.append(('疑似字段名 %s（用户需照抄该值则放行）' % m, kind, t[:120]))
    return out


def ticket_hits(src):
    """🟡 v339 新增提示：**无插值的 `#三位数`** —— 疑似内部工单号泄漏。

    🔴 为什么只进提示段、不进违规段：`采购单 #{{ po2Data.id }}` 这类**业务单号**长得一模一样
    （用户完全该看到单号），正则分不出「内部工单号 #357」与「单号 #357」——
    硬并入违规段会产生假红，而**假红会让所有人学会忽略这个脚本**。
    ⇒ 机器找、人判。

    本轮实测正例：`Rebate.vue`「…继续用 #357 的分解方式微调」（#357 是内部工单号，已清）。
    """
    out = []
    for kind, txt in visible_items(src):
        t = ' '.join(txt.split())
        for m in re.findall(r'#\d{2,4}', t):
            out.append(('疑似内部工单号 %s（若是业务单号则放行）' % m, kind, t[:120]))
    return out


def hits_of(src, rel=''):
    """🔴 违规段 —— **零假红**：命中即必须清。

    三类来源：
      · 对**抹掉插值的纯文案**跑 `BAD` + `SELFREF`（v338 立）
      · 对**保留插值的文本**跑 `ENUM_TPL` / 对**纯文案**跑 `ENUM_TXT`（v339 立，第四类）
    `rel` 用于查 `ENUM_OK` 放行名单（值域本身是中文的字段）。
    """
    out = []
    for kind, txt in visible_items(src):
        for pat, why in BAD:
            if re.search(pat, txt):
                out.append((why, kind, ' '.join(txt.split())[:120]))
        for pat, why in SELFREF:
            if re.search(pat, txt):
                out.append((why, kind, ' '.join(txt.split())[:120]))
    out.extend(enum_hits(src, rel))
    return out


def hints_of(src):
    """🟡 提示段 —— **有语境，必须人工判**，不计入失败、不影响退出码。

    ⚠️ 为什么不并进 hits_of：本轮实测它与**合法的空态引导**字面无法区分 ——
      · 违规：「点某个角色的「配置权限」，进入它自己的权限配置页」（按钮就在旁边 ⇒ 零增量）
      · 合法：「还没有渠道。点右上角「新建渠道」开始。」（空态 ⇒ 有增量，UX 标准做法）
    两者都形如「点「X」…」，区别只在**用户此刻看不看得到那个 X** ⇒ 正则判不了。
    硬并入会产生 **40+ 处假红**，而假红会让所有人学会忽略这个脚本（v326 立此脚本时的原话）。
    ⇒ 折中：机械地**找出来**，判断留给按判据办事的人。

    v339 起再加两类提示：`ticket_hits`（疑似内部工单号）与 `snake_hits`（疑似字段名）
    —— 同理由：它们的字面与**合法写法**（业务单号 / 用户要照抄的值）无法区分。
    """
    return quote_echo_hits(src) + ticket_hits(src) + snake_hits(src)


def scan(root):
    total, files, hinted = 0, 0, 0
    hint_lines = []
    # 🔴 默认每个文件只列前 6 条（够定位）；逐条人工审时置 HERGENT_COPY_AUDIT_FULL=1 出全量。
    lim = 10 ** 6 if FULL else 6
    tmax = 400 if FULL else 90
    for base, dirs, fs in os.walk(os.path.join(root, 'src')):
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist', '__pycache__')]
        for f in sorted(fs):
            if not f.endswith('.vue'):
                continue
            p = os.path.join(base, f)
            src = io.open(p, encoding='utf-8').read()
            files += 1
            rel = os.path.relpath(p, root)
            hs = hits_of(src, rel)
            if hs:
                total += len(hs)
                print('\n🔴 %s  （%d 处）' % (rel, len(hs)))
                for why, kind, txt in hs[:lim]:
                    print('  ⚠️ [%s] <%s> %s' % (why, kind, txt))
                if len(hs) > lim:
                    print('  … 另有 %d 处' % (len(hs) - lim))
            hts = hints_of(src)
            if hts:
                hinted += len(hts)
                hint_lines.append((rel, hts))
    print('\n扫描 %d 个 .vue：🔴 违规 %d 处 · 🟡 提示 %d 处（提示**有语境**，需人工判，不计失败）'
          % (files, total, hinted))
    if hint_lines:
        print('\n---- 🟡 提示清单（判据：引号里的 X 是否**已在同一屏**可见？'
              '可见 ⇒ 零增量 ⇒ 删；不可见 ⇒ 跨屏指路 ⇒ 留）----')
        for rel, hts in hint_lines:
            print('\n%s  （%d 处）' % (rel, len(hts)))
            for why, kind, txt in hts[:lim]:
                print('  · [%s] <%s> %s' % (why, kind, txt[:tmax]))
            if len(hts) > lim:
                print('  … 另有 %d 处' % (len(hts) - lim))
    return total


if __name__ == '__main__':
    root = DEFAULT_ROOT
    if '--root' in sys.argv:
        root = sys.argv[sys.argv.index('--root') + 1]
    print('根目录：%s' % root)

    # ---- 反例自证：判据必须真的会红 ----
    probe = "<template><p>本页自 v296 起已分开</p></template>\n<script>toast('已复制（后端推送未部署）')</script>"
    n = len(hits_of(probe))
    print('反例自证①：注入「v296」「后端推送未部署」⇒ 命中 %d 处 %s'
          % (n, 'OK（有判别力）' if n >= 2 else '🔴 判据失效'))
    assert n >= 2, '判据没有判别力 —— 先修判据，再看结论'

    # v338②：SELFREF + 元素名复述 两组判据的自证 —— 直接用**老板点名的那句原文**当正例，
    # 并**照抄真实代码结构**（同屏真的放一个「配置权限」按钮）。
    # 判据若抓不住它自己的立规案例，就是空转断言。
    probe2 = ('<template><button class="btn btn-sm" @click="openRoleDetail(r.name)">配置权限</button>'
              '<span class="page-sub">点某个角色的「配置权限」，进入它自己的权限配置页</span>'
              '<p>每一行是一个功能模块，四列是「查看 / 新增 / 修改 / 删除」</p></template>')
    n2 = len(hits_of(probe2))
    m2 = len(hints_of(probe2))
    print('反例自证②：注入老板点名的原句 + 同屏按钮 ⇒ 违规 %d 处 / 提示 %d 处 %s'
          % (n2, m2, 'OK（两段判据都有判别力）' if (n2 >= 2 and m2 >= 1) else '🔴 判据失效'))
    assert n2 >= 2 and m2 >= 1, '判据抓不住它自己的立规案例'

    # v338③：反方向自证 —— 有增量的「指路 / 因果说明 / 交互提示」**不许**被误伤。
    # 假红会让所有人学会忽略这个脚本（v326 立此脚本时的原话），比漏报更致命。
    probe3 = ('<template><p>仓库还没建？去「档案管理 → 仓库档案」先建</p>'
              '<p>本页读的是已保存的数据，切到「数据填报」保存后才会更新。</p>'
              '<p>柱=万元（左轴）· 点柱子可切到该月详情</p></template>')
    n3 = len(hits_of(probe3))
    m3 = len(hints_of(probe3))
    print('反例自证③：指路句 / 因果说明 / 交互提示 ⇒ 违规 %d 处 / 提示 %d 处 %s'
          % (n3, m3, 'OK（两段都未误伤）' if (n3 == 0 and m3 == 0) else '🔴 假红，判据过宽'))
    assert n3 == 0 and m3 == 0, '判据过宽 —— 假红会让所有人学会忽略这个脚本'

    # v339④：第四类病灶（内部枚举值 / 字段名直接渲染）的自证。
    # 🔴 正例**逐条照抄本轮在生产上真实抓到的写法** —— 判据抓不住自己的立规案例 = 空转断言。
    probe4 = ('<template>'
              '<div>{{ r.source }} · {{ fmt(r.created_at) }}</div>'
              '<div>状态：{{ po2Data.status }}</div>'
              '<div>{{ m.status === "active" ? "运行中" : m.status }}</div>'
              '<div>{{ ST_LABEL[p.status] || p.status }}</div>'
              '<div>可追溯率（source_ref 非空）</div>'
              '<div>（本月 5 次、口径 arrival）</div>'
              '<div>…继续用 #357 的分解方式微调。</div>'
              '</template>')
    n4 = len(hits_of(probe4))
    m4 = len(hints_of(probe4))
    print('反例自证④：裸枚举 / 兜底回落英文 / 口径+英文  ⇒ 违规 %d 处；'
          '字段名 / #工单号 ⇒ 提示 %d 处 %s'
          % (n4, m4, 'OK（新判据有判别力）' if (n4 >= 5 and m4 >= 2) else '🔴 新判据失效'))
    assert n4 >= 5 and m4 >= 2, '枚举渲染类判据没有判别力'

    # v339⑤：反方向自证 —— **映射后的写法一个字都不许红**。
    # 这一条最容易被忽略：新判据若把「已经映射好的正确写法」也抓了，就等于逼人放弃修。
    probe5 = ('<template>'
              '<div>{{ repSrcLabel(r.source) }} · {{ fmt(r.created_at) }}</div>'
              '<div>状态：{{ PO_STATUS_LABEL[po2Data.status] || "未确认" }}</div>'
              '<div>{{ m.status === "active" ? "运行中" : "未启用" }}</div>'
              '<div>{{ ST_LABEL[p.status] || "未知" }}</div>'
              '<div>可追溯率（每条都有来源依据）</div>'
              '<div>（本月 5 次）</div>'
              '<div>保存后可在年度合同列表展开「月度构成」继续微调。</div>'
              '</template>')
    n5 = len(hits_of(probe5))
    m5 = len(hints_of(probe5))
    print('反例自证⑤：已映射/已改写的正确写法 ⇒ 违规 %d 处 / 提示 %d 处 %s'
          % (n5, m5, 'OK（新判据未误伤修好的写法）' if (n5 == 0 and m5 == 0) else '🔴 新判据误伤'))
    assert n5 == 0 and m5 == 0, '新判据把「已修好的写法」也抓了 —— 等于逼人放弃修'

    total = scan(root)
    print('判定：%s' % ('✅ 干净' if total == 0 else '🔴 有 %d 处待清理' % total))
