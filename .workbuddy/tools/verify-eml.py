# -*- coding: utf-8 -*-
"""验收 .eml：解析回来核对结构 / 正文 / 附件，并做内部留痕与 PII 复扫。

用法: python verify-eml.py <x.eml> [原始附件路径]
"""
import email
import hashlib
import re
import sys
from email import policy


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def main():
    eml = sys.argv[1]
    src_attach = sys.argv[2] if len(sys.argv) > 2 else None

    with open(eml, "rb") as f:
        raw = f.read()
    msg = email.message_from_bytes(raw, policy=policy.default)

    print("=== 头部 ===")
    for h in ("From", "To", "Subject", "Date", "Message-ID", "In-Reply-To", "References", "MIME-Version"):
        if msg.get(h):
            print("  %s: %s" % (h, msg.get(h)))

    print("=== 结构 ===")
    parts = []
    for p in msg.walk():
        ct = p.get_content_type()
        disp = p.get_content_disposition()
        fn = p.get_filename()
        payload = p.get_payload(decode=True) or b""
        parts.append((ct, disp, fn, len(payload)))
        print("  %-38s disp=%-10s name=%-42s bytes=%d" % (ct, disp or "-", (fn or "-")[:42], len(payload)))

    text = ""
    html = ""
    for p in msg.walk():
        if p.get_content_type() == "text/plain" and p.get_content_disposition() != "attachment":
            text = p.get_content()
        if p.get_content_type() == "text/html":
            html = p.get_content()

    print("=== 正文 ===")
    tl = text.rstrip().split("\n")
    print("  纯文本 行数=%d 字节=%d | 首行=%s | 末行=%s" % (len(tl), len(text.encode()), tl[0][:40], tl[-1][:40]))
    print("  纯文本残留 ** =", text.count("**"), "| 行首# =", len(re.findall(r"^\s*#", text, flags=re.M)))
    print("  HTML 字节=%d 表格数=%d" % (len(html.encode()), html.count("<table")))

    print("=== 内部留痕复扫（应为 0）===")
    for kw in ["附 ·", "口径确认", "BP 同步", "我替你做的两个决定", "34-AI能力生产取证", "留痕文件", "修改留痕"]:
        n = (text + html).count(kw)
        print("  %-22s -> %d" % (kw, n))

    print("=== 敏感复扫 ===")
    for kw in ["蒙牛", "简爱", "新希望", "妙可蓝多", "康师傅"]:
        print("  品牌 %-6s -> %d" % (kw, (text + html).count(kw)))
    for num in ["18671058882"]:
        print("  本人手机（署名内，应有）%s -> %d" % (num, (text + html).count(num)))

    if src_attach:
        print("=== 附件一致性（还原后 sha256 比对源文件）===")
        src = open(src_attach, "rb").read()
        got = None
        for p in msg.iter_attachments():
            got = p.get_payload(decode=True)
        print("  源文件字节 =", len(src))
        print("  还原字节   =", len(got) if got else 0)
        print("  源 sha256  =", sha256(src)[:24])
        print("  还原 sha256=", sha256(got)[:24] if got else "-")
        print("  一致 =", "✅ 是" if got and sha256(src) == sha256(got) else "❌ 否")


if __name__ == "__main__":
    main()
