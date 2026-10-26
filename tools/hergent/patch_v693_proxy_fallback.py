#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v693 补丁（二）：copilot_proxy.py —— 降级路径不再漏账

背景：`_fallback_stream`（Hermes 不可用时走本仓 hermes_core）不回 usage，
      原代码只在日志里写一句「本次消耗未计入 token 账」就过去了。
      漏账的后果是客户白用、我们成本无人看见 —— 宁可估错，不可漏账。

做法：
  - `_fallback_stream` 多接一个 `stat` 列表，把实际吐出的字符数带出来；
  - 新增 `_persist_fallback`：按中文约 1.5 字符/token 估，
    标 `source='fallback_est'`（与真实计量的行可区分）；
  - `gen()` 的 finally 分流：有真 usage 走原路，否则有降级流量就走估算。

幂等 + 锚点唯一校验 + 备份 + py_compile，与 patch_v693_cost_credits.py 同一范式。
"""
import sys
import shutil
import py_compile
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/copilot_proxy.py")
MARK = "v693-fallback-metered"

# 补丁 1：在 _persist_usage 之后插入 _persist_fallback（锚点是它的结尾 + 下一个 def）
P1_OLD = '''    except Exception as e:  # noqa: BLE001
        log.warning("[copilot-proxy] 计量失败（已忽略，不影响对话）：%s", e)


def _fallback_stream(final_messages):'''

P1_NEW = '''    except Exception as e:  # noqa: BLE001
        log.warning("[copilot-proxy] 计量失败（已忽略，不影响对话）：%s", e)


def _persist_fallback(tid, user, model, messages, out_chars):
    """降级路径（自托管 hermes_core）按字符估 token 入账。

    🔴 为什么必须记：降级是**真的花了钱**（备用模型同样调 DeepSeek）。
    原实现只打一句「未计入 token 账」就过去了 ⇒ 客户白用、成本无人看见。
    宁可估错也不漏账 —— 估算值用 `source='fallback_est'` 明确标记，
    统计时能与真实计量的行分开看。

    估算口径：中文约 1.5 字符 / token（由 system_prompt 18,477 字符
    ≈ 8,000 token 的实测反推，误差在可接受范围）。
    """
    try:
        in_chars = 0
        for m in (messages or []):
            c = m.get("content") if isinstance(m, dict) else ""
            if isinstance(c, str):
                in_chars += len(c)
        p_est = max(1, int(in_chars / 1.5))
        c_est = max(1, int((out_chars or 0) / 1.5))
        from routers.ai_assist import _record_tokens
        ok = _record_tokens(tid, user, model, p_est, c_est,
                            kind="chat", source="fallback_est")
        log.warning("[copilot-proxy] 降级路径已估算入账 tenant=%s 估prompt=%s "
                    "估completion=%s 落库=%s", tid, p_est, c_est, ok)
    except Exception as e:  # noqa: BLE001
        log.warning("[copilot-proxy] 降级计费失败（已忽略，不影响对话）：%s", e)


def _fallback_stream(final_messages):'''

# 补丁 2：_fallback_stream 加 stat 参数
P2_OLD = '''def _fallback_stream(final_messages):
    """L2 自托管兜底：主模型不可用时走本仓 `hermes_core`（DeepSeek agent loop）。

    🔴 不静默降级：先前置一句说明，让用户知道用的是备用模型。
    复用 H3 的 `stream_chunks_for`（按句切片）来逐块输出。
    """
    yield _sse("（Hermes 不可用，已切换备用模型）\\n\\n")'''

P2_NEW = '''def _fallback_stream(final_messages, stat=None):
    """L2 自托管兜底：主模型不可用时走本仓 `hermes_core`（DeepSeek agent loop）。

    🔴 不静默降级：先前置一句说明，让用户知道用的是备用模型。
    复用 H3 的 `stream_chunks_for`（按句切片）来逐块输出。

    v693：`stat` 是个 list，用来把「实际吐出的字符数」带出去 ——
    降级路径不回 usage，但**这次消耗是真发生的**。不带出去就只能漏账。
    """
    if stat is None:
        stat = [0]
    yield _sse("（Hermes 不可用，已切换备用模型）\\n\\n")'''

# 补丁 3：统计吐出字符
P3_OLD = '''        for piece in stream_chunks_for(q):
            got = True
            yield _sse(piece)'''

P3_NEW = '''        for piece in stream_chunks_for(q):
            got = True
            stat[0] += len(piece or "")
            yield _sse(piece)'''

P4_OLD = '''    def gen():
        tap = _UsageTap()
        try:
            for chunk in _iter_upstream(payload, up.get("url"), up.get("key")):
                # 先解析、再原样吐：解析是微秒级且内部全吞异常，不推迟也不改变字节；
                # 反过来（先 yield）一旦客户端提前断开，这次真花掉的 token 就记不上账。
                tap.feed(chunk)
                yield chunk
        except Exception as e:  # noqa: BLE001
            log.warning("[copilot-proxy] Hermes 不可用，降级自托管：%s", e)
            log.warning("[copilot-proxy] 降级路径不回 usage ⇒ 本次消耗**未计入 token 账**，"
                        "备用模型的成本需靠 llm_call_log 事后核对")
            for chunk in _fallback_stream(final_messages):
                tap.feed(chunk)   # 降级流里没有 usage，走同一路径只为统一出口
                yield chunk
        finally:
            # 正常结束 / 上游异常 / 客户端断开 —— 统一记账（有 usage 才落行）
            _persist_usage(_meter_tid, _meter_user, model, tap)'''

P4_NEW = '''    def gen():
        tap = _UsageTap()
        _fb_out = [0]        # 降级路径实际吐出的字符数（用于估算入账）
        try:
            for chunk in _iter_upstream(payload, up.get("url"), up.get("key")):
                # 先解析、再原样吐：解析是微秒级且内部全吞异常，不推迟也不改变字节；
                # 反过来（先 yield）一旦客户端提前断开，这次真花掉的 token 就记不上账。
                tap.feed(chunk)
                yield chunk
        except Exception as e:  # noqa: BLE001
            log.warning("[copilot-proxy] Hermes 不可用，降级自托管：%s", e)
            for chunk in _fallback_stream(final_messages, _fb_out):
                tap.feed(chunk)   # 降级流里没有 usage，走同一路径只为统一出口
                yield chunk
        finally:
            # 正常结束 / 上游异常 / 客户端断开 —— 统一记账。
            # v693：降级路径上游不给 usage，但钱是真花了 ⇒ 走估算入账，不漏账。
            if getattr(tap, "usage", None) is None and _fb_out[0] > 0:
                _persist_fallback(_meter_tid, _meter_user, model,
                                  final_messages, _fb_out[0])
            else:
                _persist_usage(_meter_tid, _meter_user, model, tap)'''

P5_OLD = '''        log.info("[copilot-proxy] 计量 tenant=%s prompt=%s completion=%s blocks=%s 落库=%s",
                 tid, u.get("prompt_tokens"), u.get("completion_tokens"),
                 getattr(tap, "seen", 0), ok)'''

P5_NEW = '''        # v693：日志带上成本与峰谷，线上可直接对照（不必再翻 Hermes 账本）
        try:
            from routers.ai_assist import estimate_cost_cny, credits_of
            _c, _hit, _peak = estimate_cost_cny(u.get("prompt_tokens"),
                                                u.get("completion_tokens"))
            _extra = " cost=¥%s credits=%s hit=%s peak=%s" % (
                round(_c, 6), credits_of(_c), _hit, 1 if _peak else 0)
        except Exception:  # noqa: BLE001
            _extra = ""
        log.info("[copilot-proxy] 计量 tenant=%s prompt=%s completion=%s blocks=%s 落库=%s%s",
                 tid, u.get("prompt_tokens"), u.get("completion_tokens"),
                 getattr(tap, "seen", 0), ok, _extra)'''

PATCHES = [
    ("01-persist-fallback", P1_OLD, P1_NEW),
    ("02-fallback-stat-param", P2_OLD, P2_NEW),
    ("03-fallback-count-chars", P3_OLD, P3_NEW),
    ("04-gen-finally-branch", P4_OLD, P4_NEW),
    ("05-log-cost", P5_OLD, P5_NEW),
]


def main() -> int:
    dry = "--dry-run" in sys.argv
    target = DEFAULT_TARGET
    for a in sys.argv[1:]:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    if not target.exists():
        print("目标文件不存在：%s" % target)
        return 2

    src = target.read_text(encoding="utf-8")
    if MARK in src:
        print("已是 v693-fallback（标记存在），无需重复打补丁。")
        return 0

    problems = []
    for name, old, _new in PATCHES:
        n = src.count(old)
        if n != 1:
            problems.append("  %-24s 命中 %d 次（必须 1 次）" % (name, n))
    if problems:
        print("锚点校验失败，未做任何修改：")
        print("\n".join(problems))
        return 3

    out = src
    for name, old, new in PATCHES:
        out = out.replace(old, new, 1)
        print("  ✓ %s" % name)

    out = out.replace(
        "class _UsageTap:\n",
        "# patch-marker: %s（降级路径估算入账，不漏账）\n\nclass _UsageTap:\n" % MARK,
        1,
    )

    if dry:
        print("\n[dry-run] 未写盘 %d → %d 字节" % (len(src), len(out)))
        return 0

    backup = target.with_suffix(target.suffix + ".bak-v693")
    if not backup.exists():
        shutil.copy2(target, backup)
        print("已备份 → %s" % backup)

    tmp = target.with_suffix(".v693.tmp")
    tmp.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(tmp), doraise=True)
    except py_compile.PyCompileError as e:
        tmp.unlink(missing_ok=True)
        print("语法校验失败，未替换：%s" % e)
        return 4
    shutil.move(str(tmp), str(target))
    print("\n已写入 %s（%d → %d 字节）" % (target, len(src), len(out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
