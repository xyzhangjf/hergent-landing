#!/usr/bin/env python3
"""企微适配器补丁：**出站剥控制标记** + 流式占位（纯原生）—— v5, 2026-11-01。

背景（两个独立问题，一套补丁解决）
    【问题一·静默无反馈】
      Hermes 在 agent 跑工具期间会持续调用平台的 `send_typing()` 维持"正在处理"体感，
      但**企微适配器的 `send_typing()` 是空实现** ⇒ 老板发完消息要等 1~3 分钟才有第一条回复，
      中间零反馈（2026-09-27 老板报障）。v2/v3 已解决：用企微**原生流式消息**建占位、
      并让占位**跳动**起来；老板始终只看到一条消息。

    【v5·2026-11-01：撤掉我们自己那套动画】
      老板报障「三点动画有两个版本在上下跳动」。根因不是 bug 而是**两套动画叠加**：
        · 我们补丁每 0.9s 推一帧字符 `●··`→`·●·`→`··●` ⇒ 灰色，在气泡**正文**；
        · 企微客户端对「流式消息（finish=false）」本来就自带「AI 生成中」指示 ⇒ 彩色，在气泡**状态位**。
      两者节奏/位置都不同 ⇒ 视觉上就是一灰一彩上下跳。
      ⇒ v5：**位置彻底让给企微原生那套**，我们这边
        ① 占位内容改成**不可见字符**（U+200B 零宽空格）⇒ 气泡里没有任何自己的文案；
        ② 帧序列置空 ⇒ **不再做逐帧动画**，只按 `--anim-interval`（默认 60s）做**保活重推**
           （官方要求首帧后 10 分钟内 finish；长时间跑工具时靠它把流续上）；
        ③ 收口逻辑不变：finish=true 原位换成最终答案，聊天记录里仍只有一条。
      ⚠️ 想回退到「看得见的占位文案」只需一行：
           --placeholder '·' --anim-frames '·|··|···' --anim-interval 0.9

    【问题二·控制标记泄漏】
      我们的协议围栏（```card / ```cards / ```clarify / ```proposal / ```reminder 与裸 JSON）
      是「给前端看的控制信号」：网页端 `renderMd` 会剥掉它们再渲染。**IM 渠道不渲染任何围栏**
      ⇒ 会以**代码块原文**发给老板（2026-09-27 老板两次截图报障）。
      🔴 更深一层的原因（2026-09-27 取证）：**会话的 system_prompt 是创建时固化的**
      （存在 Hermes `state.db.sessions.system_prompt`，尾部带 `Conversation started: <日期>`），
      改 SOUL.md **只对之后新建的会话生效**。老板那条 09-11 建的长期会话里至今写着
      「纯文字回复写 {"show":[]}」⇒ 泄漏不是"模型偶发失误"，而是提示词从未换过。
      ⇒ **只有出站净化才拦得住**（不管模型为什么输出、也不管会话有没有固化）。

本补丁做四件事（幂等、可逆、带自检）
    A. 把 WeComAdapter 原有的 `send()` 改名为 `_hergent_orig_send()`（原实现一行未动）；
    B. 插入 `_hergent_strip_protocol()` —— 出站净化，剥 4 类控制标记（见下）；
    C. 插入 `send_typing()` / `_hergent_keepalive_loop()` / `_hergent_finish_stream()` 与新 `send()`
       —— 建流占位 + 保活 + 收口时**先净化再原位替换**占位；
    D. 全程异常兜底：净化/占位/保活失败**绝不影响主流程**。

出站净化的 4 类（保守设计，绝不误删正常内容）
    ① 完整围栏：五种协议名开头且有闭合 ⇒ 整段剥掉；
    ② 半截围栏：协议名已开头、闭合未到（流式/截断）⇒ 从标记处截断；
    ③ 无名/写错语言的围栏：**只有内容能解析成协议 JSON** 才剥（普通代码块原样保留）；
    ④ 尾部裸 JSON：仅当延伸到结尾且能解析成协议 JSON ⇒ 剥掉。
    协议 JSON 判据：含 `show`/`ask` 键，或 `type` 属已知卡片类型集合。
    每次净化都写日志（`出站剥掉控制标记 N 处`）⇒ **可用日志观测"模型是否还在输出围栏"**。

⚠️ 这是对 **Hermes 发行版代码**的补丁（`site-packages/plugins/platforms/wecom/adapter.py`）
   ⇒ **Hermes 升级会覆盖它**。故：脚本幂等、带备份、打完 `py_compile` 自检、
   提供 `--check`（供巡检；rc=0 表示 v5 在位）与 `--revert`。

用法
    python3 hermes_wecom_ack_patch.py --check                 # 只检查（巡检用；并打印当前模式）
    python3 hermes_wecom_ack_patch.py                         # 打补丁 / 从 v1~v5 升级到 v6（纯原生 + 帧校验）
    python3 hermes_wecom_ack_patch.py --revert                # 还原到最近一次备份
    # 想恢复"看得见的跳动占位"（v4 观感）：
    python3 hermes_wecom_ack_patch.py --placeholder '●··' --anim-frames '●··|·●·|··●' --anim-interval 0.9
"""
from __future__ import annotations

