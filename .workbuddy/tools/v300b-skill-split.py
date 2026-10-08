#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 hergent-scoped-commit/SKILL.md 拆成「主文件 + references/5 个分册」。

原则：
  ① 正文一律**逐字节搬运**（只动导航段与文件头），不改任何章节内容；
  ② § 编号原样保留（外部大量引用）；
  ③ 搬完做**严格断言**：主文件核心段 + 5 个分册正文 == 原文（逐字节）。

不依赖任何第三方库。可重复运行（幂等：以 .bak 原件为输入）。
"""
import hashlib
import os
import shutil
import sys

SK_DIR = os.path.expanduser("~/.workbuddy/skills/hergent-scoped-commit")
SK = os.path.join(SK_DIR, "SKILL.md")
REF_DIR = os.path.join(SK_DIR, "references")
BAK = "/tmp/SKILL.md.bak-v300b-20260928"
HEAD_MD = "/tmp/v300b-nav-head.md"
ROWS_MD = "/tmp/v300b-nav-rows.md"

MARK_HDR = "\n---\n\n"   # 分册「文件头」与「正文」的分界（正文里不会出现它）

# ---- 分册定义：(文件名, 标题, 含哪些 §, 章节索引区间 [a,b]) ----
# 章节索引来自 v300b-skill-section-recon.py 的输出（0=导航, 1..6=§0..§5, 7..59=搬运区）
REFS = [
    ("01-构造索引与手工拆补丁.md",
     "构造索引与手工拆补丁",
     "§5.5 §5.6 §5.8 §6 §7 §8 §5.7 §9 §10 §11 §12",
     7, 17),
    ("02-归属判定与spec键.md",
     "归属判定与 spec 键",
     "§5.9 §5.10 §5.11 §5.12 §5.13 §5.14 §5.15 §5.16 §5.17 §5.18 §5.19 §5.20 §5.21 §5.22 §5.23 §5.24 §5.24b",
     18, 34),
    ("03-切分键与第三产物.md",
     "切分键与第三产物",
     "§5.25 §5.26 §5.27 §5.28 §5.29",
     35, 39),
    ("04-提交机制与提交后复核.md",
     "提交机制与提交后复核",
     "§5.30 §5.31 §5.32 §5.33 §5.34 §5.35 §5.36 §5.36b",
     40, 47),
    ("05-审计-披露-收尾.md",
     "审计 · 披露 · 收尾",
     "§5.37 §5.38 §5.39 §5.40 §5.41 §5.41b §5.41c §5.42 §5.43 §5.44 §5.45 §5.46",
     48, 59),
]

# 索引表「文件」列：**不再手工给映射**（第一版手写 ROW_FILE，把 §5.31/32/33 → 02、§5.40 → 04
# 写错了 4 条，全是抽样核对才发现的）⇒ 改为**从第 2 列的 § 号自动推导**所在分册。
# 推导规则：§ 号 → 章节索引（`###` 子节回退到最近的 `##`）→ 落在哪个 REFS 区间。
def _sec_index_of(token, hdrs):
    """'5.31' / '5.29.0' / '10.9' → 该号所属 `## ` 章节的索引。"""
    cand = token
    while cand:
        for k, (_i, h) in enumerate(hdrs):
            m = _re.match(r"^## §?(\d+(?:\.\d+)?[a-z]?)", h)
            if m and m.group(1) == cand:
                return k
        cand = cand.rsplit(".", 1)[0] if "." in cand else ""
    return None


import re as _re


def derive_code(col2, hdrs):
    """从索引表第 2 列推出「文件」列（正文 / 01..05 / 组合如「正文·01」）。"""
    toks = _re.findall(r"§(\d+(?:\.\d+)*[a-z]?)", col2)
    codes = []
    for t in toks:
        k = _sec_index_of(t, hdrs)
        if k is None:
            continue
        c = next((f[0].split("-")[0] for f in REFS if f[3] <= k <= f[4]), "正文")
        if c not in codes:
            codes.append(c)
    if not codes:
        return None
    order = {"正文": 0}
    codes.sort(key=lambda c: (order.get(c, 1), c))
    return "·".join(codes)


ROW_FILE = None   # 已废弃（保留名字仅为兼容旧调用）


def md5(b):
    return hashlib.md5(b).hexdigest()


def main():
    # ---------- 0. 备份（若已存在则复用，保证幂等） ----------
    if not os.path.exists(BAK):
        shutil.copy2(SK, BAK)
        print("[备份] %s -> %s (%d 字节)" % (SK, BAK, os.path.getsize(BAK)))
    else:
        print("[备份] 复用已有 %s (%d 字节)" % (BAK, os.path.getsize(BAK)))

    raw = open(BAK, "rb").read()
    text = raw.decode("utf-8")
    lines = text.split("\n")
    N = len(raw)

    # ---------- 1. 找章节边界（字节偏移） ----------
    offs, hdrs = [], []
    boff = 0
    for i, ln in enumerate(lines):
        if ln.startswith("## "):
            offs.append(boff)
            hdrs.append((i, ln))
        boff += len(ln.encode("utf-8")) + 1
    assert len(offs) == 60, "章节数变了：%d（期望 60）" % len(offs)

    def sec_bytes(k):
        """第 k 个 `## ` 章节的完整原文（含尾部空行）。"""
        a = offs[k]
        b = offs[k + 1] if k + 1 < len(offs) else N
        return raw[a:b]

    def sec_text(k):
        return sec_bytes(k).decode("utf-8")

    # ---------- 2. 切出各段 ----------
    front = raw[:offs[0]]                       # frontmatter + H1 + 空行
    nav_orig = sec_text(0)                      # 旧导航（将被替换）
    core = sec_text(1) + sec_text(2) + sec_text(3) + sec_text(4) + sec_text(5) + sec_text(6)
    moved_orig = b"".join(sec_bytes(k) for k in range(7, 60))

    # ---------- 3. 造新导航 ----------
    nav_lines = nav_orig.split("\n")
    out_rows, di = [], -1
    for ln in nav_lines:
        if ln.startswith("| "):
            cells = ln.split("|")
            # 🔴 每行必须正好 5 格（否则说明描述里含未转义的 `|`，改列会写错位置）
            assert len(cells) == 5, "导航表行格数异常(%d)：%s" % (len(cells), ln[:90])
            if not (set(cells[1].strip()) <= set("-: ")):
                di += 1
                if di == 0:                      # 表头 → 换成新表头，并**补上分隔行**
                    out_rows.append("| 你要做什么 | 直接跳到 | 文件 |")
                    out_rows.append("|---|---|---|")
                    continue
                code = derive_code(cells[2], hdrs)
                assert code, "第 %d 行推不出所属分册：%s" % (di, cells[2][:60])
                newc = list(cells)
                newc[3] = " **%s** " % code
                out_rows.append("|".join(newc))
    print("[导航] 表头 1 行 + 数据 %d 行已改列（短码由 § 号自动推导）；另追加新行" % di)

    new_rows = open(ROWS_MD, "r", encoding="utf-8").read().rstrip("\n")
    tail = "\n".join(lines[57:66])               # 空行 + 动手前必读三条 + 空行
    head = open(HEAD_MD, "r", encoding="utf-8").read().rstrip("\n")

    # ---- 3b. 🔴 交叉断言：手写的附加行里「§ 号 ↔ 文件短码」必须自洽 ----
    # 起因：第一版靠人工写短码，把 §5.31/§5.32/§5.33 写成了 02（实际在 04）——
    # 脚本当时对此**零校验**，是抽样核对才发现的。此处补上：由章节索引反查所在分册。
    import re
    secidx = {}          # "5.11" -> 章节索引
    for k, (i, h) in enumerate(hdrs):
        m = re.match(r"^## §?(\d+(?:\.\d+)?[a-z]?)", h)
        if m:
            secidx.setdefault(m.group(1), k)
    # ---- 3b. 附加行的「文件」列也**自动推导**（人工写的只当参考，不符即报并修正）----
    fixed_rows, drift = [], []
    for ln in new_rows.split("\n"):
        if not ln.startswith("| "):
            fixed_rows.append(ln)
            continue
        c = ln.split("|")
        assert len(c) == 5, "附加行格数异常(%d)：%s" % (len(c), ln[:80])
        code = derive_code(c[2], hdrs)
        assert code, "附加行推不出所属分册：%s" % c[2][:60]
        hand = c[3].strip().strip("*").strip()
        if hand != code:
            drift.append((c[2].strip()[:34], hand, code))
        c[3] = " **%s** " % code
        fixed_rows.append("|".join(c))
    new_rows = "\n".join(fixed_rows)
    if drift:
        print("[提示] 附加行 %d 条人工短码与推导不符（已按推导修正）：" % len(drift))
        for d in drift:
            print("      %-36s 人写 %-6s → 推导 %s" % d)
    print("[导航] 附加行短码全部由 § 号推导（%d 条数据行）"
          % sum(1 for ln in new_rows.split("\n") if ln.startswith("| ")))

    nav_new = (head + "\n\n" + "\n".join(out_rows) + "\n" + new_rows + "\n\n"
               + tail.lstrip("\n") + "\n")

    # ---------- 4. 写各分册 ----------
    os.makedirs(REF_DIR, exist_ok=True)
    bodies = []
    for (fn, title, contains, a, b) in REFS:
        body = "".join(sec_text(k) for k in range(a, b + 1))
        bodies.append(body)
        hdr = (
            "# 受控提交 · 参考 %s\n\n"
            "> 本文件是技能 `hergent-scoped-commit` 的**细节分册**（2026-09-28 从单文件拆出，"
            "章节内容**逐字节未改**）。\n"
            "> 回主文件：`../SKILL.md`（含 §0–§5 与完整索引表）。\n"
            "> **本文件含**：%s\n"
            ">\n"
            "> ⚠️ 本技能是**追加式**文档：**别按编号猜物理位置**（`§5.8` 排在 `§6` 之前、"
            "`§5.7` 排在 `§8` 之后）。**按 § 号在文件内搜。**\n"
        ) % (fn.split("-")[0], contains)
        path = os.path.join(REF_DIR, fn)
        open(path, "wb").write((hdr + MARK_HDR + body).encode("utf-8"))
        print("[分册] %-38s 章节 %2d..%-2d  %7d 字节" % (fn, a, b, len(body.encode("utf-8"))))

    # ---------- 5. 写新主文件 ----------
    # 更新 description（补一句「细节在 references/」），其余 frontmatter 原样
    front_s = front.decode("utf-8")
    hint = ("🔴 **2026-09-28 起本技能已拆分**：主文件只有 §0–§5 与索引，"
            "`§5.5` 之后的实测细节在 `references/` 的 5 个分册里 —— **先看主文件的「文件清单」与索引表定位**。")
    lines_f = front_s.split("\n")
    for i, ln in enumerate(lines_f):
        if ln.startswith("description: "):
            lines_f[i] = ln.rstrip() + " " + hint
            break
    else:
        raise SystemExit("找不到 description 行")
    front_new = "\n".join(lines_f)

    new_skill = front_new + nav_new + core
    open(SK, "w", encoding="utf-8").write(new_skill)

    # ---------- 6. 严格校验 ----------
    print("")
    print("=== 校验 ===")
    ok = True

    # 6.1 搬运区逐字节：分册正文之和 == 原文搬运区
    joined = "".join(bodies)
    same = (joined == moved_orig.decode("utf-8"))
    print("6.1 分册正文之和 == 原文 §5.5..§5.46 逐字节：%s" % ("✅ 是" if same else "❌ 否"))
    ok &= same

    # 6.2 core 逐字节
    core_same = core == "".join(sec_text(k) for k in range(1, 7))
    print("6.2 主文件 §0–§5 逐字节 == 原文：%s" % ("✅ 是" if core_same else "❌ 否"))
    ok &= core_same

    # 6.3 章节数守恒
    n_new = sum(1 for ln in new_skill.split("\n") if ln.startswith("## "))
    n_ref = sum(1 for f in REFS
                for ln in open(os.path.join(REF_DIR, f[0]), encoding="utf-8")
                if ln.startswith("## "))
    print("6.3 章节数：主文件 %d + 分册 %d = %d（原文 60）：%s"
          % (n_new, n_ref, n_new + n_ref, "✅" if n_new + n_ref == 60 else "❌"))
    ok &= (n_new + n_ref == 60)

    # 6.4 每个 § 恰好出现一次（跨全部分册 + 主文件）
    allp = new_skill + joined
    miss = []
    for k in range(7, 60):
        h = hdrs[k][1]
        if allp.count("\n" + h + "\n") != 1:
            miss.append((k, h[:50], allp.count("\n" + h + "\n")))
    print("6.4 每个搬运章节标题恰好出现 1 次：%s%s"
          % ("✅ 是" if not miss else "❌ 否 ", miss[:6]))
    ok &= (not miss)

    # 6.5 旧导航表头已不在新主文件里
    # ⚠️ 判据必须挑「只属于旧导航」的形态：不能用「物理位置提示」这种词 ——
    #    它在新导航的**解释性文字**里合法出现（第一版探针据此报了假红，见 pitfalls §12）。
    old_hdr = "| 你要做什么 | 直接跳到 | 物理位置提示 |"
    got = new_skill.count(old_hdr)
    print("6.5 旧表头整行已移除（`%s` 出现 %d 次，期望 0）：%s"
          % (old_hdr, got, "✅ 是" if got == 0 else "❌ 否"))
    ok &= (got == 0)
    # 6.5b 新表头在位
    print("6.5b 新表头在位（`| 你要做什么 | 直接跳到 | 文件 |`）：%s"
          % ("✅ 是" if new_skill.count("| 你要做什么 | 直接跳到 | 文件 |") == 1 else "❌ 否"))
    ok &= (new_skill.count("| 你要做什么 | 直接跳到 | 文件 |") == 1)

    # 6.6 表头下一行必须是分隔行 —— 否则 Markdown 表格**整块散架**
    #     （第一版脚本把表头换掉时漏了它，靠人工读第 37~38 行才发现 ⇒ 补成断言）
    _i = new_skill.find("| 你要做什么 | 直接跳到 | 文件 |\n")
    _nxt = new_skill[_i:].split("\n")[1].strip() if _i >= 0 else ""
    print("6.6 表头下一行 == `|---|---|---|`：%s（实际 `%s`）"
          % ("✅ 是" if _nxt == "|---|---|---|" else "❌ 否", _nxt))
    ok &= (_nxt == "|---|---|---|")

    print("")
    print("原文 %d 字节 → 主文件 %d 字节（%.1f×）＋ 分册合计 %d 字节"
          % (N, len(new_skill.encode("utf-8")),
             N / max(1, len(new_skill.encode("utf-8"))),
             sum(len(b.encode("utf-8")) for b in bodies)))
    print("")
    print("结果：%s" % ("✅ 全部通过" if ok else "❌ 有校验失败"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
