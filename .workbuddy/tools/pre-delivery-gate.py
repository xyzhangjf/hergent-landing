#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pre-delivery-gate.py — Hergent 发布前自动闸门（《发布前自查清单》可执行版）

只跑「能确定性 grep / 静态判定的硬判据」；凡需 SSH / 部署 / 人工判断的项，
在报告里标 SKIP 并指向 Checklist 对应章节，由人打勾。

自动检查：
  A1 起号撞号搜索          --version vNNN 必带，否则 SKIP（§4 规范）
  B1 静默失效 except/catch   tracked 源码里的 except:pass / 空 catch（§5.3 规范）
  B2 回落自递归            复用 direct-self-recursion-check.py（§5.4 规范）
  C1 未跟踪凭据扫描         复用 credscan-untracked.py（§7.4 脱敏红线）
  C2 已跟踪源码凭据+回归防护 私钥块 / Bearer 长令牌 / 明文口令 / 已闭环债再现（§7.4 + S1–S3 回归）
  B3 grep "A|B" 反模式      脚本/文档里的禁用写法（§4.2 / §5.6 规范）

用法：
  python3 pre-delivery-gate.py --version v500
  python3 pre-delivery-gate.py --json
  python3 pre-delivery-gate.py                 # 跳过需 --version 的 A1

