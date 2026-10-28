#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v715 利润表月份下拉真正生效（erp.hergent.cn / /opt/static）。

## 问题（真机实测）

「利润表(权责)」面板有 12 个月份下拉（`#pnlGlMonth`），但：

1. 下拉**没有绑 change** —— 选了月份界面不刷新，看起来"没反应"。
2. 就算手动触发重渲染，渲染函数每次重建 `<select>` 并把默认值写回**当前月**，
   渲染后紧接着读 `P.value` ⇒ 用户选择必然被丢弃。

结果：这个面板**永远只能看当前月**。而 2026-10 的销售为 0，
老板打开利润表看到的永远是「本月 0」——想看 9 月的 112 万只能靠改系统时间。

## 修法

不动 1.4MB chunk，在 `index.html` 内联注入：
  - `window.__pnlMonth` 记住用户选择（null = 跟随默认当前月，行为不变）
  - 事件委托（捕获阶段）监听 `#pnlGlMonth` 的 change ⇒ 记值 + 调 `switchRptTab('pnl-gl')`
  - 包装 `window.api`：`/reports/pnl?month=` 的月份替换成用户选择
  - 渲染是异步的，再用 MutationObserver + setTimeout 把 select 的显示值纠正回来
    （否则界面显示 2026-10、数据是 2026-06，比不修更误导）

## 为什么包装 `window.api` 而不是改渲染函数

渲染函数在 chunk 内部闭包里，内联脚本改不到；但 `pnl-gl` 分支走的是
`window.api("/reports/pnl?month="+h)`（v713 已核实），是全局可包装的。

## 关键坑：内联脚本比 chunk 先跑

`<script type="module">` 天然延迟执行 ⇒ 内联脚本执行时 `window.api` **还不存在**。
所以必须**轮询挂载**，不能一次性 `var o = window.api`（那样拿到 undefined，
且之后 chunk 赋值会把它覆盖掉，hook 静默失效——正是本项目最常见的失效形态）。

## 纪律
- `ERP_STATIC` 覆盖目录；`--dry-run` / `--revert`；先判新串在位再判锚点唯一。
- 回读校验：注入块 1 处、位于 chunk 之前、chunk 标签完整。
"""

import argparse
import os
import shutil
import sys

STATIC = os.environ.get("ERP_STATIC", "/opt/static")
INDEX = os.path.join(STATIC, "index.html")

ANCHOR = '  <script type="module" crossorigin src="/assets/main-CWrK_ez4.js"></script>'
COMMENT = "  <!-- v715: 让「利润表(权责)」的月份下拉真正生效"
MARK = "window.__v715pnl = 1"

BLOCK = """  <!-- v715: 让「利润表(权责)」的月份下拉真正生效 —— 见 docs/v714-利润表口径统一-2026-10-28.md
       v713 实测：下拉 #pnlGlMonth 没有 change 监听，且渲染函数每次重建 select
       并把默认值写回当前月 ⇒ 选择必然丢失，面板永远只能看当前月。
       这里用「记住选择 + 包装 api + 纠正显示」三件事补上，不动 1.4MB chunk。 -->
  <script>
  (function () {
    if (window.__v715pnl) { return; }
    window.__v715pnl = 1;
    window.__pnlMonth = null;          /* null = 跟随默认（当前月），行为与改前一致 */

    function wrapApi() {
      var o = window.api;
      if (typeof o !== "function" || o.__v715wrapped) { return; }
      var w = function (url, params) {
        if (typeof url === "string" && window.__pnlMonth &&
            url.indexOf("/reports/pnl?month=") === 0) {
          url = "/reports/pnl?month=" + window.__pnlMonth;
        }
        return o(url, params);
      };
      w.__v715wrapped = 1;
      window.api = w;
    }

    /* 🔴 内联脚本比 type=module 的 chunk 先执行 ⇒ window.api 此刻还不存在。
       用轮询 + 定时兜底持续挂载，而不是一次性取引用（那样静默失效）。 */
    wrapApi();
    var tries = 0;
    var t = setInterval(function () {
      wrapApi();
      if (++tries > 60 && window.api && window.api.__v715wrapped) { clearInterval(t); }
      if (tries > 400) { clearInterval(t); }
    }, 100);

    function fixSelect() {
      var s = document.getElementById("pnlGlMonth");
      if (s && window.__pnlMonth && s.value !== window.__pnlMonth) {
        s.value = window.__pnlMonth;
      }
    }

    document.addEventListener("change", function (e) {
      var el = e.target;
      if (!el || el.id !== "pnlGlMonth") { return; }
      window.__pnlMonth = el.value;
      if (typeof window.switchRptTab === "function") {
        Promise.resolve(window.switchRptTab("pnl-gl")).then(function () {
          /* 渲染把 select 重建成默认当前月 ⇒ 纠正显示。DOM 重建时机不定，
             用一段短轮询兜住（实测单次 setTimeout 会撞上重建）。 */
          var n = 0;
          var iv = setInterval(function () {
            fixSelect();
            if (++n > 25) { clearInterval(iv); }
          }, 100);
        });
      }
    }, true);

    /* 🔴 不能 observe #rptContent：本脚本执行时报表页还没创建那个容器
       （它是点「报表」才渲染出来的），启动时抓到 null ⇒ observer 根本没挂上，
       select 显示就会停在默认月份而数据是另一月（比不修更误导）。
       改为 observe body，回调里只在值不对时才写，不会自激。 */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () { fixSelect(); });
      var boot = function () {
        mo.observe(document.body, { childList: true, subtree: true });
        fixSelect();
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
      } else { boot(); }
    }
  })();
  </script>