import argparse
import ast
import glob
import os
import py_compile
import re
import shutil
import sys
import time

MARK_V6 = "[HERGENT-PATCH wecom-ack-v6]"
MARK_V5 = "[HERGENT-PATCH wecom-ack-v5]"
MARK_V4 = "[HERGENT-PATCH wecom-ack-v4]"
MARK_V3 = "[HERGENT-PATCH wecom-ack-v3]"
MARK_V2 = "[HERGENT-PATCH wecom-ack-v2]"
MARK_V1 = "[HERGENT-PATCH wecom-ack]"

ADAPTER_CANDIDATES = [
    "/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages/plugins/platforms/wecom/adapter.py",
]

# 上游原始版：send_typing 是空实现
OLD_ORIG = '''    async def send_typing(self, chat_id: str, metadata=None) -> None:
        """WeCom does not expose typing indicators in this adapter."""
        del chat_id, metadata
'''

# v1 块（文本回执版）
V1_RE = re.compile(
    r'    async def send_typing\(self, chat_id: str, metadata=None\) -> None:\n'
    r'        """\[HERGENT-PATCH wecom-ack\][\s\S]*?'
    r'    def _hergent_ack_text\(\) -> str:\n[\s\S]*?return "[^"]*"\n',
    re.M)

# v2 / v3 / v4 块：从头部注释起，到「委托原实现」那句结束（升级与换风格都整块替换）
_FENCE_TAIL = r'            chat_id=chat_id, content=content, reply_to=reply_to, metadata=metadata\)\n'
V2_RE = re.compile(r'    # ─+\n    # \[HERGENT-PATCH wecom-ack-v2\][\s\S]*?' + _FENCE_TAIL, re.M)
V3_RE = re.compile(r'    # ─+\n    # \[HERGENT-PATCH wecom-ack-v3\][\s\S]*?' + _FENCE_TAIL, re.M)
V4_RE = re.compile(r'    # ─+\n    # \[HERGENT-PATCH wecom-ack-v4\][\s\S]*?' + _FENCE_TAIL, re.M)
V5_RE = re.compile(r'    # ─+\n    # \[HERGENT-PATCH wecom-ack-v5\][\s\S]*?' + _FENCE_TAIL, re.M)
V6_RE = re.compile(r'    # ─+\n    # \[HERGENT-PATCH wecom-ack-v6\][\s\S]*?' + _FENCE_TAIL, re.M)

# 被改名的原始 send()（断言只出现一次）
SEND_SIG = '''    async def send(
        self,
        chat_id: str,
        content: str,
'''
SEND_SIG_RENAMED = '''    async def _hergent_orig_send(
        self,
        chat_id: str,
        content: str,
'''

