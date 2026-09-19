#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""直接自递归扫描（hergent-cn-v2 src/）。

背景（真实事故）：`Forecast.vue` 的 `unitCount()` 兜底写成了
    function unitCount() { return Array.isArray(cross.value.units) ? unitCount() : 0 }
**自递归、没有出口** ⇒ 一进预报页就 `RangeError: Maximum call stack size exceeded`，
被 ErrorBoundary 兜成整页「页面出错了」。它要防的（读 `undefined.length`）与它造成的
（栈溢出）在界面上**长得一模一样**，排查代价很高。

本脚本找的是「**函数体里直接调用自己、且看不到递减/出口条件**」这一类写法。
它不是完备的递归检测器（不做控制流分析），但在本仓这类「accessor 兜底写错」的
场景上足够 —— 之所以可行是因为：**正常业务里，自递归几乎总带显式出口参数**
（如 `walk(node.children)`、`tier(n - 1)`），而这类事故体里**只调用自己、没有任何参数**。

判据（三条同时成立才报）：
  1. 函数名在同一函数体内出现（直接自调用）；
  2. 自调用**不带参数**（`name()` 形态）—— 带参数的一律放过（通常有出口条件）；
  3. 自调用出现在 `return` 的同一表达式里（三元/短路兜底形态）。

用法：python3 direct-self-recursion-check.py [src_dir]
退出码：0 = 无命中；1 = 有命中。
"""
import io
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else 'src'

# 命名函数：function name(...) {  或  const name = (...) => {  或  function* name(
NAMED_FN = re.compile(
    r'(?:function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|'
    r'(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*[A-Za-z_$\w]*\s*)?\()'
)

# 一行/一处「return <expr 含 name()>」
RET_TEMPLATE = r'return\b[^\n;]*\b{name}\s*\(\s*\)'


def brace_body(text, open_idx):
    """从 `{`（text[open_idx]）起按配平取函数体，跳过字符串/模板/注释。"""
    assert text[open_idx] == '{'
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            i = n if j < 0 else j + 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in '"\'`':
            quote = c
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == quote:
                    break
                i += 1
            i += 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i], i
        i += 1
    return text[open_idx + 1:], n


# 关键字：其后的 `/` 是正则，不是除号
REGEX_PREV_CHARS = set('(,=:[!&|?{};+-*%~^<>')
REGEX_PREV_WORDS = {
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'case', 'do', 'else', 'yield', 'await', 'throw',
}


def strip_comments(text, mask_strings=True):
    """把注释（以及可选字符串 / 正则字面量）替换成等长空白，**保留换行** ⇒ 偏移量与行号都不变。

    两条必须做的理由，都是实测踩出来的：

    1. **必须剥注释**：那次事故的示例代码被写进了源码注释里
       （`function X(){return Array.isArray(f.value.units)?X():0}`），
       不剥注释就会把**注释**当成真代码报出来（第一版实测就报了自己）。
    2. **必须认正则字面量**：本仓有 `return /[",\\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s`
       这类写法。若把正则里的 `"` 当成字符串起始，就会与后面代码的引号**错位配对**，
       一路吞掉几千行 ⇒ **漏报**（这正是本脚本第一版漏掉注入用例①的真因）。
       判据用「前一个有效字符/关键字」启发式：`(,=:[!&|?{};+-*%~^<>` 之后、
       或 `return/typeof/case/...` 之后的 `/` 是正则；标识符/`)`/`]` 之后是除号。
    """
    out = list(text)
    n = len(text)
    i = 0
    prev = ''          # 上一个「有效字符」（跳过空白）

    def blank(a, b):
        for k in range(a, min(b, n)):
            if out[k] != '\n':
                out[k] = ' '

    while i < n:
        c = text[i]
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            blank(i, j)
            i = j
            continue
        if c == '/' and mask_strings and regex_can_start(text, i, prev):
            j = scan_regex(text, i)
            if j > i:
                blank(i, j)
                i = j
                prev = '/'
                continue
        if mask_strings and c in '"\'`':
            quote = c
            i += 1
            while i < n:
                if text[i] == '\\':
                    blank(i, i + 2)
                    i += 2
                    continue
                if text[i] == quote:
                    break
                blank(i, i + 1)
                i += 1
            i += 1
            prev = quote
            continue
        if not c.isspace():
            prev = c
        i += 1
    return ''.join(out)


def regex_can_start(text, i, prev):
    """`text[i] == '/'` 时判断它是不是正则起始。"""
    if prev == '' or prev in REGEX_PREV_CHARS:
        return True
    # `return /re/` 这类：`/` 前面是个标识符，但那标识符是关键字
    j = i - 1
    while j >= 0 and text[j].isspace():
        j -= 1
    k = j
    while k >= 0 and (text[k].isalnum() or text[k] in '_$'):
        k -= 1
    word = text[k + 1:j + 1]
    return word in REGEX_PREV_WORDS


def scan_regex(text, i):
    """扫描 `/.../flags`，返回结束偏移；不是合法正则则返回 -1。"""
    n = len(text)
    j = i + 1
    in_class = False
    while j < n:
        ch = text[j]
        if ch == '\\':
            j += 2
            continue
        if ch == '\n':          # 正则不能跨行 ⇒ 说明这不是正则，是除号
            return -1
        if ch == '[':
            in_class = True
        elif ch == ']':
            in_class = False
        elif ch == '/' and not in_class:
            j += 1
            while j < n and (text[j].isalpha()):
                j += 1
            return j
        j += 1
    return -1



def scan_file(path):
    hits = []
    try:
        raw = io.open(path, encoding='utf-8').read()
    except (UnicodeDecodeError, IOError):
        return hits
    # .vue 只取 <script> 段（模板里的 https:// 之类会干扰，虽然影响很小）。
    # 用等长空白前缀替换掉 script 之前的头部 ⇒ 行号仍是**文件真实行号**。
    if path.endswith('.vue'):
        m = re.search(r'<script[^>]*>(.*?)</script>', raw, re.S)
        if not m:
            return hits
        head = raw[:m.start(1)]
        head = re.sub(r'[^\n]', ' ', head)
        raw = head + m.group(1)
    raw = strip_comments(raw)
    for m in NAMED_FN.finditer(raw):
        name = m.group(1) or m.group(2)
        if not name:
            continue
        brace = raw.find('{', m.end() - 1)
        if brace < 0:
            continue
        body, _ = brace_body(raw, brace)
        if not body:
            continue
        calls = re.findall(r'(?<![\w$.])' + re.escape(name) + r'\s*\(\s*\)', body)
        if not calls:
            continue
        # 判据 3：自调用出现在 return 的同一表达式里
        if not re.search(RET_TEMPLATE.format(name=re.escape(name)), body):
            continue
        line = raw[:m.start()].count('\n') + 1
        snippet = re.search(RET_TEMPLATE.format(name=re.escape(name)), body)
        hits.append((path, line, name, snippet.group(0).strip()[:110]))
    return hits


def main():
    if not os.path.isdir(ROOT):
        print('目录不存在：%s' % ROOT)
        return 2
    all_hits = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'dist', '.git')]
        for fn in filenames:
            if fn.endswith(('.js', '.vue', '.ts')):
                all_hits.extend(scan_file(os.path.join(dirpath, fn)))
    if all_hits:
        print('命中 %d 处「无参数自递归」：' % len(all_hits))
        for path, line, name, snippet in all_hits:
            print('  FAIL  %s:%s  %s()  ←  %s' % (path, line, name, snippet))
        return 1
    print('OK  未发现「return 表达式内无参数自递归」写法（扫描 %s）' % ROOT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
