#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v383 零夹带判据链（四路）—— 对一个候选构建产物做「有没有把别人未上线的东西带出去」的判定。

四路：
  ① 基名集（剥 hash）必须与「上轮生产基线构建」**完全一致**（多一个 = 新增模块 = 夹带）
  ② 基名集必须是**生产生效集**的子集（生产 assets 是历次构建并集，只判"有没有多"）
  ③ 同名基（剥 hash 后同名）逐字节比对，列出**内容变了**的那些 —— 用于解释 hash 级联范围
  ④ 候选产物里全文扫描「未上线模块」特征串（默认 Inventory / 进销存 / 采购单），命中即夹带

用法：
  python3 v383-contraband-check.py <基线dist目录> <候选dist目录> <生产assets名单文件> [--marker 串]
"""
import hashlib
import os
import re
import sys

RE_HASHED = re.compile(r"^(?P<base>.+?)-(?P<hash>[A-Za-z0-9_-]{8})\.(?P<ext>js|css)$")
# 候选产物里不该出现的"未上线模块"特征串
CONTRA_PROBES = ["Inventory", "进销存", "采购单", "销售单"]


def strip_hash(name):
    m = RE_HASHED.match(name)
    return m.group("base") if m else name


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_names(d):
    ad = os.path.join(d, "assets")
    return sorted(os.listdir(ad)), ad


def base_of(names):
    """按 (基名, 扩展名) 归组 —— 同名基可能同时有 .js 与 .css（如 Archive），
    必须按扩展名配对，否则会把 css 去和 js 比（v383 首跑踩到）。"""
    out = {}
    for n in names:
        m = RE_HASHED.match(n)
        key = (m.group("base"), m.group("ext")) if m else (n, "")
        out.setdefault(key, []).append(n)
    return out


def probe_hits(ad, names, probes):
    """返回 {probe: [(文件名, 归一后内容 md5)]}。
    🔴 两条都必须记住（v383 首跑连踩两次误报）：
       ① 按**内容**而不是文件名做差值 —— hash 级联会让同一个 chunk 改名，
          按文件名比会把"改名"误判成"新增"；
       ② md5 要算在**归一后**的内容上 —— `__vite__mapDeps` 里嵌着 chunk 文件名，
          改名会让整体 md5 变化，但业务内容一字未改。"""
    hits = {}
    for n in names:
        p = os.path.join(ad, n)
        try:
            data = open(p, "rb").read()
        except OSError:
            continue
        m = hashlib.md5(normalize(data)).hexdigest()
        for probe in probes:
            if probe.encode("utf-8") in data:
                hits.setdefault(probe, []).append((n, m))
    return hits


# ---- ⑥ 归一化：把 hash 文件名与 scopeId 抹平，只留"业务内容" ----
RE_ASSET_TOKEN = re.compile(rb"[A-Za-z0-9_$./-]*?-[A-Za-z0-9_-]{8}\.(?:js|css)")
RE_SCOPE = re.compile(rb"data-v-[0-9a-z]{8}")


def normalize(data):
    data = RE_ASSET_TOKEN.sub(b"<ASSET>", data)
    data = RE_SCOPE.sub(b"<SCOPE>", data)
    return data


def main():
    base_dist, cand_dist, prod_list = sys.argv[1], sys.argv[2], sys.argv[3]
    marker = None
    if "--marker" in sys.argv:
        marker = sys.argv[sys.argv.index("--marker") + 1]

    base_names, base_ad = scan_names(base_dist)
    cand_names, cand_ad = scan_names(cand_dist)
    prod_names = [l.strip() for l in open(prod_list, encoding="utf-8") if l.strip()]

    bb, cb = base_of(base_names), base_of(cand_names)
    pb = set(strip_hash(n) for n in prod_names)
    fails = []

    print("基线产物 %d 个 / 候选产物 %d 个 / 生产并集 %d 个" % (len(base_names), len(cand_names), len(prod_names)))

    # ---- ① 基名集必须一致 ----
    only_cand = sorted(set(k[0] for k in cb) - set(k[0] for k in bb))
    only_base = sorted(set(k[0] for k in bb) - set(k[0] for k in cb))
    print("\n[①] 基名集对比（候选 vs 基线）")
    print("    候选多出的基名（=新增模块）: %s" % (only_cand or "无"))
    print("    候选缺失的基名: %s" % (only_base or "无"))
    if only_cand or only_base:
        fails.append("①基名集不一致")

    # ---- ② 基名集必须是生产生效集的子集 ----
    not_in_prod = sorted(set(k[0] for k in cb) - pb)
    print("\n[②] 基名集 vs 生产生效集")
    print("    生产里没有的基名: %s" % (not_in_prod or "无"))
    if not_in_prod:
        fails.append("②存在生产未生效的基名")

    # ---- ③ 同 (基名,扩展名) 逐字节比对 ----
    print("\n[③] 同 (基名,扩展名) 内容比对")
    changed, same = [], []
    for key in sorted(set(bb) & set(cb)):
        bn, cn = bb[key][0], cb[key][0]
        bp, cp = os.path.join(base_ad, bn), os.path.join(cand_ad, cn)
        sb, sc = os.path.getsize(bp), os.path.getsize(cp)
        if md5(bp) == md5(cp):
            same.append((key[0], key[1], bn))
        else:
            changed.append((key[0], key[1], bn, cn, sb, sc))
    print("    内容完全相同: %d 项（仅可能被改名的项）" % len(same))
    for b, e, bn in same:
        print("      = %-20s %s" % (b, bn))
    print("    内容不同:     %d 项" % len(changed))
    for b, e, bn, cn, sb, sc in changed:
        print("      · %-20s %s(%d) -> %s(%d)  Δ=%+d" % (b, bn, sb, cn, sc, sc - sb))
    only_base_keys = sorted(set(bb) - set(cb))
    only_cand_keys = sorted(set(cb) - set(bb))
    if only_base_keys:
        print("    仅基线有: %s" % [f"{b}.{e}" for b, e in only_base_keys])
        fails.append("③有产物在候选里消失")
    if only_cand_keys:
        print("    仅候选有: %s" % [f"{b}.{e}" for b, e in only_cand_keys])

    # ---- ④ 特征串扫描：只认「候选有、基线没有」的**内容差值** ----
    print("\n[④] 未上线模块特征串扫描（差值口径 = 候选命中内容的 md5 集 − 基线命中内容的 md5 集）")
    base_hits = probe_hits(base_ad, base_names, CONTRA_PROBES)
    cand_hits = probe_hits(cand_ad, cand_names, CONTRA_PROBES)
    for probe in CONTRA_PROBES:
        gb = base_hits.get(probe, [])
        gc = cand_hits.get(probe, [])
        # 基线里已有的**内容**（按 md5 认，改名不算）
        bm = set(m for _, m in gb)
        delta = [n for n, m in gc if m not in bm]
        print("    %-10s 基线 %d 文件 / 候选 %d 文件 / **内容新增 %d** %s"
              % (probe, len(gb), len(gc), len(delta), delta or ""))
        if delta:
            fails.append("④特征串内容新增 %s→%s" % (probe, delta))

    # ---- ⑤ 本轮修复标记是否真的进了产物 ----
    if marker:
        print("\n[⑤] 本轮修复标记扫描：%s" % marker)
        mh = probe_hits(cand_ad, cand_names, [marker]).get(marker, [])
        bh = probe_hits(base_ad, base_names, [marker]).get(marker, [])
        print("    候选命中: %s" % ([n for n, _ in mh] or "!! 未命中 —— 修复没进产物"))
        print("    基线命中: %s  ← 必须为空，证明标记是本轮新引入（判据有判别力）"
              % ([n for n, _ in bh] or "无"))
        if not mh:
            fails.append("⑤修复标记未进产物")
        if bh:
            fails.append("⑤基线已含该标记，判据无判别力")

    # ---- ⑥ 全 token 归一后的残差（这是"零夹带"的正面证据） ----
    print("\n[⑥] 全 token 归一（asset 名 + scopeId → 占位符）后逐字节比对")
    residual_ok, residual_bad = [], []
    for key in sorted(set(bb) & set(cb)):
        bp = os.path.join(base_ad, bb[key][0])
        cp = os.path.join(cand_ad, cb[key][0])
        nb, nc = normalize(open(bp, "rb").read()), normalize(open(cp, "rb").read())
        name = "%s.%s" % key
        if nb == nc:
            residual_ok.append(name)
        else:
            diff = abs(len(nc) - len(nb))
            residual_bad.append((name, len(nb), len(nc), diff))
    print("    归一后**完全一致**（差异 100%% 来自改名/scopeId 级联）: %d 项" % len(residual_ok))
    print("    归一后**仍有残差**（= 真实内容改动，需要能逐条解释）: %d 项" % len(residual_bad))
    for name, lb, lc, d in residual_bad:
        print("      · %-20s 归一后 %d -> %d  Δ=%+d" % (name, lb, lc, d))
    # 本轮只改了 1 个 SFC ⇒ 残差只允许出现在它所在的 chunk（Archive.js）
    unexpected = [n for n, _, _, _ in residual_bad if n != "Archive.js"]
    if unexpected:
        fails.append("⑥出现无法解释的残差 %s" % unexpected)

    print("\n结论: %s" % ("全部通过 ✅" if not fails else "未通过 ❌ " + " / ".join(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