# ⚠️ 本模板用 **占位符替换**（不是 .format）—— 块内有大量字面花括号（字典/正则字面量），
#    用 .format 必须逐个双写，极易漏（漏一个就 ValueError）。占位符＝双下划线包裹的全大写名。
NEW_V6 = '''    # ─────────────────────────────────────────────────────────────
    # __MARK__ —— 企微「流式占位（纯原生）」+ **出站剥控制标记**（v6）
    # 官方协议：aibot_respond_msg + body.msgtype="stream"
    #   · 首帧 {{stream:{id, finish:false, content:占位}}} → 立刻出现一条占位消息
    #   · 同一 req_id + 同一 stream.id 再推 → **原位全量替换**（content 是全量，非增量）
    #   · finish:true → 结束；聊天记录里**只保留最终结果**
    # v3 相对 v2：占位由「静止」改为「跳动」（同一条流循环推 __FRAMES__）。
    # v4 相对 v3：**出站净化** —— 剥掉 card/cards/clarify/proposal/reminder 五种协议围栏
    #   与裸 JSON 控制标记。为什么必须在出站做：这些是「给前端看的控制信号」，网页端有
    #   renderMd 兜底剥掉，而 IM 渠道不渲染任何围栏 ⇒ 会以代码块原文发给用户；
    #   更关键的是**会话的 system_prompt 是创建时固化的**，改提示词管不到存量会话
    #   ⇒ 只有出站净化拦得住（2026-09-27 老板两次截图报障）。
    # 🔴 v5 相对 v4：**撤掉我们自己的动画**。v4 每 0.9s 推 `●··`→`·●·`→`··●`，而企微客户端
    #   对流式消息自带「AI 生成中」动效 ⇒ 一条气泡上出现一灰一彩、上下跳两个版本
    #   （2026-11-01 老板报障）。v5 改为：占位=不可见字符、帧序列为空（只保活重推）
    #   ⇒ 位置彻底让给企微原生那套。
    # 🔴 v6 相对 v5：**帧结果校验（errcode）**。`_send_reply_request()` 只在网络层抛错，
    #   服务端业务拒绝是"正常返回带 errcode" ⇒ 不查就会"发了但没显示"且日志全静。
    #   现在：首帧被拒 ⇒ 不建流（send() 自动退回普通发送）；收口被拒 ⇒ 返回 False 并退回
    #   普通发送（**绝不静默吞答案**）。占位内容换成不可见字符后这条尤其关键。
    # 详见 server/tools/hermes_wecom_ack_patch.py
    # ─────────────────────────────────────────────────────────────
    _HERGENT_PLACEHOLDER = "__PLACEHOLDER__"
    _HERGENT_ANIM_FRAMES = __FRAMES__
    _HERGENT_ANIM_INTERVAL = __INTERVAL__
    _HERGENT_ANIM_MAX_SEC = 540.0        # 官方要求首帧后 10 分钟内 finish ⇒ 保活到 9 分钟留余量
    _HERGENT_FENCE_NAMES = "cards|card|clarify|proposal|reminder"
    _HERGENT_PROTO_TYPES = ("forecast", "loss", "wastage", "payroll", "wage", "rebate",
                            "reconcile", "kpi", "commission", "expiry")

    def _hergent_is_proto_json(self, body) -> bool:
        """这段文本是不是「协议控制 JSON」—— 用来区分普通代码块，避免误删。"""
        try:
            o = json.loads(str(body or "").strip())
        except Exception:
            return False
        if not isinstance(o, dict):
            return False
        if "show" in o or "ask" in o:
            return True
        return str(o.get("type") or "").lower() in self._HERGENT_PROTO_TYPES

    def _hergent_strip_protocol(self, text):
        """出站净化：剥掉协议围栏与裸 JSON 控制标记。

        返回 (净化后文本, 剥掉处数, 类型清单)。**保守设计，绝不误删正常内容**：
          ① 完整围栏：协议名开头 + 有闭合 ⇒ 整段剥；
          ② 半截围栏：协议名开头、闭合未到 ⇒ 从标记处截断；
          ③ 无名/写错语言的围栏：只有内容能解析成协议 JSON 才剥（普通代码块保留）；
          ④ 尾部裸 JSON：仅当延伸到结尾且能解析成协议 JSON ⇒ 剥。
        """
        s = str(text or "")
        if not s:
            return s, 0, []
        kinds = []
        total = 0
        names = self._HERGENT_FENCE_NAMES
        # ① 完整围栏
        s, n = re.subn(r"```(?:%s)\\s*[\\s\\S]*?```" % names, "", s, flags=re.I)
        if n:
            total += n
            kinds.append("围栏%d处" % n)
        # ② 半截围栏（避免半截 JSON 闪现在正文）
        s, n = re.subn(r"```(?:%s)[\\s\\S]*$" % names, "", s, flags=re.I)
        if n:
            total += n
            kinds.append("半截围栏%d处" % n)
        # ③ 无名/写错语言的围栏：只有内容像协议 JSON 才剥
        seen = [0]

        def _drop(m):
            if self._hergent_is_proto_json(m.group(1)):
                seen[0] += 1
                return ""
            return m.group(0)
        s = re.sub(r"```[a-zA-Z0-9_-]*[ \\t]*\\n?([\\s\\S]*?)```", _drop, s)
        if seen[0]:
            total += seen[0]
            kinds.append("无名围栏%d处" % seen[0])
        # ④ 尾部裸 JSON（模型漏打围栏）
        tail = re.search(r'\\{\\s*"(?:show|ask|type)"\\s*:[\\s\\S]*$', s)
        if tail and self._hergent_is_proto_json(s[tail.start():]):
            s = s[:tail.start()]
            total += 1
            kinds.append("裸JSON1处")
        s = re.sub(r"\\n{3,}", "\\n\\n", s).strip()
        return s, total, kinds

    def _hergent_frame_ok(self, resp) -> bool:
        """流式帧是否被服务端**真的接受**（errcode 非 0 ⇒ 记日志并返回 False）。

        🔴 为什么必须有：`_send_reply_request()` 只在网络/超时层抛异常，
           **服务端业务拒绝是"正常返回带 errcode"** ⇒ 不检查就会"看起来发了、其实没显示"
           （占位气泡不出现，而日志一片安静 —— 2026-11-01 加 ZWSP 占位时补的护栏）。
        """
        if not isinstance(resp, dict):
            return True
        ec = resp.get("errcode", resp.get("code", 0))
        try:
            ok = int(ec) == 0
        except (TypeError, ValueError):
            ok = True
        if not ok:
            logger.warning("[%s]__MARK__ 流式帧被服务端拒绝 errcode=%s errmsg=%s",
                           self.name, ec, resp.get("errmsg") or resp.get("msg"))
        return ok

    async def _hergent_keepalive_loop(self, chat_id: str, sid: str, req_id: str) -> None:
        """保活：按固定间隔把同一条流重推一次，**视觉上什么都不改**。

        v5 起不再逐帧动画（动画交给企微客户端原生那套）。
          · `_HERGENT_ANIM_FRAMES` 为空（默认）⇒ 每轮重推占位内容（不可见字符），纯保活；
          · 非空 ⇒ 回退到 v4 的逐帧跳动（想恢复旧观感时用，见脚本 docstring）。
        为什么要保活：官方要求首帧后 10 分钟内 finish；agent 跑长工具链时不能让它超时。

        退出条件（任一）：已收口/换轮 · 跑满 _HERGENT_ANIM_MAX_SEC · 连续 3 次推失败。
        """
        st = getattr(self, "_hergent_streams", None) or {}
        t0 = asyncio.get_running_loop().time()
        i = 0
        fails = 0
        while True:
            try:
                await asyncio.sleep(self._HERGENT_ANIM_INTERVAL)
            except asyncio.CancelledError:
                return
            cur = st.get(chat_id)
            if not cur or cur.get("sid") != sid:
                return                          # 已收口 / 换轮 ⇒ 立刻退出
            if asyncio.get_running_loop().time() - t0 > self._HERGENT_ANIM_MAX_SEC:
                return
            frames = self._HERGENT_ANIM_FRAMES or ()
            if frames:
                i = (i + 1) % len(frames)
                frame = frames[i]
            else:
                frame = cur.get("placeholder") or self._HERGENT_PLACEHOLDER
            try:
                resp = await self._send_reply_request(req_id, {
                    "msgtype": "stream",
                    "stream": {"id": sid, "finish": False, "content": frame},
                })
                if not self._hergent_frame_ok(resp):
                    return                  # 服务端不认这条流 ⇒ 别再空转
                fails = 0
            except asyncio.CancelledError:
                return
            except Exception as exc:                                    # noqa: BLE001
                fails += 1
                logger.debug("[%s]__MARK__ 占位帧推送失败 %d/3：%s", self.name, fails, exc)
                if fails >= 3:
                    return

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        """建流式占位（每条入站消息只建一次），并启动保活循环。

        v5：占位内容是不可见字符 ⇒ 气泡里**没有我们自己的任何文案**，
        客户端只会显示它原生的「AI 生成中」动效。
        """
        del metadata
        if not chat_id:
            return
        try:
            req_id = self._last_chat_req_ids.get(chat_id) or ""
            if not req_id:
                return                      # 没有回调 req_id ⇒ 建不了流（理论上的异常路径）
            st = getattr(self, "_hergent_streams", None)
            if st is None:
                st = self._hergent_streams = {}
            cur = st.get(chat_id)
            if cur and cur.get("req_id") == req_id:
                return                      # 这一轮已有活跃占位，keep-typing 刷新不再建流
            if cur:
                # 上一轮残留（例如以图片/错误收尾）：先收掉，避免同 chat 叠多条流
                await self._hergent_finish_stream(
                    chat_id, cur, cur.get("placeholder") or self._HERGENT_PLACEHOLDER)
            sid = "hergent-" + uuid.uuid4().hex[:16]
            resp = await self._send_reply_request(req_id, {
                "msgtype": "stream",
                "stream": {"id": sid, "finish": False,
                           "content": self._HERGENT_PLACEHOLDER[:self.MAX_MESSAGE_LENGTH]},
            })
            if not self._hergent_frame_ok(resp):
                # 首帧被拒（例如占位内容被判定为空）⇒ **不记流**，让 send() 退回普通发送
                logger.warning("[%s]__MARK__ 首帧占位被拒 ⇒ 本轮不建流 chat=%s",
                               self.name, chat_id)
                return
            task = asyncio.create_task(self._hergent_keepalive_loop(chat_id, sid, req_id))
            st[chat_id] = {"sid": sid, "req_id": req_id, "task": task,
                           "at": asyncio.get_running_loop().time(),
                           "placeholder": self._HERGENT_PLACEHOLDER}
            logger.info("[%s]__MARK__ 已建流式占位（v5 纯原生，占位=%r，帧=%s）chat=%s",
                        self.name, self._HERGENT_PLACEHOLDER,
                        self._HERGENT_ANIM_FRAMES or "无(保活)", chat_id)
        except Exception as exc:                                    # noqa: BLE001
            logger.warning("[%s]__MARK__ 占位失败：%s", self.name, exc)

    async def _hergent_finish_stream(self, chat_id: str, cur: dict, content: str) -> bool:
        """用 finish=true 结束该 chat 的活跃流（content 为全量最终内容）。

        🔴 顺序要紧：**先摘记录 + 取消保活**，再发 finish 帧。
           反过来的话，保活可能在 finish 之后又补一帧 finish:false，把最终答案盖掉。
        🔴 返回是否**真的推成功**：失败必须让调用方退回普通发送，否则答案会被静默吞掉
           （流过期/req_id 失效时正是这条路径，2026-11-01 加固）。
        """
        st = getattr(self, "_hergent_streams", None)
        if st is not None:
            st.pop(chat_id, None)
        task = (cur or {}).get("task")
        if task is not None:
            try:
                task.cancel()
            except Exception:                                       # noqa: BLE001
                pass
        try:
            resp = await self._send_reply_request((cur or {}).get("req_id") or "", {
                "msgtype": "stream",
                "stream": {"id": (cur or {}).get("sid") or "", "finish": True,
                           "content": (content or "")[:self.MAX_MESSAGE_LENGTH]},
            })
            return self._hergent_frame_ok(resp)
        except Exception as exc:                                    # noqa: BLE001
            logger.warning("[%s]__MARK__ 结束占位失败：%s", self.name, exc)
            return False

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        """出站收口：**先剥控制标记**，再把最终答案原位替换掉占位。"""
        clean, stripped, kinds = self._hergent_strip_protocol(content)
        if stripped:
            logger.info("[%s]__MARK__ 出站剥掉控制标记 %d 处（%s）chat=%s",
                        self.name, stripped, "、".join(kinds), chat_id)
            content = clean
            if not (content or "").strip():
                logger.warning("[%s]__MARK__ 净化后正文为空（原文只有控制标记）chat=%s",
                               self.name, chat_id)
                content = "（本次回复没有正文）"
        st = getattr(self, "_hergent_streams", None) or {}
        cur = st.get(chat_id)
        if cur and (content or "").strip():
            if await self._hergent_finish_stream(chat_id, cur, content):
                logger.info("[%s]__MARK__ 占位已原位替换为最终答案 chat=%s", self.name, chat_id)
                return SendResult(success=True, message_id=str(cur.get("sid") or ""))
            # 🔴 原位收口失败（流过期 / req_id 失效）⇒ 必须退回普通发送，否则答案丢失
            logger.warning("[%s]__MARK__ 原位收口失败 ⇒ 退回普通发送以免吞答案 chat=%s",
                           self.name, chat_id)
        elif cur:
            await self._hergent_finish_stream(
                chat_id, cur, cur.get("placeholder") or self._HERGENT_PLACEHOLDER)
        return await self._hergent_orig_send(
            chat_id=chat_id, content=content, reply_to=reply_to, metadata=metadata)
'''


