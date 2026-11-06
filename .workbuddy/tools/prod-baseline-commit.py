#!/usr/bin/env python3
"""阶段 0 · 把生产后端源码快照提交成 git 基线分支（只入库，不碰生产、不动工作树）

背景：生产 /opt/hergent-erp/ 不是 git 仓，且长期领先本机 git 仓。
「任取线上端点能定位到唯一提交」要求线上源码在版本库里有唯一对应提交。
本脚本以**生产快照为基线**（方向绝不能反），把核心源码全量覆盖进
refs/heads/prod-baseline，并可选打时点标签。

🔴 三条硬护栏：
  1. 全程用临时 GIT_INDEX_FILE + git plumbing，不 checkout / 不 stash / 不 reset，
     所以本机 git 仓里并行会话的在途改动一根手指都碰不到。
  2. 绝不 push。基线分支只留在本地，避免把生产源码（含已知安全债）推到远端。
  3. 绝不回写生产：脚本里没有任何 scp / rsync / ssh 调用。
     严禁拿 git 仓反向覆盖生产 —— 那会回退功能并造成交易事故。

用法（在 laozhangai-product 根目录跑）：
  python3 .workbuddy/tools/prod-baseline-commit.py --dry-run
  python3 .workbuddy/tools/prod-baseline-commit.py --tag prod-baseline/2026-11-06
  python3 .workbuddy/tools/prod-baseline-commit.py --snap <快照目录> --tag <标签>

验收：
  python3 .workbuddy/tools/prod-src-diff.py compare --ref prod-baseline \
      --snap .workbuddy/stage0/prod-src-20261106 --out outputs/阶段0-后端纳管比对-基线条.md
"""
import argparse
import datetime as dt
import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SNAP = ROOT / '.workbuddy/stage0/prod-src-20261106'
DEFAULT_GIT_DIR = Path('/Users/zhangjunfeng/Documents/hergent-erp/server')
SERVER_PREFIX = 'server'          # 生产 /opt/hergent-erp/ 对应 git 仓的 server/ 目录
NOISE_DIRS = {'__pycache__', '.pytest_cache', 'tests', 'tools', 'migrations', 'scripts'}
REF = 'refs/heads/prod-baseline'

# 只提交 .py；这些名字即便将来被误写成 .py 也一律拒收。
DENY_NAMES = {'.env', '.DS_Store', 'id_rsa', 'id_ed25519', '.npmrc', '.netrc'}


def git(repo: Path, *args, env=None, input_bytes=None, check=True):
    r = subprocess.run(['git', '-C', str(repo), *args], env=env,
                       input=input_bytes, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE)
    if check and r.returncode != 0:
        raise RuntimeError('git %s 失败: %s' % (' '.join(args[:3]),
                                               r.stderr.decode('utf-8', 'replace').strip()))
    return r


def core_py(snap: Path):
    out = {}
    for p in snap.rglob('*.py'):
        rel = p.relative_to(snap)
        if any(part in NOISE_DIRS for part in rel.parts):
            continue
        if rel.name in DENY_NAMES:
            raise RuntimeError('拒绝提交敏感/噪音文件：%s' % rel)
        out[str(rel)] = p
    return out


def blobs_from_ref(repo: Path, ref: str, paths):
    """一次 git cat-file --batch 取回所有 blob 内容，返回 {path: bytes}"""
    listing = git(repo, 'ls-tree', '-r', '-z', ref, '--', SERVER_PREFIX).stdout
    oid_by_rel = {}
    for entry in listing.split(b'\x00'):
        if not entry:
            continue
        meta, _, path = entry.partition(b'\t')
        parts = meta.split()
        if len(parts) != 3 or parts[1] != b'blob':
            continue
        p = path.decode('utf-8', 'replace')
        if not p.startswith(SERVER_PREFIX + '/'):
            continue
        oid_by_rel[p[len(SERVER_PREFIX) + 1:]] = parts[2].decode()

    wanted = [(rel, oid_by_rel[rel]) for rel in paths if rel in oid_by_rel]
    p = subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    p.stdin.write(('\n'.join(oid for _, oid in wanted) + '\n').encode())
    p.stdin.close()
    out = {}
    for rel, oid in wanted:
        header = p.stdout.readline().decode().strip()
        fields = header.split()
        if len(fields) != 3 or fields[1] != 'blob':
            continue
        size = int(fields[2])
        out[rel] = p.stdout.read(size)
        p.stdout.read(1)                       # blob 后的换行
    p.wait()
    return out


