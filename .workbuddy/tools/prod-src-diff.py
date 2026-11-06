#!/usr/bin/env python3
"""阶段 0 · 生产后端源码纳管比对（对生产全程只读）

用途：回答「线上到底跑的是哪份代码」。生产 /opt/hergent-erp/ 不是 git 仓，
本机 git 仓 ~/Documents/hergent-erp/server 长期落后于生产，所以必须有
一条可复跑的命令把两边逐文件对齐，而不是凭印象说「应该差不多」。

用法（在 laozhangai-product 根目录跑）：
  python3 .workbuddy/tools/prod-src-diff.py compare
  python3 .workbuddy/tools/prod-src-diff.py pull
  python3 .workbuddy/tools/prod-src-diff.py pull --compare
  python3 .workbuddy/tools/prod-src-diff.py compare --out outputs/纳管比对.md
  python3 .workbuddy/tools/prod-src-diff.py compare --all      # 含 tests/migrations/scripts/tools
  python3 .workbuddy/tools/prod-src-diff.py compare --ref prod-baseline   # 与基线分支比（推荐验收口径）
  python3 .workbuddy/tools/prod-src-diff.py pull --compare --ref prod-baseline

🔴 只读保证：pull 是 rsync 从生产往本地拉，不向生产写任何文件；
   compare 纯本地读文件。本脚本绝不 scp/rsync 回生产、绝不改线上代码。

判据（阶段 0 验收项「任取线上端点能定位到唯一提交」）：
  一致数 = 全部核心源码 且 不一致 0 且 缺失 0  ⇒ VERDICT PASS
  否则 FAIL，并打印逐文件清单（含哪边更大、哪边更新，用于判断领先方向）。
"""
import argparse
import datetime as dt
import hashlib
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SNAP = ROOT / '.workbuddy/stage0/prod-src-latest'
DEFAULT_GIT = Path('/Users/zhangjunfeng/Documents/hergent-erp/server')
HOST = 'root@47.113.224.140'
REMOTE = '/opt/hergent-erp/'

# 与阶段 0 首次回拉口径一致：只比「核心源码」，排除会被补丁/测试刷屏的目录。
NOISE_DIRS = {'__pycache__', '.pytest_cache', 'tests', 'tools', 'migrations', 'scripts'}
# rsync 排除：数据库、备份、大文件、运行时产物（只拉源码，避免把生产数据带回来）
RSYNC_EXCLUDES = [
    '*.db', '*.db-*', '*.sqlite*', 'backups/', '_backup/', '_rollback/',
    '*.bak-*', 'domain.bak-*', 'hermes-engine/', '.hermes/',
    'incident_20260812/', 'var/', 'uploads/', '__pycache__/', '*.pyc',
    '.pytest_cache/', '*.log', '*.gz', '*.zip', '*.tar*', '*.png',
    '*.jpg', '*.xlsx', '*.pdf', '.git/',
]


def md5(p: Path) -> str:
    try:
        return hashlib.md5(p.read_bytes()).hexdigest()
    except OSError:
        return ''