def find_adapter() -> str | None:
    for p in ADAPTER_CANDIDATES:
        if os.path.exists(p):
            return p
    hits = glob.glob("/usr/local/lib/hermes-agent/**/plugins/platforms/wecom/adapter.py", recursive=True)
    return hits[0] if hits else None


def status(txt: str) -> str:
    if MARK_V6 in txt:
        return "patched-v6"
    if MARK_V5 in txt:
        return "patched-v5"
    if MARK_V4 in txt:
        return "patched-v4"
    if MARK_V3 in txt:
        return "patched-v3"
    if MARK_V2 in txt:
        return "patched-v2"
    if MARK_V1 in txt:
        return "patched-v1"
    if OLD_ORIG in txt and SEND_SIG in txt:
        return "clean"
    return "unknown"


def _read_params(txt: str) -> dict:
    """读出文件里当前 v4 块的参数 —— 判断"这次到底要不要改"。

    🔴 幂等判据不能只看标记：标记在 ≠ 参数对。换风格时标记照旧、只有参数变了
      ⇒ 必须按参数比对，否则"换了没生效"且毫无提示（2026-09-27 老板换风格时暴露）。
    """
    def grab(pat, cast=None):
        m = re.search(pat, txt)
        if not m:
            return None
        v = m.group(1).strip()
        try:
            return cast(v) if cast else v
        except (TypeError, ValueError):
            return None
    return {
        "frames": grab(r"_HERGENT_ANIM_FRAMES = (.+)"),
        "placeholder": grab(r'_HERGENT_PLACEHOLDER = "(.*?)"'),
        "interval": grab(r"_HERGENT_ANIM_INTERVAL = ([0-9.]+)", float),
    }