"""


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

    if a.revert:
        if MARK not in text:
            print("⏭  未注入，无需回滚")
            return 0
        start = text.index(COMMENT)
        end = text.index("</script>\n", text.index("})();", start)) + len("</script>\n")
        if a.dry_run:
            print("[dry-run] 将删除注入块 %d 字节" % (end - start))
            return 0
        _write(INDEX, text[:start] + text[end:])
        print("✅ 已回滚（%d 字节）" % (end - start))
        return _verify_reverted()

    if MARK in text:
        print("⏭  v715 注入块已在位（幂等跳过）")
        return 0

    n = text.count(ANCHOR)
    if n != 1:
        print("🔴 锚点命中 %d 次（要求恰好 1 次）——拒绝改动" % n)
        return 3
    new = text.replace(ANCHOR, BLOCK + ANCHOR, 1)
    if a.dry_run:
        print("[dry-run] 将插入 %d 字节；锚点命中 1 次" % len(BLOCK))
        return 0

    bak = INDEX + ".bak-v715"
    if not os.path.exists(bak):
        shutil.copy2(INDEX, bak)
    _write(INDEX, new)
    print("✏️  已插入 %d 字节；备份 %s" % (len(BLOCK), bak))
    if a.skip_verify:
        return 0
    return _verify()


def _write(path, text):
    tmp = path + ".tmp-v715"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _verify():
    text = open(INDEX, encoding="utf-8").read()
    bad = []
    if text.count(MARK) != 1:
        bad.append("v715 标记出现 %d 次" % text.count(MARK))
    if text.count(ANCHOR) != 1:
        bad.append("chunk 脚本标签被破坏（%d 个）" % text.count(ANCHOR))
    if text.find(MARK) > text.find(ANCHOR):
        bad.append("注入块落在 chunk 之后")
    for k in ("__pnlMonth", "pnlGlMonth", "__v715wrapped", "MutationObserver"):
        if k not in text:
            bad.append("关键实现缺失：%s" % k)
    if bad:
        print("🔴 回读校验失败：")
        for b in bad:
            print("     - " + b)
        return 4
    print("✅ 回读校验通过（注入 1 处、位于 chunk 之前、四个关键实现在位）")
    return 0


def _verify_reverted():
    text = open(INDEX, encoding="utf-8").read()
    bad = []
    if MARK in text or "__pnlMonth" in text:
        bad.append("v715 注入内容仍残留")
    if text.count(ANCHOR) != 1:
        bad.append("chunk 标签异常（%d）" % text.count(ANCHOR))
    if bad:
        print("🔴 回滚自检失败：")
        for b in bad:
            print("     - " + b)
        return 4
    print("✅ 回滚自检通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
