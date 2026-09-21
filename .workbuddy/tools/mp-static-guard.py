#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小程序静态护栏（v224 新建）—— 补「微信开发者工具不会当场报错」的那一类缺陷。

为什么需要它：
  小程序的模板（wxml）与脚本（js）之间是**弱耦合**的，四类错误在 DevTools 里
  既不报错、也不影响页面渲染，只表现为「点了没反应」或「某一小块空白」：
    ① `bindtap="foo"` 而 js 里没有 `foo()`  → 点击静默无响应（本项目已有整个技能在治它）
    ② `{{someField}}` 而 `data` 里没有 `someField` → 渲染成空，看着像"后端没给数据"
    ③ 标签不配平 → 整块被吞掉或布局塌陷（WXML 对未闭合标签容错，不报错）
    ④ 样式花括号不配平 → 该文件**后续所有规则**失效（表现是"某些样式突然不生效"）
  这四类都不能靠 `node --check`（它只查 js 语法）与 `vite build`（不处理小程序）发现。

判据（每条都是"零容忍"）：
  · 事件处理函数：模板里出现的每个 bind*/catch* 名字，必须在该页 js 里存在同名定义
  · mustache 根变量：`{{x.y}}` 的 `x` 必须是 js `data` 的键、或 `wx:for` 的循环别名、
    或 JS 字面量（true/false/null/undefined）
  · 标签配平、花括号配平

用法：
  python3 .workbuddy/tools/mp-static-guard.py            # 全量
  python3 .workbuddy/tools/mp-static-guard.py fill mine  # 只查这几页
