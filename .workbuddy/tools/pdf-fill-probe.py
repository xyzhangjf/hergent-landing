#!/usr/bin/env python3
"""pdf-fill-probe.py — 探测 PDF 每页填充率（排除页脚），找出排版空白页。
用法: python pdf-fill-probe.py <pdf> [footer_y=790]
"""
import sys
import fitz  # pymupdf

path = sys.argv[1]
footer_y = float(sys.argv[2]) if len(sys.argv) > 2 else 790.0

doc = fitz.open(path)
print("页数:", doc.page_count)
rows = []
for i, page in enumerate(doc):
    ph = page.rect.height
    h1_top, h1_bot = ph, 0.0
    chars = 0
    for b in page.get_text("blocks"):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], b[4]
        if y1 > footer_y:      # 排除页脚
            continue
        t = (txt or "").strip()
        if not t:
            continue
        chars += len(t)
        h1_top = min(h1_top, y0)
        h1_bot = max(h1_bot, y1)
    usable = footer_y - 60.0   # 上边距按 60pt 估
    fill = (h1_bot - h1_top) / usable if usable > 0 else 0
    rows.append((i + 1, round(fill * 100), chars, round(h1_top), round(h1_bot)))

for r in rows:
    flag = "  <-- 稀疏" if r[1] < 50 else ""
    print(f"p{r[0]:>2}  填充 {r[1]:>3}%  字数 {r[2]:>5}  区块 y {r[3]}-{r[4]}{flag}")

sparse = [r for r in rows if r[1] < 50]
print("\n稀疏页(<50%):", [r[0] for r in sparse] or "无")
print("最低填充:", min(rows, key=lambda r: r[1]))