def _show_ph(s) -> str:
    r"""把源码里的占位字面量转成人能看懂的形式（`\u200b` → 零宽空格）。"""
    if s is None:
        return "?"
    try:
        v = ast.literal_eval('"%s"' % s)
    except Exception:                                               # noqa: BLE001
        return repr(s)
    if v == "\u200b":
        return "零宽空格(U+200B，不可见)"
    return repr(v)


def _write(path: str, out: str, label: str) -> int:
    """备份 → 写盘 → `py_compile` 自检（失败即回滚）。"""
    bak = "%s.bak-hergent-%s" % (path, time.strftime("%Y%m%d_%H%M%S"))
    shutil.copy2(path, bak)
    open(path, "w", encoding="utf-8").write(out)
    try:
        py_compile.compile(path, doraise=True)
    except Exception as e:                                          # noqa: BLE001
        shutil.copy2(bak, path)
        print("❌ 语法校验失败，已回滚：%s" % e)
        return 4
    st2 = status(open(path, encoding="utf-8").read())
    print("   ⇒ 已写入 %s（备份 %s）" % (label, bak))
    print("   ⇒ 语法校验通过；状态=%s" % st2)
    print("   ⚠️ 需重启该 Hermes 网关才会生效")
    return 0 if st2 == "patched-v6" else 5


