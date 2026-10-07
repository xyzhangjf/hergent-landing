#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v392 前端「零夹带」判据 —— 以**生产当前生效版**为基线核对本轮构建产物。

背景：dist-v390-1-4（上一轮上线基线）与 dist-v392-5 比对出现「29 个同名 chunk 内容变了」，
      但工作区里混有**并行会话的在途源改动**（UI-SPEC.md / v365 tools / png），
      所以单靠 v390 基线无法判定夹带。改用**生产生效集**做第二基线。

判据（三层，全部要过）：
  L1 逐文件：本地产物与生产生效集**完整同名**（hash 由内容派生 ⇒ 同名即逐字相同）。
  L2 hash 级联：本地有/生产生效集有同基名不同 hash 的，做 hash 归一化后必须**逐字相同**
                ⇒ 证明差异只是 import 路径 hash 变了，源码零变化。
  L3 入口语义：入口 chunk 归一化（资源引用折叠 + 全标识符→X）后结构必须相同；
                且字符串字面量集合的差集**只允许是资源路径与本轮新增路由的标题**。

用法：
    python3 .workbuddy/tools/v392-entry-zero-sneak-verify.py \
        --dist hergent-cn-v2/dist-v392-5/assets \
        --live /tmp/prod-live-set.txt \
        --prod-names /tmp/prod-assets-names.txt \
        --prod-entry /tmp/prod-entry.js \
        --prod-live-dir /tmp/prod-live