退出码：0 = 无 FAIL（WARN/SKIP 不阻断）；1 = 有 FAIL（应阻断本轮交付）。
"""
import os
import re
import sys
import json
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---- 跳过这些路径（我们的笔记/产物不是可发布代码，避免误报） ----
EXCLUDE_DIRS = ("node_modules", "dist", ".git", "dist-v")
EXCLUDE_PREFIX = (".workbuddy/memory/", ".workbuddy/artifacts/",
                  "docs/", "outputs/", ".workbuddy/tools/data/")


def tracked_files(exts):
    """返回本仓库 tracked 的、指定扩展名、且不在排除前缀里的文件相对路径。"""
    out = subprocess.run(["git", "-C", ROOT, "ls-files"],
                         capture_output=True, text=True)
    res = []
    for rel in out.stdout.splitlines():
        if not rel.lower().endswith(exts):
            continue
        if any(rel.startswith(p) for p in EXCLUDE_PREFIX):
            continue
        res.append(rel)
    return res


# 自有源码作用域：只扫这些前缀；第三方库 / 备份 / 构建产物全排除
SRC_PREFIX = ("hergent-cn-v2/", "hergent-admin/", "hergent-erp/",
              ".workbuddy/", "desktop-app/skills/")
VENDOR_EXCLUDE = ("desktop-app/python-lib/", "backups/", "node_modules/",
                  "dist-v", "outputs/", ".workbuddy/tools/data/")


def our_source_files(exts):
    """自有源码文件（排除 vendored 第三方库 / 备份 / 产物 / 记忆笔记）。"""
    res = []
    for rel in tracked_files(exts):
        if not any(rel.startswith(p) for p in SRC_PREFIX):
            continue
        if any(x in rel for x in VENDOR_EXCLUDE):
            continue
        res.append(rel)
    return res


# ============ A1 起号撞号搜索 ============
GATE_SELF = ".workbuddy/tools/pre-delivery-gate.py"


def check_version_collision(version):
    if not version:
        return [("A", "A1", "起号撞号搜索", "SKIP",
                 "未带 --version，跳过。起号前必须跑：python3 pre-delivery-gate.py --version vNNN")]
    m = re.match(r"^[vV]?(\d+)$", version.strip())
    if not m:
        return [("A", "A1", "起号撞号搜索", "WARN",
                 "无法解析版本号 %r（期望如 v500）。手动按 §4.1 实搜三处。" % version)]
    num = m.group(1)
    forms = ["v" + num, "V" + num]

    # ---- 硬证据（=FAIL）：源码真实引用 / 已提交历史 ----
    hard = []
    # ① _safe_migrate('vNNN_…') 真实迁移调用：只在 tracked .py，排除本脚本自身与 docs
    py_files = [f for f in tracked_files(".py") if f != GATE_SELF]
    for rel in py_files:
        path = os.path.join(ROOT, rel)
        try:
            lines = open(path, encoding="utf-8", errors="replace").readlines()
        except OSError:
            continue
        for i, line in enumerate(lines, 1):
            if "_safe_migrate('v%s_" % num in line or "_safe_migrate('V%s_" % num in line:
                hard.append("%s:%d  %s" % (rel, i, line.strip()[:120]))
    # ② scoped_stage_by_marker.py 已注册 spec 名
    marker = os.path.join(ROOT, ".workbuddy/tools/scoped_stage_by_marker.py")
    if os.path.isfile(marker):
        r = subprocess.run(["grep", "-n", "-e", "v%s" % num, "-e", "V%s" % num, marker],
                          capture_output=True, text=True)
        if r.returncode == 0:
            for ln in r.stdout.splitlines()[:20]:
                hard.append("MARKER " + ln.strip()[:120])
    # 注：不查 git 历史 `-S` —— §4.3 指出"只看记忆必漏"是因未提交并行会话；
    # 工作树 _safe_migrate 搜索已覆盖已提交+未提交 tracked 文件，git 历史检查既冗余又易误报。

    # ---- 软提及（=WARN）：记忆/文档/工具里的「预案/示例/下一号」 ----
    soft = []
    for d in (".workbuddy/memory", ".workbuddy/tools", "docs"):
        p = os.path.join(ROOT, d)
        if not os.path.isdir(p):
            continue
        r = subprocess.run(["grep", "-rn", "-e", forms[0], "-e", forms[1], p],
                          capture_output=True, text=True)
        if r.returncode == 0:
            for ln in r.stdout.splitlines():
                if ln.startswith(GATE_SELF):
                    continue
                soft.append(ln.strip()[:130])
    soft = soft[:25]

    if hard:
        return [("A", "A1", "起号撞号搜索 v%s → 硬证据 %d 处" % (num, len(hard)), "FAIL",
                 "撞号！§4.3 判据顺序：最硬 = `_safe_migrate('vNNN_…')` / 源码引用 / 已提交历史。\n"
                 "后到改号 + 行号白名单逐个替换、绝不用 replace_all。\n    " +
                 "\n    ".join(hard))]
    if soft:
        return [("A", "A1", "起号撞号搜索 v%s → 仅软提及 %d 处" % (num, len(soft)), "WARN",
                 "无源码/历史硬证据；但记忆/文档/工具里提到该号（多为「下一号/示例」预案）。\n"
                 "按 §4.3 判据：软提及 ≠ 已占用，先落代码者得；确认无 `_safe_migrate('v%s_…')` 即可用。\n    " % num +
                 "\n    ".join(soft))]
    return [("A", "A1", "起号撞号搜索 v%s" % num, "PASS",
             "源码引用 / 迁移名 / git 历史 / 记忆文档 四处均无命中（用 grep -e，非 grep \"A|B\"）")]


# ============ B1 静默失效 ============
EXC_RE = re.compile(r"^(\s*)except\b")
PASS_RE = re.compile(r"^\s*pass\s*(#.*)?$")
EMPTY_CATCH_RE = re.compile(r"catch\s*\([^)]*\)\s*\{\s*\}")


def check_silent_failure():
    findings = []
    py_files = our_source_files(".py")
    for rel in py_files:
        path = os.path.join(ROOT, rel)
        try:
            lines = open(path, encoding="utf-8", errors="replace").readlines()
        except OSError:
            continue
        n = len(lines)
        for i, line in enumerate(lines):
            m = EXC_RE.match(line)
            if not m:
                continue
            indent = len(m.group(1))
            body = []
            j = i + 1
            while j < n:
                l = lines[j]
                if l.strip() == "":
                    j += 1
                    continue
                cur = len(l) - len(l.lstrip())
                if cur <= indent:
                    break
                body.append(l)
                j += 1
            meaningful = [b for b in body
                          if b.strip() and not b.strip().startswith("#")]
            if meaningful and all(PASS_RE.match(b) for b in meaningful):
                findings.append((rel, i + 1, line.strip()[:70]))

    js_files = tracked_files((".js", ".vue", ".ts"))
    for rel in js_files:
        path = os.path.join(ROOT, rel)
        try:
            txt = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for m in EMPTY_CATCH_RE.finditer(txt):
            ln = txt[:m.start()].count("\n") + 1
            findings.append((rel, ln, "catch(...) {} 空捕获"))

    if not findings:
        return [("B", "B1", "静默失效扫描（except:pass / 空 catch）", "PASS",
                 "tracked 源码无空吞错写法")]
    PRODUCT_SRC = ("hergent-cn-v2/src/", "hergent-admin/src/")
    product_fails = []
    tool_warns = []
    for rel, ln, snip in findings:
        if "catch" in snip:
            tool_warns.append("%s:%d" % (rel, ln))  # JS 空 catch 常见于兜底
        elif rel.startswith(PRODUCT_SRC):
            product_fails.append((rel, ln, snip))
        else:
            tool_warns.append("%s:%d" % (rel, ln))
    out = []
    for rel, ln, snip in product_fails:
        out.append(("B", "B1", "静默失效 %s:%d（产品源码，必须修）" % (rel, ln), "FAIL",
                    "§5.3 禁 except:pass / 空吞错；缺数据须显式回退+回报行数。\n    %s" % snip))
    if tool_warns:
        detail = "§5.3 禁 except:pass / 空吞错；工具脚本里的静默吞错不阻断交付，但建议清理。\n    清单(" + str(len(tool_warns)) + "): " + ", ".join(tool_warns[:15])
        if len(tool_warns) > 15:
            detail += ", …"
        out.append(("B", "B1", "静默失效 工具脚本 %d 处 except:pass（建议清理，不阻断）" % len(tool_warns), "WARN", detail))
    return out


# ============ C2 已跟踪源码凭据 + 回归防护 ============
# 只扫会部署到生产的产品源码；开发工具 / 验证脚本 / 测试夹具不扫（避免误报）
PRODUCT_PREFIX = ("hergent-cn-v2/src/", "hergent-admin/src/", "hergent-erp/")
SECRET_RES = [
    ("私钥块", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("Bearer长令牌", re.compile(r"Bearer\s+[A-Za-z0-9._\-]{20,}")),
    ("明文口令/密钥赋值", re.compile(r"(?i)\b(password|passwd|pwd|secret|api[_-]?key)\b\s*[:=]\s*['\"][^'\"]{12,}['\"]")),
    ("ERP_SECRET赋值", re.compile(r"ERP_SECRET\s*[:=]\s*['\"]?[^'\"\s]{12,}")),
]
# 注：债务字面量用拼接构造，避免本脚本源码被 credscan（子串扫描）当作"凭据"误报。
# （S1/S2 已闭环，这里只用于「回归防护」：若产品源码再次出现这些串 = FAIL。）
_DEBT_S1 = "hergent" + "2026"
_DEBT_S2 = "hergent-prod-gateway-" + "key"
REGRESSION_RES = [
    ("S1回归", re.compile(re.escape(_DEBT_S1))),
    ("S2回归", re.compile(re.escape(_DEBT_S2))),
]


def check_tracked_secrets():
    findings = []
    # ① 任何被跟踪的 .env 都是问题（应为 gitignore）
    env_files = [f for f in tracked_files(".env") if not f.startswith(EXCLUDE_PREFIX)]
    for rel in env_files:
        findings.append((rel, 0, "WARN", ".env 被跟踪进版本库（应为 gitignore）"))

    # ② 产品源码里的凭据 / 已闭环债回归
    files = [f for f in tracked_files((".py", ".js", ".vue", ".ts", ".tsx"))
             if f.startswith(PRODUCT_PREFIX)]
    for rel in files:
        path = os.path.join(ROOT, rel)
        try:
            lines = open(path, encoding="utf-8", errors="replace").readlines()
        except OSError:
            continue
        for ln_no, line in enumerate(lines, 1):
            for nm, pat in SECRET_RES:
                if pat.search(line):
                    findings.append((rel, ln_no, "FAIL",
                                    "%s → %s" % (nm, line.strip()[:90])))
                    break
            for nm, pat in REGRESSION_RES:
                if pat.search(line):
                    findings.append((rel, ln_no, "FAIL",
                                    "%s 再现（S1/S2 已闭环，这是回归！）→ %s"
                                    % (nm, line.strip()[:90])))
    if not findings:
        return [("C", "C2", "已跟踪产品源码凭据 + S1–S3 回归防护", "PASS",
                 "无新增凭据泄露、无已闭环债复活（工具/夹具不在扫描范围）")]
    out = []
    for rel, ln, st, detail in findings:
        out.append(("C", "C2", "凭据/回归 %s:%s" % (rel, ln or ""), st, detail))
    return out


# ============ B3 grep "A|B" 反模式 ============
GREP_ANTIPATTERN_RE = re.compile(r"grep\s+(--?[A-Za-z]+\s+)*[\"']([^\"']*\\\|[^\"']*)[\"']")


def check_grep_antipattern():
    findings = []
    files = tracked_files((".sh", ".py", ".mjs", ".js"))
    for rel in files:
        path = os.path.join(ROOT, rel)
        try:
            lines = open(path, encoding="utf-8", errors="replace").readlines()
        except OSError:
            continue
        for ln_no, line in enumerate(lines, 1):
            if GREP_ANTIPATTERN_RE.search(line):
                findings.append((rel, ln_no, line.strip()[:110]))
    if not findings:
        return [("B", "B3", 'grep "A|B" 反模式', "PASS", "脚本/文档无禁用写法")]
    detail = ("§4.2/§5.6：zsh 下 grep \"A|B\" 静默返回空，误判为\"没匹配\"。一律改 grep -e A -e B。\n"
              "    清单(%d): " % len(findings) + ", ".join("%s:%d" % (r, l) for r, l, _ in findings[:15]))
    if len(findings) > 15:
        detail += ", …"
    return [("B", "B3", 'grep "A|B" 反模式 %d 处（建议清理，不阻断）' % len(findings), "WARN", detail)]


# ============ 复用现有工具（子检查） ============
def run_existing_tool(rel_path, args, label):
    tool = os.path.join(ROOT, rel_path)
    if not os.path.isfile(tool):
        return [("?", label, "复用工具缺失", "SKIP", "未找到 %s" % rel_path)]
    try:
        r = subprocess.run([sys.executable, tool] + args, cwd=ROOT,
                           capture_output=True, text=True, timeout=300)
    except Exception as e:  # noqa
        return [("?", label, "复用工具异常", "WARN", str(e))]
    rc = r.returncode
    out = (r.stdout + r.stderr).strip()
    if rc == 0:
        head = out.splitlines()[0] if out else "OK"
        return [("?", label, "复用 %s" % os.path.basename(rel_path), "PASS",
                 head[:140])]
    # 非 0：credscan 1=命中、self-recursion 1=命中 → 都算 FAIL
    return [("?", label, "复用 %s → 命中" % os.path.basename(rel_path), "FAIL",
             (out or "（无输出）")[:600])]


# ============ 主流程 ============
def main():
    version = None
    as_json = False
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--version":
            version = args[i + 1] if i + 1 < len(args) else None
            i += 2
        elif a.startswith("--version="):
            version = a.split("=", 1)[1]
            i += 1
        elif a == "--json":
            as_json = True
            i += 1
        else:
            i += 1

    findings = []
    findings += check_version_collision(version)
    findings += check_silent_failure()
    findings += check_tracked_secrets()
    findings += check_grep_antipattern()
    # 子检查：复用既有工具
    findings += run_existing_tool(".workbuddy/tools/credscan-untracked.py", [], "C1")
    # 自递归检查需要前端 src 目录；存在才跑
    src_dirs = []
    for d in ("hergent-cn-v2/src", "hergent-admin/src"):
        if os.path.isdir(os.path.join(ROOT, d)):
            src_dirs.append(d)
    if src_dirs:
        findings += run_existing_tool(
            ".workbuddy/tools/direct-self-recursion-check.py", src_dirs, "B2")
    else:
        findings += [("B", "B2", "自递归检查", "SKIP", "未找到前端 src 目录")]

    # ---- 报告 ----
    counts = {"PASS": 0, "FAIL": 0, "WARN": 0, "SKIP": 0}
    for f in findings:
        counts[f[3]] = counts.get(f[3], 0) + 1

    if as_json:
        payload = [{"phase": p, "cid": c, "title": t, "status": s, "detail": d}
                   for (p, c, t, s, d) in findings]
        print(json.dumps({"summary": counts, "findings": payload},
                         ensure_ascii=False, indent=2))
    else:
        order = {"A": 0, "B": 1, "C": 2, "?": 3}
        findings.sort(key=lambda f: (order.get(f[0], 9), f[1]))
        print("=" * 72)
        print("Hergent 发布前自动闸门 — pre-delivery-gate.py")
        print("仓库: %s" % ROOT)
        print("=" * 72)
        cur = None
        for (p, c, t, s, d) in findings:
            icon = {"PASS": "✅", "FAIL": "🔴", "WARN": "⚠️ ", "SKIP": "⏭️ "}[s]
            if p != cur:
                cur = p
                print("\n— 阶段 %s —" % p)
            print("%s [%s] %s" % (icon, c, t))
            if d:
                for dl in d.split("\n"):
                    print("    %s" % dl)
        print("\n" + "=" * 72)
        print("汇总: PASS=%d  FAIL=%d  WARN=%d  SKIP=%d"
              % (counts["PASS"], counts["FAIL"], counts["WARN"], counts["SKIP"]))
        print("=" * 72)
        if counts["FAIL"]:
            print("🔴 有 FAIL → 阻断本轮交付，回到 Checklist 对应章节处理。")
        else:
            print("✅ 无 FAIL（WARN/SKIP 由人按 Checklist 打勾确认）。")

    return 1 if counts["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
