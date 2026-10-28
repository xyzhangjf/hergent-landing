#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v712 前端补回缺失的全局 statCard（erp.hergent.cn / /opt/static）。

## 为什么

`/opt/static/assets/main-CWrK_ez4.js` 里有 885 处

    try{window.X=X}catch{}

形式的导出，其中 407 个 X 在运行时是 `undefined` —— 模块里根本没声明，
`ReferenceError` 被**空 catch 吞掉**，页面永远不知道少了个函数。

`statCard` 就是其中之一，而且它被 26 处调用（10 处 `window.statCard`）：
固定资产页、工作台若干卡片、利润表(权责)、资产负债表(权责)、税务页。
一调用就抛 `window.statCard is not a function` ⇒ 面板停 spinner 不动。

## 修法

**不改 1.4MB 的 chunk**，而是在 `index.html` 里、`<script type="module">` 之前
插一段内联脚本定义 `window.statCard`：
  - main chunk 是 `type="module"` ⇒ 天然延迟执行，内联经典脚本必定先跑；
  - chunk 里的 `try{window.statCard=statCard}catch{}` 仍会抛错被吞，
    因此**不会覆盖**这里的定义。
语义按 CSS 契约反推（`.stat-card` + `.sc-blue|green|amber|red` 的 :before/:after 色条）：
    statCard(label, value, cls, unit) -> '<div class="stat-card sc-x">…'

## 纪律（v710/v711 的教训）
- 先判新串已在位，再看锚点唯一；锚点 0 次或 >1 次都直接失败，不猜。
- 备份 + 回读校验 + `--revert`。
- 目录可用 `ERP_STATIC` 覆盖，便于在副本上 dry-run / 往返验证。
"""

import argparse
import os
import shutil
import sys
import time

STATIC = os.environ.get("ERP_STATIC", "/opt/static")
INDEX = os.path.join(STATIC, "index.html")

ANCHOR = '  <script type="module" crossorigin src="/assets/main-CWrK_ez4.js"></script>'

BLOCK = """  <!-- v712: 补回缺失的全局 statCard —— 见 docs/v712-前端statCard缺失-2026-10-28.md
       背景：main-*.js 有 885 处 `try{window.X=X}catch{}` 导出，运行时 407 处为 undefined；
       statCard 从未声明，空 catch 吞掉 ReferenceError ⇒ 10 处卡片渲染抛错，
       「资产负债表(权责)」「利润表(权责)」等面板永远停在 spinner，
       v708/v709 的报表新口径在界面上完全看不到。按 CSS 契约补最小实现。 -->
  <script>
  (function () {
    if (typeof window.statCard === "function") { return; }
    function fmt(n, unit) {
      if (unit === "\\u00a5") {
        return "\\u00a5" + n.toLocaleString("zh-CN", {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });
      }
      return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) +
             (unit ? " " + unit : "");
    }
    window.statCard = function (label, value, cls, unit) {
      var raw = (value === null || value === undefined) ? 0 : value;
      var txt;
      if (typeof raw === "number" || /^-?\\d+(\\.\\d+)?$/.test(String(raw))) {
        txt = fmt(Number(raw), unit);
      } else {
        txt = String(raw) + (unit ? " " + unit : "");
      }
      var c = cls ? " " + String(cls).trim() : "";
      return '<div class="stat-card' + c + '">' +
             '<div class="stat-card-label">' + label + '</div>' +
             '<div class="stat-card-val">' + txt + '</div></div>';
    };
  })();
  </script>
"""

MARK = "window.statCard = function"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--skip-verify", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(INDEX):
        print("🔴 找不到 %s" % INDEX)
        return 2

    text = open(INDEX, encoding="utf-8").read()

    # ---- 回滚 ----
    if a.revert:
        if MARK not in text:
            print("⏭  未打补丁，无需回滚")
            return 0
        start = text.index("  <!-- v712: 补回缺失的全局 statCard")
        end = text.index("</script>\n", text.index("})();", start)) + len("</script>\n")
        new = text[:start] + text[end:]
        if a.dry_run:
            print("[dry-run] 将删除注入块 %d 字节" % (end - start))
            return 0
        _write(INDEX, new)
        print("✅ 已回滚注入块（%d 字节）" % (end - start))
        return 0

    # ---- 幂等：先判新串已在位 ----
    if MARK in text:
        print("⏭  window.statCard 已注入（幂等跳过）")
        return 0

    # ---- 锚点必须唯一 ----
    n = text.count(ANCHOR)
    if n != 1:
        print("🔴 锚点命中 %d 次（要求恰好 1 次）——拒绝改动" % n)
        return 3

    new = text.replace(ANCHOR, BLOCK + ANCHOR, 1)

    if a.dry_run:
        print("[dry-run] 将在 main chunk 前插入 %d 字节；锚点命中 1 次" % len(BLOCK))
        return 0

    bak = INDEX + ".bak-v712"
    shutil.copy2(INDEX, bak)
    _write(INDEX, new)
    print("✏️  已插入 %d 字节；备份 %s" % (len(BLOCK), bak))

    if a.skip_verify:
        return 0
    return _verify()


def _write(path, text):
    tmp = path + ".tmp-v712"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _verify():
    text = open(INDEX, encoding="utf-8").read()
    bad = []
    if text.count(MARK) != 1:
        bad.append("statCard 定义出现 %d 次（应为 1）" % text.count(MARK))
    if text.count("v712: 补回缺失的全局 statCard") != 1:
        bad.append("注入注释缺失或重复")
    if text.count(ANCHOR) != 1:
        bad.append("main chunk 脚本标签被破坏（%d 个）" % text.count(ANCHOR))
    # 注入块必须在 chunk 之前
    if text.find(MARK) > text.find(ANCHOR):
        bad.append("注入块落在 chunk 之后（module 虽延迟，但不该依赖这个顺序）")
    if bad:
        print("🔴 回读校验失败：")
        for b in bad:
            print("     - " + b)
        return 4
    print("✅ 回读校验通过（定义 1 处、位于 chunk 之前、chunk 标签完整）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
