#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v441 —— 进销存建单页「类差集审计」（UI-SPEC §7.1 的机械判据）

做什么
------
对指定的 N 个 .vue 文件：抽模板里 `class="..."` 用到的类名集合，减去
  (a) 本文件 <style> 里定义过的类
  (b) 全局样式表（variables.css / col-menu.css）里定义过的类
  (c) 项目里任何 .vue/.css 文件定义过的类（兜底，覆盖共享组件样式）
剩下的即「用了但没人定义」的类 ⇒ 差集必须为空。

为什么需要它
------------
本项目 2026-09-22 实测出过「17 个类零样式定义」的缺陷（构建零报错、肉眼极难发现）。
v442 对 InvSaleNew.vue 做了一次整体结构重写（新增 isn-hd-box / isn-strip /
isn-bottom / isn-ro / isn-hint 等一批类），必须自证每个类都真的有样式。

判别力自证
----------
脚本最后做一次**变异自证**：临时往被测文件的模板里塞一个必然无样式的类
（`zzz-no-such-class-zzz`），重跑抽取 —— 若差集没变红，说明审计本身无效（恒绿），
必须报 FAIL 而不是 PASS。
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(REPO, "hergent-cn-v2", "src")

TARGETS = [
    "pages/inventory/InvSaleNew.vue",
    "pages/inventory/InvPurchaseNew.vue",
]

# 全局样式表（顺序无关，全部并进"已定义"集合）
GLOBAL_CSS = ["styles/variables.css", "styles/col-menu.css"]

CSS_RULE = re.compile(r"([^{}]+)\{[^{}]*\}")
CLASS_IN_SELECTOR = re.compile(r"\.([A-Za-z_][-\w]*)")


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return text


def classes_defined_in(css_text):
    out = set()
    for sel in CSS_RULE.findall(strip_comments(css_text)):
        for c in CLASS_IN_SELECTOR.findall(sel):
            out.add(c)
    return out


def collect_repo_defined():
    """项目里所有 .vue / .css 定义过的类（兜底集合）。"""
    out = set()
    for root, _dirs, files in os.walk(SRC):
        for fn in files:
            if not fn.endswith((".vue", ".css")):
                continue
            p = os.path.join(root, fn)
            with open(p, encoding="utf-8") as f:
                txt = f.read()
            if fn.endswith(".vue"):
                # 只取 <style> 段，模板里的 class="..." 不算"定义"
                for m in re.finditer(r"<style[^>]*>(.*?)</style>", txt, re.S):
                    out |= classes_defined_in(m.group(1))
            else:
                out |= classes_defined_in(txt)
    return out


# 🔴 `CLASS_ATTR` 必须带**负向后顾**：`class="` 是 `:class="` 的子串 ——
#    不加 `(?<![:\w-])` 的话，`<div :class="{ fallback: row.unitFromBase }">` 会被当成
#    静态 class 处理，再按空白切开后得到 `fallback:` / `{` / `}` 这类垃圾，
#    审计会**恒红**（本次实测踩到，差集里冒出一堆 `{`、`}`、`row.xxx`）。
#    脚本自身的错也会被当成"代码有问题"，所以这里必须写对。
CLASS_ATTR = re.compile(r'(?<![:\w-])class="([^"]*)"', re.S)
# :class="{ a: cond, b: x }" / :class="[...]" —— 只抓字面量键名
BIND_OBJ_KEY = re.compile(r"[{,]\s*'?([A-Za-z_][-\w]*)'?\s*:")


def classes_used_in_template(vue_text):
    tpl = vue_text
    m = re.search(r"<template>(.*)</template>", vue_text, re.S)
    if m:
        tpl = m.group(1)
    used = set()
    for v in CLASS_ATTR.findall(tpl):
        # 静态 class="a b c"（也覆盖 :class="'a b'" 的静态写法）
        for tok in re.split(r"\s+", v.strip()):
            if tok:
                used.add(tok)
    for m in re.finditer(r':class="([^"]*)"', tpl, re.S):
        used |= set(BIND_OBJ_KEY.findall(m.group(1)))
    return used


def audit(targets, mutate_extra=None):
    """返回 {file: sorted(undefined_classes)}"""
    repo_defined = collect_repo_defined()
    res = {}
    for rel in targets:
        p = os.path.join(SRC, rel)
        with open(p, encoding="utf-8") as f:
            txt = f.read()
        if mutate_extra:
            txt = txt.replace("<template>", '<template><i class="%s"></i>' % mutate_extra, 1)
        own = set()
        for m in re.finditer(r"<style[^>]*>(.*?)</style>", txt, re.S):
            own |= classes_defined_in(m.group(1))
        glob = set()
        for g in GLOBAL_CSS:
            gp = os.path.join(SRC, g)
            if os.path.exists(gp):
                with open(gp, encoding="utf-8") as f:
                    glob |= classes_defined_in(f.read())
        defined = own | glob | repo_defined
        used = classes_used_in_template(txt)
        res[rel] = sorted(used - defined)
    return res


def main():
    print("=" * 72)
    print("v441 类差集审计（UI-SPEC §7.1）—— 差集必须为空")
    print("=" * 72)

    base = audit(TARGETS)
    ok = True
    for rel, missing in base.items():
        if missing:
            ok = False
            print("[FAIL] %s  未定义类 %d 个：%s" % (rel, len(missing), ", ".join(missing)))
        else:
            print("[OK]   %s  模板用到的类全部有样式定义" % rel)

    # ---- 判别力自证：塞一个必然无样式的类，差集必须变红 ----
    MUT = "zzz-no-such-class-zzz"
    mut = audit(TARGETS[:1], mutate_extra=MUT)
    caught = MUT in mut[TARGETS[0]]
    print("-" * 72)
    print("判别力自证：注入 %s ⇒ 报告为未定义 = %s（必须 True）" % (MUT, caught))
    if not caught:
        ok = False
        print("[FAIL] 审计恒绿 —— 抽取逻辑无效，上面的 OK 不可信")
    else:
        print("[OK]   判据真的在起作用（不是恒真）")

    print("=" * 72)
    print("VERDICT:", "ALL_PASS" if ok else "HAS_FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
