#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v296 受控提交的**第三产物分类型编译校验**（技能 `hergent-scoped-commit` §5.42）。

为什么要单跑一遍：`scoped_stage_by_marker.py` 只证明「我暂存的内容 == 我该交的内容」
（归属正确），**不证明它编译得过**。"只交已改的跟踪文件 = 坏提交"这类事故 git / 各语言
的静态检查**全都不报**，只有真编译才炸。

各类型的判据（为什么必须分类，不能一把梭 `node --check`）：
  · `.js`（本项目是 **ESM**）：`node --check` 默认按 CommonJS 解析 ⇒ 直接对 `.js` 跑会因
    `import` / `export` 报 `SyntaxError`，于是**要么假红、要么（更糟）你以为需要改源码**。
    ✅ 正解：先把产物复制成 `.mjs` 再 `node --check`（扩展名决定解析模式）。
  · `.mjs`：直接 `node --check`。
  · `.vue`：`node --check` 完全不认 —— 必须过 `@vue/compiler-sfc`（用**仓库自带的**那份）。
  · `.py`：`py_compile` / `compile()`（能同时抓缩进与语法）。
  · `.md` / `.txt`：不编译。
"""
import os
import shutil
import subprocess
import sys

STAGED = "/tmp/v296-staged"
REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
NODE = "/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"
TMP = "/tmp/v296-third"
SFC_JS = os.path.join(TMP, "sfc-check.cjs")


def write_sfc_checker():
    """用**仓库自带**的 @vue/compiler-sfc 校验；不手写解析器。"""
    os.makedirs(TMP, exist_ok=True)
    js = """
const fs = require('fs');
const sfc = require(process.argv[2]);
const f = process.argv[3];
const src = fs.readFileSync(f, 'utf-8');
const out = sfc.parse(src, { filename: f });
if (out.errors && out.errors.length) { console.error('PARSE: ' + JSON.stringify(out.errors)); process.exit(1); }
if (out.descriptor.scriptSetup || out.descriptor.script) {
  const r = sfc.compileScript(out.descriptor, { id: 'x' });
  if (!r || !r.content) { console.error('compileScript 空返回'); process.exit(1); }
}
if (out.descriptor.template) {
  const t = sfc.compileTemplate({ source: out.descriptor.template.content, filename: f, id: 'x' });
  if (t.errors && t.errors.length) { console.error('TEMPLATE: ' + JSON.stringify(t.errors)); process.exit(1); }
}
console.log('OK');
"""
    with open(SFC_JS, "w", encoding="utf-8") as fh:
        fh.write(js)


def main():
    if not os.path.isdir(STAGED):
        raise SystemExit("先跑 v296-perms-scoped-spec.py 生成 %s" % STAGED)
    write_sfc_checker()
    sfc_path = os.path.join(REPO, "hergent-cn-v2/node_modules/@vue/compiler-sfc/index.js")
    if not os.path.exists(sfc_path):
        sfc_path = os.path.join(REPO, "hergent-cn-v2/node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js")
    if not os.path.exists(sfc_path):
        raise SystemExit("找不到仓库自带的 @vue/compiler-sfc：%s" % sfc_path)
    shutil.rmtree(TMP + "/work", ignore_errors=True)
    os.makedirs(TMP + "/work", exist_ok=True)

    files = sorted(os.listdir(STAGED))
    ok = skip = 0
    bad = []
    for name in files:
        src = os.path.join(STAGED, name)
        real = name.replace("__", "/")
        ext = os.path.splitext(name)[1]
        if ext in (".md", ".txt"):
            skip += 1
            continue
        if ext in (".js", ".mjs", ".vue"):
            # .js 必须先改扩展名（扩展名决定 ESM/CJS 解析模式）
            tmp = os.path.join(TMP + "/work", os.path.basename(name) + (".mjs" if ext in (".js", ".mjs") else ".vue"))
            shutil.copy(src, tmp)
            if ext == ".vue":
                r = subprocess.run([NODE, SFC_JS, sfc_path, tmp], capture_output=True, text=True)
            else:
                r = subprocess.run([NODE, "--check", tmp], capture_output=True, text=True)
            tag = "SFC" if ext == ".vue" else "node --check"
        elif ext == ".py":
            r = subprocess.run([sys.executable, "-m", "py_compile", "-q", src], capture_output=True, text=True)
            tag = "py_compile"
        else:
            skip += 1
            continue
        if r.returncode == 0:
            ok += 1
            print("  ✅ %-14s %s" % (tag, real))
        else:
            bad.append(real)
            print("  ❌ %-14s %s\n     %s" % (tag, real, (r.stderr or r.stdout).strip()[:400]))
    print("=" * 70)
    print("编译通过 %d ；跳过（非代码）%d ；失败 %d" % (ok, skip, len(bad)))
    if bad:
        print("❌ 失败清单：")
        for x in bad:
            print("   - %s" % x)
        return 1
    print("✅ 第三产物全部编译通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