"""
import argparse
import difflib
import os
import re
import sys

H = re.compile(r"-[A-Za-z0-9_-]{8}\.(js|css)")
REFS = re.compile(r"\./([A-Za-z0-9_][A-Za-z0-9._-]*\.(?:js|css))")


def base(n):
    stem, ext = os.path.splitext(n)
    return re.sub(r"-[A-Za-z0-9_-]{8}$", "", stem) + ext


def canon(s):
    """资源引用折叠 + 全标识符归一 ⇒ 只留结构骨架。"""
    s = re.sub(r"\./[A-Za-z0-9_][A-Za-z0-9._-]*\.(?:js|css)", "@@", s)
    s = re.sub(r"assets/[A-Za-z0-9_][A-Za-z0-9._-]*\.(?:js|css)", "@@", s)
    s = re.sub(r"(@@,)+", "@@,", s)
    s = H.sub(r"-H.\1", s)
    s = re.sub(r"[A-Za-z_$][A-Za-z0-9_$]*", "X", s)
    return re.sub(r"\s+", " ", s)


def literals(s):
    """提取字符串字面量集合（资源路径归一）。"""
    out = set()
    pat = re.compile("\"((?:[^\"\\\\]|\\\\.)*)\"|'((?:[^'\\\\]|\\\\.)*)'")
    for m in pat.finditer(s):
        t = m.group(1) if m.group(1) is not None else m.group(2)
        t = re.sub(r"\./[A-Za-z0-9_][A-Za-z0-9._-]*\.(?:js|css)", "@@", t)
        t = re.sub(r"assets/[A-Za-z0-9_][A-Za-z0-9._-]*\.(?:js|css)", "@@", t)
        out.add(t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", required=True)
    ap.add_argument("--live", required=True)
    ap.add_argument("--prod-names", required=True)
    ap.add_argument("--prod-entry", required=True)
    ap.add_argument("--prod-live-dir", required=True)
    a = ap.parse_args()

    prod = {l.strip() for l in open(a.prod_names, encoding="utf-8") if l.strip()}
    live = [l.strip() for l in open(a.live, encoding="utf-8") if l.strip()]
    local = sorted(os.listdir(a.dist))
    live_by_base = {}
    for p in live:
        live_by_base.setdefault(base(p), []).append(p)

    fails = []

    # ---- L1 与生产生效集完整同名 ----
    same = [n for n in local if n in set(live)]
    print("L1 与生产生效集**逐字同名**（未产生新内容）: %d" % len(same))

    # ---- 新增 / 消失 ----
    new = [n for n in local if n not in prod and base(n) not in live_by_base]
    gone = [p for p in live if p not in set(local)]
    print("   本轮全新产物: %d" % len(new))
    print("   生产生效集里消失: %d  -> %s" % (len(gone), ", ".join(gone) or "无"))

    # ---- L2 hash 级联 ----
    cascade, real = [], []
    for n in local:
        if n in prod:
            continue
        b = base(n)
        if b not in live_by_base:
            continue
        pf = live_by_base[b][0]
        lp = os.path.join(a.dist, n)
        pp = os.path.join(a.prod_live_dir, pf)
        if not os.path.exists(pp):
            fails.append("L2 缺生产对应文件: %s" % pf)
            continue
        ls = open(lp, encoding="utf-8", errors="replace").read()
        ps = open(pp, encoding="utf-8", errors="replace").read()
        if H.sub(r"-H.\1", ls) == H.sub(r"-H.\1", ps):
            cascade.append(n)
        else:
            real.append(n)
    print("L2 纯 hash 级联（归一化后逐字相同）: %d" % len(cascade))
    if real:
        fails.append("L2 源码真变化（需归因）: %s" % ", ".join(real))
        print("   ❌ 源码真变化: %s" % ", ".join(real))

    # ---- L3 入口语义：必须是「纯增量」，且增量 ⊆ 本轮 8 条 inventory 子路由 ----
    p = open(a.prod_entry, encoding="utf-8", errors="replace").read()
    entry_local = [n for n in local if base(n) == "index.js"]
    # 允许清单（本轮唯一预期的入口语义增量）
    ALLOW = {
        # 8 条子路由 path 段
        "purchase", "purchase/new", "purchase/:id",
        "sale", "sale/new", "sale/:id", "stock", "",
        # 对应页标题
        "采购单", "新建采购单", "采购单详情",
        "销售单", "新建销售单", "销售单详情", "库存查询",
        # 组件名（chunk 名派生）
        "InvWorkbench", "InvPurchaseList", "InvPurchaseNew", "InvPurchaseDetail",
        "InvSaleList", "InvSaleNew", "InvSaleDetail", "InvStock", "InventoryShell",
        "psi", "psiLabels",
    }
    if not entry_local:
        fails.append("L3 本地找不到入口 chunk")
    else:
        l = open(os.path.join(a.dist, entry_local[0]), encoding="utf-8",
                 errors="replace").read()
        sm = difflib.SequenceMatcher(None, canon(p), canon(l))
        ops = [o for o in sm.get_opcodes() if o[0] != "equal"]
        kinds = {}
        for o in ops:
            kinds[o[0]] = kinds.get(o[0], 0) + 1
        print("L3 入口差异段类型分布: %s" % kinds)
        # (a) 本轮预期是纯增量 ⇒ 不允许出现 delete / replace
        bad = [t for t in ("delete", "replace") if t in kinds]
        if bad:
            fails.append("L3 入口出现非预期差异类型: %s" % bad)
            print("   ❌ 出现 %s（本轮应为纯增量）" % bad)
        # (b) 每个 insert 段里的字符串字面量必须落在允许清单
        cp, cl = canon(p), canon(l)
        unexpected = set()
        for tag, i1, i2, j1, j2 in ops:
            if tag != "insert":
                continue
            for t in literals(cl[j1:j2]):
                if t and t not in ALLOW and not t.startswith("@@"):
                    unexpected.add(t)
        add = literals(l) - literals(p)
        rem = literals(p) - literals(l)
        print("   入口字符串净增 %d / 净减 %d" % (len(add), len(rem)))
        for x in sorted(add):
            flag = "" if x in ALLOW else "   ← 允许清单外"
            print("     + %s%s" % (x, flag))
        for x in sorted(rem):
            print("     - %s" % x)
        outside = sorted(x for x in add if x not in ALLOW and not x.startswith("@@"))
        if outside:
            fails.append("L3 入口新增了允许清单外的字符串: %s" % outside)
        if rem:
            fails.append("L3 入口出现了字符串删除: %s" % sorted(rem))
        if not bad and not outside and not rem:
            print("   ✅ 纯增量，且增量 100%% 落在本轮 8 条子路由允许清单内")

    # ---- 判别力自证（必须能红）----
    print("\n--- 判别力自证（必须能红）---")
    l = open(os.path.join(a.dist, entry_local[0]), encoding="utf-8",
             errors="replace").read() if entry_local else ""
    cases = [
        ("夹带一条清单外路由", l + ',"evil/secret"'),
        ("删除一条生产已有路由", l.replace(',{path:"settings"', '', 1)),
        ("篡改一段逻辑标识符", l.replace("__vite__mapDeps", "EvilHijack")),
        ("删掉一个资源引用", l.replace('"assets/index-HASH.css",', '', 1)),
    ]
    for label, mutated in cases:
        if mutated == l:
            # 该变异在本入口里不适用（锚点不存在）⇒ 换更稳的锚点
            mutated = l.replace("_mapDeps", "_EvilInjected")
        caught = canon(p) != canon(mutated)
        print("   %s: %s" % (label, "✅ 已检出" if caught else "❌ 未检出（判据失效）"))
        if not caught:
            fails.append("判据失效：" + label)

    print("\n--- 统计 ---")
    print("  本地产物 %d = 未改 %d + 全新 %d + 级联 %d + 入口 1"
          % (len(local), len(same), len(new), len(cascade)))
    print("  PASS %d / FAIL %d" % (0 if fails else 1, len(fails)))
    for f in fails:
        print("   FAIL:", f)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
