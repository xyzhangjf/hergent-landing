#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v717c 修复「利润表(权责) / 资产负债表(权责)」入口按钮不出现

现象（真机实测，写在 tests/perf/v717）
------------------------------------
`/opt/static` 的 chunk 里有一处注入代码，在 `render_reports` 之后
`setTimeout(..., 300)` 再去找 `#rptBtn_cf` 并插两个「(权责)」按钮。
实测报表按钮要到 **~1000ms** 才出现（数据异步加载），300ms 时
`#rptBtn_cf` 还不存在 ⇒ `if(y && ...)` 整段跳过，**按钮永远不插**。
轮询 20×500ms 实证：`rptBtn_cf` 从 1000ms 起稳定存在，
`rptBtn_pnl-gl` / `rptBtn_bs-gl` 全程 `false`。

后果：老板界面上**没有**「利润表(权责)」入口 ⇒ v714 的权责口径利润表、
v713 的权责资产负债表，一个都点不到（只在接口里存在）。

修法
----
在 `index.html` 末尾追加一段**内联经典脚本**（比 `type="module"` 的 chunk 先跑），
用「轮询 + MutationObserver」双保险，等到 `#rptBtn_cf` 出现就补两个按钮，幂等。
不依赖任何固定延时 —— 这正是 chunk 里那段代码失效的原因。

为什么不改 chunk 里那段：`/opt/static` 无源码仓库、无构建链，
改 chunk 的注入逻辑要动被压缩的函数体；内联脚本是 v712/v715 已验证过的路径
（内联先跑，chunk 里同 id 的插入会因 `getElementById` 判存在而跳过，不会重复）。

用法：--dry-run / --apply / --verify / --revert
"""
import argparse
import json
import os
import re
import shutil
import time

FE_DIR = "/opt/static"
BAK_DIR = "/opt/hergent-data/backup"
TS = time.strftime("%Y%m%d-%H%M%S")
MARK = "/*v717c-rpt-entry*/"

INLINE = """<script>
%s
/* v717c：「利润表(权责) / 资产负债表(权责)」入口自愈注入。
   chunk 里那段靠 setTimeout 300ms 抓 #rptBtn_cf，而按钮实际 ~1000ms 才出现
   ⇒ 条件不成立、整段跳过、按钮永不插入（真机轮询 20×500ms 实证）。
   这里改成「轮询 + MutationObserver」，谁先满足谁插，且严格幂等。 */
(function(){
  var ITEMS=[["rptBtn_pnl-gl","利润表(权责)","pnl-gl"],
             ["rptBtn_bs-gl","资产负债表(权责)","bs-gl"]];
  function inject(){
    var y;
    try{ y=document.getElementById("rptBtn_cf"); }catch(e){ return false; }
    if(!y||!y.parentNode) return false;
    var all=true;
    for(var i=0;i<ITEMS.length;i++){
      var id=ITEMS[i][0], label=ITEMS[i][1], tab=ITEMS[i][2];
      if(document.getElementById(id)) continue;
      all=false;
      var b=document.createElement("button");
      b.id=id; b.type="button";
      b.className=y.className||"btn btn-outline btn-sm";
      b.textContent=label;
      b.setAttribute("onclick","try{window.switchRptTab('"+tab+"')}catch(e){}");
      y.parentNode.insertBefore(b, y.nextSibling);
    }
    return all;
  }
  var n=0;
  var timer=setInterval(function(){ n++; if(inject()||n>180) clearInterval(timer); },400);
  var last=0;
  try{
    new MutationObserver(function(){
      var now=Date.now();
      if(now-last<250) return;   /* 节流：body 子树变动很频繁 */
      last=now;
      inject();
    }).observe(document.body,{childList:true,subtree:true});
  }catch(e){}
  if(document.readyState!=="loading") inject();
})();
</script>
""" % MARK


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def fe_index():
    return os.path.join(FE_DIR, "index.html")


def do_apply(dry=True):
    rep = {"ts": TS, "dry_run": dry, "file": fe_index(), "action": None, "backup": None}
    f = fe_index()
    if not os.path.exists(f):
        return {"error": "找不到 " + f}
    s = _read(f)
    if MARK in s:
        rep["action"] = "already_applied"
        return rep
    n = s.count("</body>")
    if n != 1:
        return {"error": "</body> 出现 %d 次（应 1）" % n}
    if dry:
        rep["action"] = "would_insert"
        rep["insert_bytes"] = len(INLINE)
        return rep
    bak = f + ".bak-v717c"
    if not os.path.exists(bak):
        shutil.copy2(f, bak)
    rep["backup"] = bak
    out = s.replace("</body>", INLINE + "</body>")
    assert out.count(MARK) == 1
    _write(f, out)
    rep["action"] = "inserted"
    rep["size_before"] = len(s)
    rep["size_after"] = len(out)
    os.makedirs(BAK_DIR, exist_ok=True)
    man = os.path.join(BAK_DIR, "v717c-manifest-%s.json" % TS)
    _write(man, json.dumps(rep, ensure_ascii=False, indent=1))
    rep["manifest"] = man
    return rep


def do_revert():
    f = fe_index()
    bak = f + ".bak-v717c"
    if not os.path.exists(bak):
        return {"error": "找不到备份 " + bak}
    shutil.copy2(bak, f)
    return {"restored": f}


def do_verify():
    f = fe_index()
    s = _read(f)
    chunk = None
    m = re.search(r"assets/main-[A-Za-z0-9_-]+\.js", s)
    if m:
        chunk = os.path.join(FE_DIR, m.group(0))
    checks = [
        ("index.html 含 v717c 标记", MARK in s),
        ("注入包在 </body> 之前",
         s.find(MARK) > 0 and s.find(MARK) < s.find("</body>")),
        ("注入含 pnl-gl 按钮", 'rptBtn_pnl-gl' in s),
        ("注入含 bs-gl 按钮", 'rptBtn_bs-gl' in s),
        ("注入用轮询而非固定延时", "setInterval(function(){ n++; if(inject()" in s),
        ("注入含 MutationObserver", "new MutationObserver" in s),
        ("chunk 存在", bool(chunk and os.path.exists(chunk))),
    ]
    out = {"checks": [{"name": n, "pass": bool(c)} for n, c in checks]}
    out["all_pass"] = all(c["pass"] for c in out["checks"])
    return out


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    g.add_argument("--revert", action="store_true")
    g.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.revert:
        print(json.dumps(do_revert(), ensure_ascii=False, indent=1)); return
    if a.verify:
        v = do_verify()
        print(json.dumps(v, ensure_ascii=False, indent=1))
        raise SystemExit(0 if v["all_pass"] else 1)
    print(json.dumps(do_apply(dry=not a.apply), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
