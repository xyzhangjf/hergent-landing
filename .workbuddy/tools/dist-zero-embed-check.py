#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v390 起通用：把一个本地 dist 目录与「**生产生效集**」做零夹带/零缺失比对。

为什么不能拿 `assets/` 目录当基线：生产 `assets/` 是**历次构建的并集**（见 deploy-ops §),
直接扫会把历史残留算成"线上已有"。**生效集**必须从 `index.html` 出发递归解析：
  index.html 里的 <script src>/<link href>
  → 每个 js 内出现的 `__vite__mapDeps` 字符串 / 静态 import 路径
  → 递归到不动点
⚠️ chunk 内两种写法混用（`assets/Foo-x.js` / `./Foo-x.js` / 裸 `Foo-x.js`），
   正则必须写成 `(?:\./)?(?:assets/)?`，否则漏一半。

四路判据：
  A 基名+字节   —— 归一化 hash 后按基名配对，比字节（**改名不算、增删才算夹带**）
  B 只在生产有   —— 新构建缺失（= 回滚风险）
  C 只在新构建有 —— 新构建新增（= 别人在途 / 我的新页面）
  D 中文串差集   —— 生产独有中文（应为 0，或逐条归因到我的改名）
用法：
  python3 dist-zero-embed-check.py <dist_dir> [--base-url https://hergent.cn] [--json out.json]
"""
import argparse, hashlib, json, os, re, sys, urllib.request, urllib.error

HASH_RE = re.compile(r'-[A-Za-z0-9_-]{8,}\.(js|css)$')
# 归一化：去掉 hash，保留基名与扩展名
def norm(name):
    return HASH_RE.sub(r'.\1', name)

REF_RE = re.compile(r'(?:\./)?(?:assets/)?([A-Za-z][A-Za-z0-9_.-]*?-[A-Za-z0-9_-]{8,}\.(?:js|css))')
HREF_RE = re.compile(r'(?:src|href)\s*=\s*["\']([^"\']+\.(?:js|css))["\']')
CJK_RE = re.compile(r'[\u4e00-\u9fff][\u4e00-\u9fff0-9A-Za-z（）()·\-—…、，。：；！？「」【】/]*')


def fetch(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit('fetch failed: %s (%s)' % (url, last))


def prod_effective_set(base_url):
    """从 index.html 递归解析出生产**生效批次**。"""
    idx = fetch(base_url + '/?_cb=3900')
    html = idx.decode('utf-8', 'replace')
    # 入口：index.html 里显式引用的每一个资源
    seeds = set()
    for m in HREF_RE.findall(html):
        seeds.add(os.path.basename(m))
    for m in REF_RE.findall(html):
        seeds.add(os.path.basename(m))
    seen, queue = {}, list(sorted(seeds))
    while queue:
        name = queue.pop()
        if name in seen:
            continue
        raw = fetch(base_url + '/assets/' + name)
        seen[name] = raw
        txt = raw.decode('utf-8', 'replace')
        for child in REF_RE.findall(txt):
            if child not in seen:
                queue.append(child)
    return idx, seen


def cjk_of(blobs):
    out = set()
    for b in blobs:
        out |= set(CJK_RE.findall(b.decode('utf-8', 'replace')))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dist')
    ap.add_argument('--base-url', default='https://hergent.cn')
    ap.add_argument('--json')
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args()

    local = {}
    for fn in sorted(os.listdir(os.path.join(a.dist, 'assets'))):
        p = os.path.join(a.dist, 'assets', fn)
        if os.path.isfile(p):
            local[fn] = open(p, 'rb').read()
    idx_local = open(os.path.join(a.dist, 'index.html'), 'rb').read()

    prod_idx, prod = prod_effective_set(a.base_url)

    ln = {norm(k): k for k in local}
    pn = {norm(k): k for k in prod}

    only_prod = sorted(set(pn) - set(ln))
    only_new = sorted(set(ln) - set(pn))
    both = sorted(set(ln) & set(pn))
    same, diff = [], []
    for b in both:
        if local[ln[b]] == prod[pn[b]]:
            same.append(b)
        else:
            diff.append((b, len(prod[pn[b]]), len(local[ln[b]])))

    # 中文串差集（只比生效集，**不含** index.html 之外的残留）
    cjk_prod = cjk_of(list(prod.values()) + [prod_idx])
    cjk_new = cjk_of(list(local.values()) + [idx_local])
    prod_only_cjk = sorted(cjk_prod - cjk_new)
    new_only_cjk = sorted(x for x in (cjk_new - cjk_prod) if len(x) >= 3)

    out = {
        'local_files': len(local),
        'prod_effective_files': len(prod),
        'prod_entry': sorted(x for x in prod if x.startswith('index-')),
        'same_base_same_bytes': len(same),
        'same_base_diff_bytes': [{'base': b, 'prod': p, 'new': n} for b, p, n in diff],
        'only_in_prod': [{'base': b, 'file': pn[b]} for b in only_prod],
        'only_in_new': [{'base': b, 'file': ln[b]} for b in only_new],
        'cjk_only_in_prod': prod_only_cjk,
        'cjk_only_in_new_len3plus': new_only_cjk,
    }
    if a.json:
        json.dump(out, open(a.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    if not a.quiet:
        print('本地构建 assets: %d 个' % len(local))
        print('生产生效集     : %d 个  (入口 %s)' % (len(prod), ', '.join(out['prod_entry'])))
        print('A 基名+字节    : 同名同字节 %d 个 / 同名异字节 %d 个' % (len(same), len(diff)))
        for b, p, n in diff:
            print('     Δ %-28s 生产 %8d → 新 %8d  (%+d)' % (b, p, n, n - p))
        print('B 只在生产有   : %d 个 %s' % (len(only_prod), [x['base'] for x in out['only_in_prod']] or ''))
        print('C 只在新构建有 : %d 个 %s' % (len(only_new), [x['base'] for x in out['only_in_new']] or ''))
        print('D 生产独有中文 : %d 条 %s' % (len(prod_only_cjk), prod_only_cjk[:40]))
        print('  新构建独有中文(≥3字): %d 条' % len(new_only_cjk))
        for s in new_only_cjk[:60]:
            print('     + %s' % s)

    # 终判分两档：
    #   ① only_in_prod 非空 ⇒ 生产有、新构建没有 ⇒ **回滚风险**（真红）
    #   ② prod_only_cjk 非空 ⇒ 需**逐条归因**（预期多半是本轮改名族）；C 非空 ⇒ 新增 chunk 基名，逐条归因
    hard_red = bool(only_prod)
    if hard_red:
        print('==> ❌ 回滚风险：新构建缺 %d 个生产生效 chunk' % len(only_prod))
    else:
        print('==> ✅ 零缺失（无回滚风险）')
    if prod_only_cjk:
        print('    ⚠️ 生产独有中文 %d 条，需逐条归因（改名族属预期，不是缺失）' % len(prod_only_cjk))
    if only_new:
        print('    ⚠️ 新构建独有 chunk %d 个，需逐条归因（= 是否夹带别人的在途页面）' % len(only_new))
    return 1 if hard_red else 0


if __name__ == '__main__':
    sys.exit(main())
