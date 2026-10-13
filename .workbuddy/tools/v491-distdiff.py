"""v491 产物差集归因（临时脚本）：把「字节不同」拆成「真实改动」与「纯 hash 级联」。

判据（hergent-parallel-session-safety §8.8）：vite 的 chunk 内容里含它 import 的 chunk 文件名
⇒ 任一 chunk 改名会让整条依赖链的名字与字节同时变 ⇒ 必须先归一化再比，否则满屏假差异。
"""
import os, re, io, tarfile, collections, subprocess

LOCAL = 'hergent-cn-v2/dist-v491/assets'
lo = {f: os.path.getsize(os.path.join(LOCAL, f)) for f in os.listdir(LOCAL) if f.endswith(('.js', '.css'))}
pr = {}
for line in open('/tmp/prod-active.txt'):
    line = line.strip()
    if not line or not line[0].isdigit():
        continue
    sz, name = line.split(None, 1)
    pr[name] = int(sz)

PRE = re.compile(r'^(.*)-([A-Za-z0-9_-]{8})\.(js|css)$')


def lg(n):
    m = PRE.match(n)
    return (m.group(1) + '.' + m.group(3)) if m else n


ll, pl = collections.defaultdict(list), collections.defaultdict(list)
for n, s in lo.items():
    ll[lg(n)].append((n, s))
for n, s in pr.items():
    pl[lg(n)].append((n, s))

diff = sorted(k for k in set(ll) & set(pl) if sorted(s for _, s in ll[k]) != sorted(s for _, s in pl[k]))
names = sorted({n for k in diff for n, _ in pl[k]})
print('拉取 %d 个线上 chunk 用于归一化比对 …' % len(names))
cmd = 'cd /opt/hergent-cn-v2/assets && tar cf - ' + ' '.join(names)
raw = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', 'root@47.113.224.140', cmd], capture_output=True).stdout
if not raw:
    raise SystemExit('拉取失败')
os.makedirs('/tmp/prod-chunks', exist_ok=True)
tarfile.open(fileobj=io.BytesIO(raw)).extractall('/tmp/prod-chunks')

NORM = re.compile(rb'-[A-Za-z0-9_-]{8}\.(js|css)')
print()
print('%-24s %9s %9s  %s' % ('chunk', '本地', '线上', '归一化后'))
print('-' * 66)
real = []
for k in diff:
    ln, ls = ll[k][0]
    pn, ps = pl[k][0]
    a = open(os.path.join(LOCAL, ln), 'rb').read()
    b = open('/tmp/prod-chunks/' + pn, 'rb').read()
    same = NORM.sub(rb'-X.\1', a) == NORM.sub(rb'-X.\1', b)
    if not same:
        real.append(k)
    print('%-24s %9d %9d  %s' % (k, ls, ps, '纯级联（零逻辑变化）' if same else '⚠️ 有真实改动'))
print()
print('真实改动 %d 个：%s' % (len(real), '、'.join(real) or '（无）'))

# 只新增、未删除的 chunk（本地独有）
only_local = sorted(set(ll) - set(pl))
only_prod = sorted(set(pl) - set(ll))
print()
print('仅本地多出（新增 chunk）：%s' % ('、'.join(only_local) or '（无）'))
print('仅线上多出（可能被回退）：%s' % ('、'.join(only_prod) or '（无）'))
