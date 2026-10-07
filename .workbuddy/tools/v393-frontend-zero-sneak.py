#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v393 前端「零夹带」判据 —— 以**生产当前生效集**为基线核对本轮构建产物。

为什么必须做：本仓长期有多个会话并行（本轮实测 `hergent-cn-v2/docs/UI-SPEC.md` 就有
另一会话的在途改动）。整包构建会把**别人的在途改动**一起带上线 ⇒ 必须证明
「进我这次产物的源码变化，恰好只有我改的那两个文件」。

判据（四层）：
  L1  生产生效集闭包（从 /opt/hergent-cn-v2/index.html 的入口递归解析）逐文件：
         · 基名相同 ⇒ hash 归一化后内容必须**逐字相同**（纯 hash 级联 = 源码零变化）
         · 内容不同 ⇒ 记为「源码真变化」，**必须在允许清单里**，否则判为夹带
  L2  新增基名（生产没有、产物有）⇒ 必须 ⊆ 允许清单（本轮新增的产物集合）
  L3  消失基名（生产有、产物没有）⇒ 必须为空（**绝不允许**：生产 assets 是历次并集，
      且上传绝不 --delete ⇒ 消失即意味着我漏传了别人依赖的文件）
  L4  入口 chunk 的字符串字面量差集 ⇒ 只允许出现本轮新增的路由 / 标题串

用法：
    python3 .workbuddy/tools/v393-frontend-zero-sneak.py \
        --dist   hergent-cn-v2/dist-v393/assets \
        --prod   /tmp/v393-sneak/prod-live/assets \
        --entry-local-dir hergent-cn-v2/dist-v393
"""
import argparse
import re
import sys
import pathlib

# vite 内容 hash：`<base>-<8位>.<ext>`（基名本身可能含 `-`，所以从右往左取）
HASH = re.compile(r"-[A-Za-z0-9_-]{8}\.(js|css)\b")


def base_of(name: str) -> str:
    """`Shell-CCeInDIo.js` → `Shell.js`（去掉 hash 段）。"""
    return HASH.sub(lambda m: '.\x00' + m.group(1), name).replace('\x00', '')


def norm_bytes(p: pathlib.Path) -> bytes:
    """把内容里所有 `-xxxxxxxx.js|css` 折叠成 `-H.js|css` —— 只剩 hash 差别的文件会变得逐字相同。"""
    return HASH.sub(lambda m: '-H.' + m.group(1), p.read_text(encoding='utf-8', errors='replace'))


def collect(d: pathlib.Path):
    out = {}
    for p in sorted(d.glob('*.*')):
        if p.suffix in ('.js', '.css'):
            out.setdefault(base_of(p.name), []).append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dist', required=True)
    ap.add_argument('--prod', required=True)
    ap.add_argument('--entry-local-dir', required=True)
    a = ap.parse_args()

    dist = pathlib.Path(a.dist)
    prod = pathlib.Path(a.prod)
    local = collect(dist)
    live = collect(prod)

    # 允许「源码真变化」的基名 = 本轮改的两个源文件直接产出的 chunk。
    # ⚠️ `Shell.vue` 同时产出 js 与 css（`<style>` 段）⇒ 两个基名都要在清单里，
    #    否则「加了 CSS」会被当成夹带（第一版就是这么误报的）。
    ALLOW_CHANGED = {'Shell.js', 'Shell.css', 'psiLabels.js'}
    # 允许「新增」的基名 = 本轮没有新页面 ⇒ 空（若有会由 L2 报出来）
    ALLOW_NEW = set()

    print(f'生产生效集 {len(live)} 个基名 / 本地产物 {len(local)} 个基名')

    same, cascaded, changed = [], [], []
    for b in sorted(set(local) & set(live)):
        l, p = local[b], live[b]
        if len(l) != 1 or len(p) != 1:
            changed.append((b, '同名多份，无法判定'))
            continue
        if l[0].name == p[0].name and l[0].read_bytes() == p[0].read_bytes():
            same.append(b)
        elif norm_bytes(l[0]) == norm_bytes(p[0]):
            cascaded.append(b)
        else:
            changed.append((b, f'{l[0].name} vs {p[0].name}'))

    new = sorted(set(local) - set(live))
    gone = sorted(set(live) - set(local))

    print('\n--- L1 逐文件 ---')
    print(f'   ✅ 逐字节相同（名字都没变）: {len(same)}')
    print(f'   ✅ 纯 hash 级联（归一化后逐字相同 ⇒ 源码零变化）: {len(cascaded)}')
    for b in cascaded:
        print(f'        {b}')
    print(f'   ⚠️ 源码真变化: {len(changed)}')
    for b, d in changed:
        mark = '✅允许' if b in ALLOW_CHANGED else '❌夹带'
        print(f'        {mark}  {b}   ({d})')

    print('\n--- L2 新增基名（生产没有） ---')
    if new:
        for b in new:
            mark = '✅允许' if b in ALLOW_NEW else '❌夹带'
            print(f'        {mark}  {b}')
    else:
        print('   ✅ 无')

    print('\n--- L3 消失基名（生产有、产物没有） ---')
    if gone:
        for b in gone:
            print(f'        ❌ {b}')
    else:
        print('   ✅ 无（没有漏掉生产依赖的文件）')

    print('\n--- L4 入口 chunk 字符串字面量差集 ---')
    ent_l = sorted(pathlib.Path(a.entry_local_dir).glob('assets/index-*.js'))
    ent_p = sorted(prod.glob('index-*.js'))
    if not ent_l or not ent_p:
        print('   ❌ 找不到入口 chunk（本地或生产）')
        return 1
    ent_l0, ent_p0 = ent_l[0], ent_p[0]
    lits_local = set(re.findall(r'"([^"\\]{2,60})"', norm_bytes(ent_l0)))
    lits_prod = set(re.findall(r'"([^"\\]{2,60})"', norm_bytes(ent_p0)))
    diff_add = sorted(x for x in (lits_local - lits_prod) if not x.startswith('assets/'))
    diff_del = sorted(x for x in (lits_prod - lits_local) if not x.startswith('assets/'))
    print(f'   入口: {ent_l0.name}  vs  {ent_p0.name}')
    print(f'   新增字面量（{len(diff_add)}）: {diff_add[:12]}')
    print(f'   消失字面量（{len(diff_del)}）: {diff_del[:12]}')
    ok_l4 = not diff_del
    print(f'   {"✅" if ok_l4 else "❌"} 消失字面量必须为空')

    print('\n' + '=' * 72)
    bad = [b for b, _ in changed if b not in ALLOW_CHANGED] + [b for b in new if b not in ALLOW_NEW]
    if gone:
        bad.append('L3: 有消失基名')
    if not ok_l4:
        bad.append('L4: 入口有消失字面量')
    if bad:
        print('❌ 零夹带未通过：')
        for b in bad:
            print('   - ' + b)
        return 1
    print('✅ 零夹带通过：'
          f'真变化 {len(changed)} 个（全部在允许清单内）· 新增 {len(new)} · 消失 {len(gone)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