def git_ref_files(repo: Path, ref: str, include_all: bool):
    """从 git 分支/标签读取 server/ 下的核心 py，返回 {rel: (md5, size)}。

    不 checkout、不读工作树 —— 并行会话里的在途改动不会影响验收结论。
    """
    r = subprocess.run(['git', '-C', str(repo), 'ls-tree', '-r', '-z', ref, '--', 'server'],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError('git ls-tree %s 失败: %s'
                           % (ref, r.stderr.decode('utf-8', 'replace').strip()))
    oid_by_rel = {}
    for entry in r.stdout.split(b'\x00'):
        if not entry:
            continue
        meta, _, path = entry.partition(b'\t')
        parts = meta.split()
        if len(parts) != 3 or parts[1] != b'blob':
            continue
        p = path.decode('utf-8', 'replace')
        if not p.startswith('server/'):
            continue
        rel = p[len('server/'):]
        if not rel.endswith('.py'):
            continue
        rp = Path(rel)
        if not include_all and any(part in NOISE_DIRS for part in rp.parts):
            continue
        oid_by_rel[rel] = parts[2].decode()

    if not oid_by_rel:
        return {}
    p = subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    p.stdin.write(('\n'.join(oid_by_rel.values()) + '\n').encode())
    p.stdin.close()
    out = {}
    for rel, oid in oid_by_rel.items():
        header = p.stdout.readline().decode().strip().split()
        if len(header) != 3 or header[1] != 'blob':
            continue
        size = int(header[2])
        data = p.stdout.read(size)
        p.stdout.read(1)
        out[rel] = (hashlib.md5(data).hexdigest(), size)
    p.wait()
    return out


def pull(snap: Path) -> int:
    snap.mkdir(parents=True, exist_ok=True)
    cmd = ['rsync', '-az', '--itemize-changes']
    for e in RSYNC_EXCLUDES:
        cmd += ['--exclude', e]
    cmd += [f'{HOST}:{REMOTE}', str(snap) + '/']
    print('[pull] 只读回拉生产源码 →', snap)
    print('[pull] ' + ' '.join(cmd[:6]) + ' ... (共 %d 条排除规则)' % len(RSYNC_EXCLUDES))
    r = subprocess.run(cmd)
    if r.returncode != 0:
        print('[pull] ❌ rsync 失败 rc=%d' % r.returncode, file=sys.stderr)
        return r.returncode
    n = len(list(snap.rglob('*.py')))
    print('[pull] ✅ 完成，快照内 py 文件 %d 个' % n)
    return 0


def files_under(base: Path, include_all: bool):
    out = {}
    for p in base.rglob('*.py'):
        rel = p.relative_to(base)
        if not include_all and any(part in NOISE_DIRS for part in rel.parts):
            continue
        out[str(rel)] = p
    return out


def compare(snap: Path, gitdir: Path, include_all: bool, out_path: str | None, ref: str | None = None):
    if not snap.is_dir():
        print('❌ 快照目录不存在：%s（先跑 pull）' % snap, file=sys.stderr)
        return 1
    if not gitdir.is_dir():
        print('❌ git 仓目录不存在：%s' % gitdir, file=sys.stderr)
        return 1
    a = files_under(snap, include_all)
    ref_commit = None
    if ref:
        r = subprocess.run(['git', '-C', str(gitdir), 'rev-parse', '--show-toplevel'],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if r.returncode != 0:
            print('❌ --git 不在 git 仓内：%s' % gitdir, file=sys.stderr)
            return 1
        repo = Path(r.stdout.decode().strip())
        try:
            b_ref = git_ref_files(repo, ref, include_all)
        except RuntimeError as e:
            print('❌ %s' % e, file=sys.stderr)
            return 1
        ref_commit = subprocess.run(['git', '-C', str(repo), 'rev-parse', '--short', ref],
                                    stdout=subprocess.PIPE).stdout.decode().strip()
        b = None
    else:
        b_ref = None
        b = files_under(gitdir, include_all)
    same, diff, only = [], [], []
    for rel, pa in sorted(a.items()):
        sa = pa.stat().st_size
        if ref:
            pb = b_ref.get(rel)
            if pb is None:
                only.append((rel, sa))
            elif md5(pa) == pb[0]:
                same.append(rel)
            else:
                diff.append((rel, sa, pb[1], sa - pb[1], '—'))
            continue
        pb = b.get(rel)
        if pb is None:
            only.append((rel, sa))
        elif md5(pa) == md5(pb):
            same.append(rel)
        else:
            sb = pb.stat().st_size
            ta, tb = pa.stat().st_mtime, pb.stat().st_mtime
            # 🔴 mtime 只是旁证：git 仓里的时间是本地 checkout 时间，不是代码写入时间，
            #    实测出现过「生产字节明显更多、mtime 却更旧」的矛盾。领先方向必须靠
            #    硬证据（生产非 git 仓 / git 提交信息 / 线上进程启动时间 / 内容差），
            #    不能拿这一列下结论。
            newer = '生产mtime较晚' if ta > tb else ('git仓mtime较晚' if tb > ta else '同刻')
            diff.append((rel, sa, sb, sa - sb, newer))

    lines = []
    lines.append('# 生产后端源码纳管比对（只读）')
    lines.append('')
    lines.append('- 生成时间：' + dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    lines.append('- 生产快照：`%s`' % snap)
    lines.append('- 本机 git 仓：`%s`' % gitdir)
    if ref:
        lines.append('- 比对对象：分支 `%s` @ `%s`（**不切工作树、不受在途改动影响**）' % (ref, ref_commit))
    else:
        lines.append('- 比对对象：工作树 `server/`（含在途改动，仅作开发参考）')
    lines.append('- 比对口径：%s' % ('全部 py 文件' if include_all else '核心源码（排除 tests/tools/migrations/scripts）'))
    lines.append('')
    lines.append('## 摘要')
    lines.append('')
    lines.append('| 项 | 数量 |')
    lines.append('|---|---|')
    lines.append('| 逐字节一致 | %d |' % len(same))
    lines.append('| 内容不一致 | %d |' % len(diff))
    lines.append('| %s缺失 | %d |' % ('基线分支' if ref else 'git 仓', len(only)))
    verdict = 'PASS' if (not diff and not only) else 'FAIL'
    lines.append('')
    lines.append('**VERDICT: %s** —「任取线上端点能定位到唯一提交」%s'
                 % (verdict, '达标' if verdict == 'PASS' else
                    ('未达标（基线与线上仍有差异）' if ref else '未达标（线上仍有未被版本管理的代码）')))
    lines.append('')
    lines.append('> 🔴 领先方向：生产 `/opt/hergent-erp/` **不是 git 仓**；历史实测生产普遍比 git 仓更新。')
    lines.append('> 严禁拿 git 仓反向覆盖生产 —— 那会回退功能。纳管必须以生产快照为基线。')
    if ref:
        lines.append('> 本次为**分支比对**：内容取自 git 对象库，mtime 不参与判定（表中为 `—`）。')
    else:
        lines.append('>')
        lines.append('> ⚠️ 下表的 mtime 列**只是旁证**：git 仓文件的 mtime 是本地 checkout 时间，')
        lines.append('> 不是代码写入时间，实测出现过「生产字节更多但 mtime 更晚在 git 仓」的矛盾。')
        lines.append('> 判断谁领先请看内容差 + git 提交信息 + 线上进程启动时间，不要看 mtime。')
    lines.append('')
    lines.append('## 内容不一致清单（%d）' % len(diff))
    lines.append('')
    if diff:
        lines.append('| 文件 | 生产字节 | git仓字节 | 差值 | mtime 旁证 |')
        lines.append('|---|---:|---:|---:|---|')
        for rel, sa, sb, d, newer in diff:
            lines.append('| `%s` | %d | %d | %+d | %s |' % (rel, sa, sb, d, newer))
    else:
        lines.append('（无）')
    lines.append('')
    lines.append('## %s缺失清单（%d）' % ('基线分支' if ref else 'git 仓', len(only)))
    lines.append('')
    if only:
        lines.append('| 文件 | 生产字节 |')
        lines.append('|---|---:|')
        for rel, sa in only:
            lines.append('| `%s` | %d |' % (rel, sa))
    else:
        lines.append('（无）')
    lines.append('')
    lines.append('## 复跑')
    lines.append('')
    lines.append('```bash')
    if ref:
        lines.append('python3 .workbuddy/tools/prod-src-diff.py pull --compare --ref %s' % ref)
    else:
        lines.append('python3 .workbuddy/tools/prod-src-diff.py pull --compare')
    lines.append('```')

    text = '\n'.join(lines) + '\n'
    print('\n'.join(lines[:18]))
    if diff:
        print('\n--- 不一致（前 25 条）---')
        for rel, sa, sb, d, newer in diff[:25]:
            print('  %-46s %+7d 字节  %s' % (rel, d, newer))
        if len(diff) > 25:
            print('  ... 其余 %d 条见 --out 报告' % (len(diff) - 25))
    if only:
        print('\n--- git 仓缺失 ---')
        for rel, sa in only:
            print('  %-46s %d 字节' % (rel, sa))
    if out_path:
        op = Path(out_path)
        if not op.is_absolute():
            op = ROOT / op
        op.parent.mkdir(parents=True, exist_ok=True)
        op.write_text(text, encoding='utf-8')
        print('\n[out] 报告已写入 %s' % op)
    print('\nVERDICT: %s  (一致 %d / 不一致 %d / 缺失 %d)' % (verdict, len(same), len(diff), len(only)))
    return 0 if verdict == 'PASS' else 2


def main():
    ap = argparse.ArgumentParser(description='生产后端源码纳管比对（只读）')
    ap.add_argument('action', nargs='?', default='compare', choices=['pull', 'compare'])
    ap.add_argument('--compare', action='store_true', help='pull 之后顺带 compare')
    ap.add_argument('--snap', default=str(DEFAULT_SNAP))
    ap.add_argument('--git', default=str(DEFAULT_GIT))
    ap.add_argument('--all', action='store_true', help='比对全部 py（含 tests/migrations/scripts/tools）')
    ap.add_argument('--ref', default=None, help='与指定 git 分支/标签比对（不切工作树、不看在途改动）')
    ap.add_argument('--out', default=None, help='把 Markdown 报告写到指定路径')
    args = ap.parse_args()
    snap, gitdir = Path(args.snap), Path(args.git)
    rc = 0
    if args.action == 'pull':
        rc = pull(snap)
        if rc or not args.compare:
            return rc
    return compare(snap, gitdir, args.all, args.out, args.ref)


if __name__ == '__main__':
    sys.exit(main())
