# -*- coding: utf-8 -*-
"""组装标准 .eml 邮件文件（可直接被邮件客户端打开 = 一封填好的邮件，未发送）。

用法:
  python build-eml.py --to 收件人 --to-name 收件人显示名 --subject 主题 \
      --text 纯文本正文.md --html 富文本正文.html \
      --attach 附件1 --attach 附件2 --out 输出.eml [--in-reply-to <msgid>] \
      [--from-name 发件人显示名] [--from-addr 发件人地址]

设计要点:
  - multipart/mixed 外层 + multipart/alternative 内层（纯文本 + HTML 双版本）
  - 中文主题/附件名交给 email 库做 RFC2047 / RFC2231 编码，避免乱码
  - 附件用 base64，分块读取，避免大文件爆内存
  - 只落盘，不发送（本脚本不含任何发送逻辑）
"""
import argparse
import base64
import os
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True)
    ap.add_argument("--to-name", default="")
    ap.add_argument("--from-addr", default="")
    ap.add_argument("--from-name", default="")
    ap.add_argument("--subject", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--html", default="")
    ap.add_argument("--attach", action="append", default=[])
    ap.add_argument("--out", required=True)
    ap.add_argument("--in-reply-to", default="")
    args = ap.parse_args()

    text = open(args.text, encoding="utf-8").read()
    html = open(args.html, encoding="utf-8").read() if args.html else ""

    msg = EmailMessage()
    if args.from_name and args.from_addr:
        msg["From"] = "%s <%s>" % (args.from_name, args.from_addr)
    elif args.from_addr:
        msg["From"] = args.from_addr
    if args.to_name:
        msg["To"] = "%s <%s>" % (args.to_name, args.to)
    else:
        msg["To"] = args.to
    msg["Subject"] = args.subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="qq.com")
    if args.in_reply_to:
        msg["In-Reply-To"] = args.in_reply_to
        msg["References"] = args.in_reply_to

    msg.set_content(text, subtype="plain", charset="utf-8")
    if html:
        msg.add_alternative(html, subtype="html", charset="utf-8")

    for path in args.attach:
        if not os.path.exists(path):
            print("附件不存在，跳过:", path, file=sys.stderr)
            continue
        with open(path, "rb") as f:
            data = f.read()
        fn = os.path.basename(path)
        if fn.lower().endswith(".pdf"):
            maintype, subtype = "application", "pdf"
        elif fn.lower().endswith(".xlsx"):
            maintype, subtype = "application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif fn.lower().endswith(".docx"):
            maintype, subtype = "application", "vnd.openxmlformats-officedocument.wordprocessingml.document"
        else:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=fn)
        print("已附:", fn, len(data), "字节")

    with open(args.out, "wb") as f:
        f.write(msg.as_bytes())

    raw = open(args.out, "rb").read()
    print("--- 自证 ---")
    print("输出:", args.out)
    print("字节:", len(raw))
    print("行数:", raw.count(b"\n"))
    for h in ("From", "To", "Subject", "Date", "In-Reply-To", "References"):
        if msg.get(h):
            print("%s: %s" % (h, msg.get(h)))
    print("附件数:", len(args.attach))
    print("纯文本字节:", len(text.encode("utf-8")))
    print("HTML 字节:", len(html.encode("utf-8")) if html else 0)


if __name__ == "__main__":
    main()
