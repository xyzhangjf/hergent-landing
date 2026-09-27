#!/usr/bin/env python3
"""dist 差集核查 · 第①层 —— 「去 hash 基名配对字节数」。

🔴 为什么需要这一层（它比 md5 更能说明问题）：
   Vite 产物名 = `页面-<内容hash>.js`。**只要有任何一处改动，hash 就会变**，
   于是一堆文件名看起来「全变了」—— 但绝大多数只是**名字变、内容没变**（增量级联：
   Vue SFC 的 `data-v-*` scopeId 由**文件源码内容**派生，改一处注释就能级联改掉
   几乎所有 chunk 名，见 memory/topics/deploy-ops.md）。
   ⇒ 「名字变了」不能当「内容变了」的证据，**必须按去 hash 的基名配对、比字节数**。

判据：
   · 两个目录的「去 hash 基名集合」必须**完全相等** —— 否则意味 chunk 被新增/删除，
     不是单纯的重命名（最常见的原因：有人往 `src/` 里加了新模块，或者路由动了）。
   · 同名基名的字节数**允许不同**（那正是本次改动）—— 但要逐个人工归因。
     字节数「**全都相同**」也是信号：说明这次构建与上次**只差文件名**
     （典型成因 = 只改了注释 / scopeId 变动），此时部署与否对用户**零影响**。

用法：
   python3 .workbuddy/tools/dist-pair-check.py <基准dist目录> <对比dist目录>
   # 例：python3 .workbuddy/tools/dist-pair-check.py /tmp/pre_dist hergent-cn-v2/dist

退出码：0 = 基名集合一致；1 = 有 chunk 新增/删除（需人工确认）。
"""
import hashlib
import os
import re
import sys

HASH_RE = re.compile(r'-([A-Za-z0-9_-]{8})(\.[A-Za-z0-9]+)$')


def scan(d):
    """{ 去hash基名: [(原名, 字节数, md5), ...] }  —— 同基名可能有多份（不同 hash 并存）"""
    out = {}
    root = os.path.join(d, 'assets')
    if not os.path.isdir(root):
        root = d
    for name in sorted(os.listdir(root)):
        p = os.path.join(root, name)
        if not os.path.isfile(p):
            continue
        base = HASH_RE.sub(r'\2', name)
        with open(p, 'rb') as f:
            data = f.read()
        out.setdefault(base, []).append((name, len(data), hashlib.md5(data).hexdigest()))
    return out


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    a_dir, b_dir = sys.argv[1], sys.argv[2]
    A, B = scan(a_dir), scan(b_dir)

    ka, kb = set(A), set(B)
    only_a, only_b = sorted(ka - kb), sorted(kb - ka)
    common = sorted(ka & kb)

    print('基准 %s：%d 个文件 / %d 个去hash基名' % (a_dir, sum(len(v) for v in A.values()), len(A)))
    print('对比 %s：%d 个文件 / %d 个去hash基名' % (b_dir, sum(len(v) for v in B.values()), len(B)))

    if only_a:
        print('\n⚠️ 仅基准有（= 对比目录里**删掉了**这些 chunk）：')
        for k in only_a:
            for n, sz, _ in A[k]:
                print('   - %s  (%d B)' % (n, sz))
    if only_b:
        print('\n⚠️ 仅对比有（= 对比目录里**新增了**这些 chunk）：')
        for k in only_b:
            for n, sz, _ in B[k]:
                print('   + %s  (%d B)' % (n, sz))
    if not only_a and not only_b:
        print('\n✅ 去hash基名集合完全一致（无 chunk 新增/删除 —— 只有重命名）')

    same, diff = [], []
    for k in common:
        a0, b0 = A[k][0], B[k][0]
        (same if a0[1] == b0[1] else diff).append((k, a0, b0))

    print('\n--- 字节数相同的基名：%d 个（名字变了、内容长度没变） ---' % len(same))
    for k, a0, b0 in same:
        tag = 'md5同' if a0[2] == b0[2] else 'md5异'
        print('   = %-34s %7d B  %s→%s  [%s]' % (k, a0[1], a0[0], b0[0], tag))
    if len(same) == len(common):
        print('   ⚠️ 全部相同 ⇒ 本次构建与基准**只差文件名**（典型成因：只改了注释/scopeId）。')

    print('\n--- 字节数不同的基名：%d 个（= 本次真实内容改动，逐个归因） ---' % len(diff))
    for k, a0, b0 in diff:
        print('   ≠ %-34s %7d → %7d B  (Δ%+d)  %s' % (k, a0[1], b0[1], b0[1] - a0[1], b0[0]))

    sys.exit(1 if (only_a or only_b) else 0)


if __name__ == '__main__':
    main()
