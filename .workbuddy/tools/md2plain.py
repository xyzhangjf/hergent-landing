# -*- coding: utf-8 -*-
"""Markdown -> 邮件可读纯文本（去掉标记，保留段落与表格列结构）。

用法: python md2plain.py <in.md> <out.txt>
"""
import re
import sys


def convert(md: str) -> str:
    lines = md.split("\n")
    out = []
    for l in lines:
        s = l.strip()
        # 表格分隔行 |---|---|  ->  浅色横线
        if re.match(r"^\|[\s\-:|]+\|$", s):
            out.append("-" * 40)
            continue
        # 表格数据行：去掉首尾竖线，单元格用 "  |  " 分隔
        if s.startswith("|") and s.endswith("|") and len(s) > 1:
            cells = [c.strip() for c in s.strip("|").split("|")]
            out.append("  |  ".join(cells))
            continue
        out.append(l)

    t = "\n".join(out)
    t = re.sub(r"^\s{0,3}#{1,6}\s*", "", t, flags=re.M)   # 标题井号
    t = re.sub(r"^\s*>\s?", "", t, flags=re.M)            # 引用符号
    t = t.replace("**", "")                                # 加粗标记
    t = t.replace("`", "")                                 # 行内代码
    t = re.sub(r"^\s*[-*]\s+", "  · ", t, flags=re.M)      # 无序列表
    t = re.sub(r"\n{4,}", "\n\n\n", t)
    return t.strip() + "\n"


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    txt = convert(open(src, encoding="utf-8").read())
    open(dst, "w", encoding="utf-8").write(txt)
    print("OK ->", dst)
    print("字节:", len(txt.encode("utf-8")))
    print("残留 ** =", txt.count("**"))
    print("残留行首# =", len(re.findall(r"^\s*#", txt, flags=re.M)))
    bl = txt.rstrip().split("\n")
    print("行数:", len(bl))
    print("首行:", bl[0][:60])
    print("末行:", bl[-1][:60])
