# server/connectors/qqmail.py — QQ邮箱连接器（直连接口）
# 连接时验证 SMTP 登录；invoke 直接发邮件 / 列收件箱（IMAP）。
import ssl
import smtplib
import imaplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from .base import IServiceConnector
from .schemas import ConnectorStatus, ToolResult, ConnectorHealth


class QQMailConnector(IServiceConnector):
    def __init__(self, manifest: dict):
        self._manifest = manifest
        self._cfg: dict = {}
        self._connected = False

    @property
    def service_id(self) -> str:
        return "qqmail"

    async def configure(self, cfg: dict) -> None:
        self._cfg = cfg or {}

    # ---------- 内部 SMTP 助手 ----------
    def _smtp(self):
        ctx = ssl.create_default_context()
        s = smtplib.SMTP_SSL("smtp.qq.com", 465, context=ctx, timeout=15)
        s.login(self._cfg["email"], self._cfg["auth_code"])
        return s

    def _imap(self):
        c = imaplib.IMAP4_SSL("imap.qq.com", 993, timeout=15)
        c.login(self._cfg["email"], self._cfg["auth_code"])
        return c

    # ---------- 生命周期 ----------
    async def connect(self) -> ConnectorStatus:
        try:
            s = self._smtp()
            s.quit()
            self._connected = True
            return ConnectorStatus(
                "connected",
                "SMTP 登录成功",
                ["send_email", "list_emails", "read_email", "search_emails"],
            )
        except Exception as e:
            self._connected = False
            return ConnectorStatus("error", "SMTP 登录失败：" + str(e)[:160])

    async def disconnect(self) -> None:
        self._connected = False

    async def health_check(self) -> ConnectorHealth:
        import time

        t0 = time.time()
        try:
            s = self._smtp()
            s.quit()
            return ConnectorHealth("ok", int((time.time() - t0) * 1000), "SMTP 可用")
        except Exception as e:
            return ConnectorHealth("error", int((time.time() - t0) * 1000), str(e)[:160])

    # ---------- 工具调用 ----------
    async def invoke_tool(self, tool: str, args: dict) -> ToolResult:
        try:
            if tool == "send_email":
                return await self._send_email(args)
            if tool == "list_emails":
                return await self._list_emails(args)
            if tool == "read_email":
                return await self._read_email(args)
            if tool == "search_emails":
                return await self._search_emails(args)
            return ToolResult(False, None, "未知工具：" + tool)
        except Exception as e:
            return ToolResult(False, None, str(e)[:200])

    async def _send_email(self, args: dict) -> ToolResult:
        to = args.get("to")
        if not to:
            return ToolResult(False, None, "缺少收件人 to")
        subject = args.get("subject", "")
        body = args.get("body", "")
        msg = MIMEMultipart()
        msg["From"] = self._cfg["email"]
        msg["To"] = to
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "html" if args.get("html") else "plain", "utf-8"))
        s = self._smtp()
        s.sendmail(self._cfg["email"], to, msg.as_string())
        s.quit()
        return ToolResult(True, {"to": to, "subject": subject}, None)

    async def _list_emails(self, args: dict) -> ToolResult:
        folder = args.get("folder", "INBOX")
        limit = int(args.get("limit", 10))
        unread_only = bool(args.get("unread_only"))
        c = self._imap()
        c.select(folder)
        typ, data = c.search(None, "UNSEEN" if unread_only else "ALL")
        ids = data[0].split() if data and data[0] else []
        ids = ids[-limit:][::-1]
        items = []
        for mid in ids:
            typ, d = c.fetch(mid, "(RFC822)")
            if not d or not d[0]:
                continue
            msg = email.message_from_bytes(d[0][1])
            items.append(
                {
                    "id": mid.decode(),
                    "subject": email.header.make_header(email.header.decode_header(msg["Subject"] or "")),
                    "from": msg.get("From", ""),
                    "date": msg.get("Date", ""),
                }
            )
        c.logout()
        return ToolResult(True, {"count": len(items), "emails": items}, None)

    async def _read_email(self, args: dict) -> ToolResult:
        mail_id = args.get("mail_id")
        if not mail_id:
            return ToolResult(False, None, "缺少 mail_id")
        c = self._imap()
        c.select("INBOX")
        typ, d = c.fetch(mail_id.encode(), "(RFC822)")
        if not d or not d[0]:
            c.logout()
            return ToolResult(False, None, "邮件不存在")
        msg = email.message_from_bytes(d[0][1])
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True).decode("utf-8", "ignore")
                    break
        else:
            body = msg.get_payload(decode=True).decode("utf-8", "ignore")
        c.logout()
        return ToolResult(True, {"subject": msg["Subject"], "from": msg.get("From"), "body": body[:4000]}, None)

    async def _search_emails(self, args: dict) -> ToolResult:
        keyword = args.get("keyword", "")
        c = self._imap()
        c.select("INBOX")
        typ, data = c.search(None, "ALL")
        ids = data[0].split() if data and data[0] else []
        hits = []
        for mid in ids[-50:][::-1]:
            typ, d = c.fetch(mid, "(RFC822)")
            if not d or not d[0]:
                continue
            msg = email.message_from_bytes(d[0][1])
            subj = msg["Subject"] or ""
            if keyword.lower() in subj.lower():
                hits.append({"id": mid.decode(), "subject": subj, "from": msg.get("From", "")})
            if len(hits) >= int(args.get("limit", 10)):
                break
        c.logout()
        return ToolResult(True, {"count": len(hits), "emails": hits}, None)