def _build_block(placeholder: str, frames, interval: float) -> str:
    """用**占位符替换**生成新块（块内字面花括号无需转义）。"""
    return (NEW_V6
            .replace("__MARK__", MARK_V6)
            .replace("__PLACEHOLDER__", placeholder)
            .replace("__FRAMES__", repr(tuple(frames)))
            .replace("__INTERVAL__", str(interval)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查补丁状态（巡检用）")
    ap.add_argument("--revert", action="store_true", help="还原到最近一次备份")
    ap.add_argument("--placeholder", default="\\u200b",
                    help="首帧占位内容（默认 \\u200b 零宽空格＝不可见；写 \\uXXXX 会按 Python 转义生效）")
    ap.add_argument("--anim-frames", default="",
                    help="逐帧动画序列，用 | 分隔；**留空＝不做动画**（默认，只保活重推）")
    ap.add_argument("--anim-interval", type=float, default=60.0,
                    help="重推间隔秒数（默认 60；帧为空时它就是保活心跳，别超过 300）")
    ap.add_argument("--path", default=None, help="指定适配器路径（离线自测用）")
    a = ap.parse_args()

    path = a.path or find_adapter()
    if not path:
        print("❌ 找不到企微适配器 adapter.py")
        return 2
    txt = open(path, encoding="utf-8").read()
    st = status(txt)
    print("   适配器：%s" % path)
    print("   当前状态：%s" % st)

    if a.check:
        good = st == "patched-v6"
        extra = ""
        if good:
            p = _read_params(txt)
            frames = p.get("frames")
            mode = ("纯原生（帧为空 ⇒ 只保活 %ss 一次）" % p.get("interval")) \
                if frames in ("()", "", None) else ("逐帧动画 %s / %ss" % (frames, p.get("interval")))
            extra = "｜出站净化=%s｜占位=%s｜模式=%s" % (
                "在" if "_hergent_strip_protocol" in txt else "**缺**",
                _show_ph(p.get("placeholder")), mode)
        print("   ⇒ %s%s" % ("补丁在位（v6：流式占位纯原生 + 出站剥控制标记 + 帧结果校验）✅" if good else
                            "**需要处理**（被 Hermes 升级覆盖，或仍是 v1~v5）", extra))
        return 0 if good else 1

    if a.revert:
        baks = sorted(glob.glob(path + ".bak-hergent-*"))
        if not baks:
            print("❌ 没有备份可还原")
            return 2
        shutil.copy2(baks[-1], path)
        print("   ⇒ 已还原自 %s" % baks[-1])
        return 0

    frames = tuple(x.strip() for x in (a.anim_frames or "").split("|") if x.strip())
    if not frames:
        print("   ⇒ 帧序列为空 ⇒ **不做逐帧动画**（只用企微客户端原生动效，本补丁仅保活）")
    new_block = _build_block(a.placeholder, frames, a.anim_interval)

    if st == "patched-v6":
        # 🔴 幂等判据 = **参数比对**，不是"看到标记就跳过"（否则换风格不生效且无提示）
        cur = _read_params(txt)
        want = {"frames": repr(frames), "placeholder": a.placeholder,
                "interval": a.anim_interval}
        if cur == want:
            print("   ⇒ 已是 v6 且参数一致，无需改动（幂等）")
            return 0
        hits = list(V6_RE.finditer(txt))
        assert len(hits) == 1, "已标 v6 但块定位到 %d 处，拒绝改" % len(hits)
        out = txt[:hits[0].start()] + new_block + txt[hits[0].end():]
        assert out.count(SEND_SIG_RENAMED) == 1, \
            "改名后的原 send 应恰好 1 次（实际 %d）" % out.count(SEND_SIG_RENAMED)
        print("   ⇒ 参数有变 ⇒ **按新参数重写该块**")
        print("      旧：%s" % cur)
        print("      新：%s" % want)
        return _write(path, out, "v6（换参数）")

    if st in ("patched-v2", "patched-v3", "patched-v4", "patched-v5"):
        rx = {"patched-v2": V2_RE, "patched-v3": V3_RE,
              "patched-v4": V4_RE, "patched-v5": V5_RE}[st]
        hits = list(rx.finditer(txt))
        assert len(hits) == 1, "%s 块定位到 %d 处，拒绝改" % (st, len(hits))
        out = txt[:hits[0].start()] + new_block + txt[hits[0].end():]
        assert out.count(SEND_SIG_RENAMED) == 1, \
            "改名后的原 send 应恰好 1 次（实际 %d）" % out.count(SEND_SIG_RENAMED)
        print("   ⇒ %s → v6（纯原生占位 + 帧结果校验）" % st)
        return _write(path, out, "v6（从 %s 升级）" % st)

    if st not in ("clean", "patched-v1"):
        print("❌ 源文件形态与预期不符（可能已被上游改动）⇒ 拒绝自动打补丁，请人工查看")
        return 3

    out = txt
    # 🔴 顺序要紧：**先给原有 send() 改名**，再插新块。
    #    反过来的话，新块里的 `async def send(...)` 也会被这条断言数进去（=2），误判为"形态不符"。
    assert out.count(SEND_SIG) == 1, "send() 签名出现 %d 次，拒绝改" % out.count(SEND_SIG)
    out = out.replace(SEND_SIG, SEND_SIG_RENAMED, 1)
    if st == "clean":
        assert out.count(OLD_ORIG) == 1, "send_typing 原始块出现 %d 次，拒绝改" % out.count(OLD_ORIG)
        out = out.replace(OLD_ORIG, new_block, 1)
    else:
        hits = list(V1_RE.finditer(out))
        assert len(hits) == 1, "v1 块定位到 %d 处，拒绝改" % len(hits)
        out = out[:hits[0].start()] + new_block + out[hits[0].end():]

    print("   ⇒ 从 %s 升级到 v6；帧序列=%s 间隔=%ss 首帧=%r"
          % (st, list(frames) or "无(仅保活)", a.anim_interval, a.placeholder))
    return _write(path, out, "v6（从 %s 升级）" % st)


if __name__ == "__main__":
    sys.exit(main())