def main():
    ap = argparse.ArgumentParser(description='生产源码快照 → git 基线分支（只入库）')
    ap.add_argument('--snap', default=str(DEFAULT_SNAP))
    ap.add_argument('--git-dir', default=str(DEFAULT_GIT_DIR), help='git 仓内任一目录')
    ap.add_argument('--tag', default=None, help='同时打一个时点标签，如 prod-baseline/2026-11-06')
    ap.add_argument('--dry-run', action='store_true', help='只打印将要做什么，不写任何 ref/对象')
    args = ap.parse_args()

    snap, gitdir = Path(args.snap), Path(args.git_dir)
    if not snap.is_dir():
        print('❌ 快照目录不存在：%s' % snap, file=sys.stderr)
        return 1
    if not gitdir.is_dir():
        print('❌ git 仓目录不存在：%s' % gitdir, file=sys.stderr)
        return 1
    repo = Path(git(gitdir, 'rev-parse', '--show-toplevel').stdout.decode().strip())
    files = core_py(snap)

    # 在途改动只报警，绝不处理：并行会话可能正在写这个仓。
    dirty = git(repo, 'status', '--porcelain').stdout.decode(errors='replace').strip()
    print('[check] git 仓：%s' % repo)
    print('[check] 工作树在途改动 %d 条 → %s'
          % (len(dirty.splitlines()) if dirty else 0,
             '⚠️ 有（本脚本用临时索引，不会碰它们）' if dirty else '无'))
    print('[check] 快照核心 .py：%d 个；生产前缀：%s/' % (len(files), SERVER_PREFIX))
    print('[check] 敏感文件护栏：.env / 非 .py 一律排除（DENY_NAMES=%d）' % len(DENY_NAMES))

    old = git(repo, 'rev-parse', '--verify', REF, check=False)
    has_ref = old.returncode == 0
    parent = old.stdout.decode().strip() if has_ref else git(repo, 'rev-parse', 'HEAD').stdout.decode().strip()
    print('[check] 基线父提交：%s（%s）' % (parent[:10], '沿用现有基线' if has_ref else '首次，取当前 HEAD'))
    if args.tag:
        exists = git(repo, 'rev-parse', '--verify', 'refs/tags/' + args.tag, check=False).returncode == 0
        if exists:
            print('❌ 标签已存在，拒绝覆盖：%s' % args.tag, file=sys.stderr)
            return 2

    if args.dry_run:
        print('\n[dry-run] 将覆盖/新增 %d 个 server/*.py，追加 PROD_BASELINE.md，'
              '创建提交并更新 %s；不写对象、不写 ref。' % (len(files), REF))
        print('[dry-run] 变更文件（前 12）：')
        for rel in sorted(files)[:12]:
            print('   ', rel)
        return 0

    ts = dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    note = [
        '# 生产后端源码基线分支',
        '',
        '- 分支：`prod-baseline`（长期分支，每次后端发版后复跑本工具追加一次提交）',
        '- 本次快照：`%s`' % snap,
        '- 入库时间：%s' % ts,
        '- 父提交：`%s`' % parent,
        '- 核心源码文件数：%d' % len(files),
        '',
        '## 这个分支是什么',
        '',
        '生产 `/opt/hergent-erp/` **不是 git 仓**，且长期领先本机 git 仓。'
        '本分支把「线上实际在跑的那份源码」逐字节收进版本库，用来回答'
        '「任取线上端点，能定位到唯一提交」。**它不是部署源，也不是开发主分支。**',
        '',
        '## 三条纪律',
        '',
        '1. 🔴 **严禁拿 git 仓反向覆盖生产** —— 会一次性回退功能并造成交易事故。'
        '方向永远是「生产 → 快照 → 基线提交」。',
        '2. 本分支只在本地，**不要 push**。生产源码含已知安全债，推远端会扩大暴露面。',
        '3. 发版流程：`改生产 → prod-src-diff.py pull → 本工具提交基线 → '
        'prod-src-diff.py compare --ref prod-baseline` 输出 `VERDICT: PASS`。',
        '',
        '## 提交口径',
        '',
        '- 只收核心 `.py`（排除 `__pycache__`/`tests`/`tools`/`migrations`/`scripts`），'
        '与 `prod-src-diff.py` 的比对口径完全一致。',
        '- `.env`、数据库、备份文件、`.DS_Store` 一律不入库（由 `.gitignore` 与脚本护栏双重拦截）。',
        '- 生产根目录的 6 个 `tools_patch_v706*.py` / `tools_v706_*.py` 是一次性运维脚本，'
        '**仅为忠实反映线上而收入基线**，不是现行代码，不要执行、不要往主分支合。',
        '- git 仓 HEAD 里存在而生产快照没有的文件**保留不删**（可能是开发版/在途改动），'
        '但不作为线上依据。',
        '',
        '## 复跑命令',
        '',
        '```bash',
        'cd /Users/zhangjunfeng/Documents/laozhangai-product',
        'python3 .workbuddy/tools/prod-src-diff.py pull',
        'python3 .workbuddy/tools/prod-baseline-commit.py --tag prod-baseline/<日期>',
        'python3 .workbuddy/tools/prod-src-diff.py compare --ref prod-baseline \\',
        '    --snap .workbuddy/stage0/prod-src-latest --out outputs/阶段0-后端纳管比对-基线条.md',
        '```',
        '',
        '> 本文件由 `.workbuddy/tools/prod-baseline-commit.py` 自动生成，请勿手工编辑。',
        '',
    ]
    note_bytes = '\n'.join(note).encode('utf-8')

    idx_fd, idx_path = tempfile.mkstemp(prefix='prod-baseline-index-')
    os.close(idx_fd)
    os.unlink(idx_path)                        # git 要求索引文件不存在或为空
    env = os.environ.copy()
    env['GIT_INDEX_FILE'] = idx_path
    try:
        git(repo, 'read-tree', parent, env=env)
        for rel, p in sorted(files.items()):
            oid = git(repo, 'hash-object', '-w', '--', str(p)).stdout.decode().strip()
            git(repo, 'update-index', '--add', '--cacheinfo', '100644', oid,
                SERVER_PREFIX + '/' + rel, env=env)
        # PROD_BASELINE.md 走 stdin，避免产生临时文件落在仓库里
        oid = git(repo, 'hash-object', '-w', '--stdin', input_bytes=note_bytes).stdout.decode().strip()
        git(repo, 'update-index', '--add', '--cacheinfo', '100644', oid,
            'PROD_BASELINE.md', env=env)
        tree = git(repo, 'write-tree', env=env).stdout.decode().strip()

        msg = [
            'chore(prod-baseline): 以生产快照建立后端源码基线 %s' % dt.datetime.now().strftime('%Y-%m-%d'),
            '',
            '来源快照：%s' % snap,
            '核心源码：%d 个 .py，逐字节来自生产 /opt/hergent-erp/' % len(files),
            '父提交：%s' % parent,
            '',
            '只入库、不部署、不碰生产、不动工作树（临时索引 + git plumbing）。',
            '严禁拿本仓反向覆盖生产。验收：prod-src-diff.py compare --ref prod-baseline',
            '',
        ]
        msg_path = Path(tempfile.mkstemp(prefix='prod-baseline-msg-')[1])
        msg_path.write_text('\n'.join(msg), encoding='utf-8')
        commit = git(repo, 'commit-tree', tree, '-p', parent, '-F', str(msg_path)).stdout.decode().strip()
        msg_path.unlink()

        git(repo, 'update-ref', REF, commit, *( [parent] if has_ref else [] ))
        print('[write] 新提交 %s → %s' % (commit[:10], REF))
        if args.tag:
            git(repo, 'tag', '-a', args.tag, commit, '-m',
                '生产后端源码基线快照 %s' % dt.datetime.now().strftime('%Y-%m-%d'))
            print('[write] 标签 %s → %s' % (args.tag, commit[:10]))
    finally:
        if os.path.exists(idx_path):
            os.unlink(idx_path)

    # 逐文件复核：分支里的 server/*.py 必须与快照逐字节一致
    got = blobs_from_ref(repo, REF, sorted(files))
    bad = [rel for rel in sorted(files)
           if rel not in got or hashlib.md5(got[rel]).hexdigest() != hashlib.md5(files[rel].read_bytes()).hexdigest()]
    print('[verify] 分支内逐字节一致 %d / %d' % (len(files) - len(bad), len(files)))
    for rel in bad[:10]:
        print('   ❌ %s' % rel)
    print('[verify] 当前分支仍为 %s（未 checkout）'
          % git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.decode().strip())
    print('[verify] 未 push；远端引用未改动')
    return 0 if not bad else 2


if __name__ == '__main__':
    sys.exit(main())