"""
import json
import os
import re
import subprocess
import sys

MP = "/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram"
NODE = "/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"

# 事件绑定：bindtap / catchtap / bind:tap / bindinput ...
RE_BIND = re.compile(r'\b(?:bind|catch|capture-bind|capture-catch)[:]?([A-Za-z]+)\s*=\s*"([^"{}]+)"')
RE_MUSTACHE = re.compile(r"\{\{(.*?)\}\}", re.S)
RE_FORALIAS = re.compile(r'wx:for-(?:item|index)\s*=\s*"([A-Za-z_$][\w$]*)"')
RE_TAG = re.compile(r"<(/?)([A-Za-z][\w:-]*)((?:\"[^\"]*\"|'[^']*'|[^>\"'])*?)(/?)>", re.S)
# 从 mustache 表达式里取"根标识符"：前面不是 `.` 的标识符
RE_IDENT = re.compile(r"(?<![.\w$])([A-Za-z_$][\w$]*)")
RE_STR = re.compile(r"'[^']*'|\"[^\"]*\"")
JS_KEYWORDS = {"true", "false", "null", "undefined", "typeof", "in", "instanceof", "new",
               "return", "void", "delete", "this"}
# 模板里合法但不来自 data 的全局
TPL_GLOBALS = {"wx", "item", "index", "true", "false", "null", "undefined"}


def read(p):
    with open(p, "r", encoding="utf-8") as f:
        return f.read()


def strip_comments(t):
    return re.sub(r"<!--.*?-->", "", t, flags=re.S)


def js_data_keys(js):
    """取 `data: { ... }` 顶层的键名。

    ⚠️ 不能按行切 —— 实测本仓的 `data` 常写成**一行**（mine.js:
       `data: { user: {}, avatarChar: '', roleName: '', ... },`）⇒ 按行切会一个键都取不到，
       于是护栏把整页所有变量都判成"不在 data 里"（全量假红）。
       正确做法：先配对到 data 对象的右花括号，再按**顶层逗号**切段。
    """
    m = re.search(r"\bdata\s*:\s*\{", js)
    if not m:
        return set()
    i = m.end() - 1
    depth = 0
    body, end = None, None
    for j in range(i, len(js)):
        c = js[j]
        if c in "{[":
            depth += 1
        elif c in "}]":
            depth -= 1
            if depth == 0:
                body, end = js[i + 1:j], j
                break
    if body is None:
        return set()
    # 按顶层逗号切段。⚠️ 必须**感知注释与字符串**：
    #   本仓 `data` 里注释极多，且常见「行尾注释 + 下一行的键」这种写法，例如
    #       `storeEmpty: false,   // P0-1 空门店说明条\n    periods: [],`
    #   按裸逗号切段时，`periods` 会跟在上一条注释**后面**成为同一段，
    #   于是 `^标识符:` 匹配失败 ⇒ 该键被静默丢掉 ⇒ 护栏把这些键全判成"不在 data 里"
    #   （实测 fill.js 丢 14 个、password.js 丢 2 个，全是假红）。
    #   假红比无护栏更糟：它会把真正的漏写淹没掉。所以这里按字符扫描，
    #   跳过 // 与 /* */ 注释、跳过字符串字面量（含转义），再数括号深度。
    keys, seg, d, q, k = set(), "", 0, "", 0
    n = len(body)
    while k < n:
        ch = body[k]
        if q:
            seg += ch
            if ch == "\\" and k + 1 < n:
                seg += body[k + 1]
                k += 2
                continue
            if ch == q:
                q = ""
            k += 1
            continue
        if ch == "/" and k + 1 < n and body[k + 1] == "/":
            nl = body.find("\n", k)
            k = n if nl < 0 else nl
            continue
        if ch == "/" and k + 1 < n and body[k + 1] == "*":
            end = body.find("*/", k + 2)
            k = n if end < 0 else end + 2
            continue
        if ch in "'\"`":
            q = ch
            seg += ch
            k += 1
            continue
        if ch in "{[(<":
            d += 1
        elif ch in "}])>":
            d = max(0, d - 1)   # clamp：注释里偶发的落单括号不该让后续所有逗号失效
        if ch == "," and d == 0:
            keys.add(_seg_key(seg))
            seg = ""
            k += 1
            continue
        seg += ch
        k += 1
    keys.add(_seg_key(seg))
    return {x for x in keys if x}


def _seg_key(seg):
    mm = re.match(r"\s*['\"]?([A-Za-z_$][\w$]*)['\"]?\s*:", seg)
    return mm.group(1) if mm else ""


def js_methods(js):
    """页面方法名。

    ⚠️ 必须容忍 `async`（实测 `  async recall(e) {` / `  async submit() {` 都被漏掉），
       否则护栏会报"模板绑定了但 js 里没有"的假红 —— 而这类假红最危险：
       它会让真红（真的少写了处理函数）淹没在噪声里。
    """
    return set(re.findall(r"^\s{2,6}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(", js, re.M))


def tag_balance(t):
    """返回未配平详情；自闭合与 void 标签不计数。"""
    VOID = {"input", "image", "img", "br", "hr", "import", "include", "wxs"}
    stack, errs = [], []
    for m in RE_TAG.finditer(t):
        closing, name, _attrs, selfclose = m.group(1), m.group(2), m.group(3), m.group(4)
        low = name.lower()
        if low in VOID or selfclose:
            continue
        if closing:
            if not stack:
                errs.append("多余的闭合标签 </%s>" % name)
            elif stack[-1][0] != name:
                errs.append("闭合不匹配：<%s> 被 </%s> 关闭" % (stack[-1][0], name))
                stack.pop()
            else:
                stack.pop()
        else:
            stack.append((name, m.start()))
    for name, pos in stack:
        line = t[:pos].count("\n") + 1
        errs.append("未闭合 <%s>（第 %d 行起）" % (name, line))
    return errs


def brace_balance(css):
    return css.count("{") - css.count("}")


def check_page(wxml):
    """按 .wxml 路径配对同名 .js / .wxss —— 用路径配对而非"页名=目录名"，
    因为本仓有 `pages/legal/privacy.*` 与 `pages/legal/terms.*` 这种**一目录多页**的写法
    （按目录名找会得到"缺 wxml"的假红）。"""
    name = os.path.relpath(wxml, MP)
    js = wxml[:-5] + ".js"
    wxss = wxml[:-5] + ".wxss"
    problems = []
    t = strip_comments(read(wxml))
    src = read(js) if os.path.exists(js) else ""

    # ① 事件处理函数存在性
    meths = js_methods(src)
    for _evt, fn in RE_BIND.findall(t):
        fn = fn.strip()
        if not fn or "{{" in fn:
            continue
        if fn not in meths:
            problems.append("事件处理函数不存在：`%s`（模板绑定了，js 里没有）" % fn)

    # ② mustache 根变量
    keys = js_data_keys(src)
    aliases = set(TPL_GLOBALS) | set(RE_FORALIAS.findall(t))
    seen = set()
    for expr in RE_MUSTACHE.findall(t):
        expr_no_str = RE_STR.sub("''", expr)
        for ident in RE_IDENT.findall(expr_no_str):
            if ident in aliases or ident in JS_KEYWORDS or ident in seen:
                continue
            if ident in keys or ident in meths:
                continue
            seen.add(ident)
            problems.append("mustache 变量不在 data 里：`{{%s}}`（也无法对应任何方法名）"
                            % ident)

    # ③ 标签配平
    for e in tag_balance(t):
        problems.append("WXML 结构：" + e)

    # ④ 样式花括号配平
    if os.path.exists(wxss):
        d = brace_balance(read(wxss))
        if d:
            problems.append("WXSS 花括号不配平：差值 %+d" % d)

    # ⑤ js 语法
    if src:
        r = subprocess.run([NODE, "--check", js], capture_output=True, text=True)
        if r.returncode != 0:
            problems.append("js 语法错误：" + (r.stderr.strip().split("\n")[-1])[:120])
    return name, problems


def main():
    want = sys.argv[1:]
    pw = os.path.join(MP, "pages")
    all_wxml = []
    for root, _dirs, files in os.walk(pw):
        for f in sorted(files):
            if f.endswith(".wxml"):
                all_wxml.append(os.path.join(root, f))
    all_wxml.sort()
    if want:
        all_wxml = [p for p in all_wxml
                    if any(os.path.dirname(p).endswith(w) for w in want)]
    total = 0
    print("=== 小程序静态护栏（%d 个页面模板）===" % len(all_wxml))
    for wxml in all_wxml:
        name, probs = check_page(wxml)
        if probs:
            total += len(probs)
            print("\n[%s] %d 处" % (name, len(probs)))
            for x in probs:
                print("   ✗ " + x)
        else:
            print("[%s] ok" % name)
    print("\n合计问题：%d" % total)
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
