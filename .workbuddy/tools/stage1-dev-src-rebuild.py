#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 开发副本（dev-src）重建 / 自证工具

🔴 为什么需要它
--------------
`.workbuddy/stage1/dev-src/` 是「生产快照 + 阶段 1 补丁」的展开形态。本仓**只入库**
新增内核与补丁，**不入库**整份生产源码（`erp_db.py` 1.4MB / `sync_writer.py` /
`domain/wastage_tracker.py`）—— 否则这个前端+落地页仓里会长出「第二套后端源码」，
与「后端唯一源是 `~/Documents/hergent-erp`」的纪律相冲突。

所以换机器 / 清目录后，dev-src 由本脚本从两样东西重建：

    生产快照 .workbuddy/stage0/prod-src-20261106/
  + 累积补丁 .workbuddy/stage1/patches/stock-movement-convergence.patch
  = dev-src（可与入库版本逐字节比对）

用法
----
    # 自证：重建到临时目录，与现有 dev-src 逐字节比对，不写 dev-src
    /usr/bin/python3 .workbuddy/tools/stage1-dev-src-rebuild.py --check

    # 真重建（会覆盖 dev-src 里对应文件；先备份原文件）
    /usr/bin/python3 .workbuddy/tools/stage1-dev-src-rebuild.py --out .workbuddy/stage1/dev-src

退出码：0 = 一致 / 重建成功；2 = 比对不一致或步骤失败。
"""
import argparse
import filecmp
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAP = ROOT / '.workbuddy/stage0/prod-src-20261106'
PATCH = ROOT / '.workbuddy/stage1/patches/stock-movement-convergence.patch'
DEV = ROOT / '.workbuddy/stage1/dev-src'

# 补丁涉及的文件（相对 server/）。新增文件不在快照里，由补丁创建。
PATCHED = [
    'erp_db.py',
    'sync_writer.py',
    'domain/wastage_tracker.py',
    'db/queries/inventory.py',
    'db/queries/purchases.py',
]
CREATED = ['db/queries/stock_movement.py']


def rebuild(dst: Path):
    """把快照里的被改文件拷到 dst，再在 dst 里应用累积补丁。"""
    if not SNAP.is_dir():
        raise SystemExit('❌ 缺少生产快照：%s（先从线上回拉，见 prod-src-diff.py pull）' % SNAP)
    if not PATCH.is_file():
        raise SystemExit('❌ 缺少累积补丁：%s' % PATCH)
    for rel in PATCHED:
        src = SNAP / rel
        if not src.is_file():
            raise SystemExit('❌ 快照里缺文件：%s' % rel)
        d = dst / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, d)
    r = subprocess.run(['patch', '-p1', '--batch', '-f', '-i', str(PATCH)],
                       cwd=str(dst), capture_output=True, text=True,
                       stdin=subprocess.DEVNULL, timeout=120)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        raise SystemExit('❌ 补丁应用失败 rc=%s' % r.returncode)
    # 语法自检：重建出来的必须是可编译的 Python
    for rel in PATCHED + CREATED:
        p = dst / rel
        if not p.is_file():
            raise SystemExit('❌ 重建后缺文件：%s' % rel)
        try:
            compile(p.read_text(encoding='utf-8'), str(p), 'exec')
        except SyntaxError as e:
            raise SystemExit('❌ 重建后语法错误 %s：%s' % (rel, e))


def compare(a: Path, b: Path):
    """逐个文件比对 a（重建结果）与 b（现有 dev-src）。"""
    bad = []
    for rel in PATCHED + CREATED:
        pa, pb = a / rel, b / rel
        if not pb.is_file():
            bad.append((rel, 'dev-src 缺此文件'))
        elif not filecmp.cmp(str(pa), str(pb), shallow=False):
            bad.append((rel, '内容不一致'))
        else:
            print('  ✅ %s' % rel)
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='重建到临时目录并与现有 dev-src 比对，不写入 dev-src')
    ap.add_argument('--out', default=None, help='重建目标目录（默认 dev-src）')
    args = ap.parse_args()

    if args.check:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            rebuild(tmp)
            print('重建完成（临时目录），开始比对：')
            bad = compare(tmp, DEV)
            if bad:
                print('\n🔴 自证失败：')
                for rel, why in bad:
                    print('   - %s：%s' % (rel, why))
                print('\n⇒ 说明补丁与 dev-src 不同步：要么 dev-src 有未进补丁的改动，')
                print('   要么补丁没重新生成。先重新生成补丁再跑本自证。')
                return 2
            print('\n✅ 自证通过：合计 %d/%d 通过（「生产快照 + 累积补丁」逐字节等于 dev-src）'
                  % (len(PATCHED) + len(CREATED), len(PATCHED) + len(CREATED)))
            return 0

    dst = Path(args.out) if args.out else DEV
    dst.mkdir(parents=True, exist_ok=True)
    rebuild(dst)
    print('✅ 已重建到 %s' % dst)
    return 0


if __name__ == '__main__':
    sys.exit(main())
