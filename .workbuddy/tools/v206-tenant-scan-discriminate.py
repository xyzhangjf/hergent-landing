#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v206 判别力自证：`v206-tenant-scan-check.py` 是否真有牙齿。

做法（与上一轮同一范式）：对后端源码做**一份副本**，在副本上**每次只破坏一处**，
用同一个护栏脚本跑它，要求**必须 FAIL**，且失败项要**恰好指向**那一处。
跑不 FAIL 的破坏 = 护栏对这件事没有判别力（假绿灯）；修正则脚本报错，不会静默放过。

为什么必须做这一步：护栏全绿有两种可能 —— ① 代码真的对；② **护栏根本没在看**。
只有「破坏一处就红」才能把②排除掉。本轮首版护栏就在这里抓出过两个自己写的假断言
（B7 夹具退化成 0 字节、C3 把正确的「跳过留痕」误判成失败）。
"""
import os, re, sys, shutil, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK = os.path.join(HERE, 'v206-tenant-scan-check.py')
HOME = os.path.expanduser('~')
REAL_SERVER = os.path.join(HOME, 'Documents', 'hergent-erp', 'server')


def _pick_python():
    for c in [os.environ.get('HERGENT_PY'),
              os.path.join(HOME, '.workbuddy/binaries/python/envs/default/bin/python'),
              sys.executable, '/usr/bin/python3']:
        if c and os.path.exists(c):
            r = subprocess.run([c, '-c', 'import cryptography, fastapi'],
                               capture_output=True, text=True)
            if r.returncode == 0:
                return c
    raise RuntimeError('找不到能 import erp_db 依赖的解释器')


PYBIN = _pick_python()

# ---------------------------------------------------------------- 破坏清单
# 每项： (标题, 文件, 原文, 替换, 期望失败项里必须出现的子串)
BREAKS = [
    # ① 注：0 字节文件**天然也没有表** ⇒「空文件」与「不含任何表」两条判据对它互为冗余，
    #    破坏一条仍拦得住文件，但**跳过原因**会变得无法一眼诊断 —— 这正是 B2 在测的东西。
    ("① 删掉「0 字节即空壳」这条判据（丢掉可直接诊断的跳过原因）",
     'erp_db.py',
     "        if os.path.getsize(path) <= 0:\n            return False, \"空文件(0 字节)\"",
     "        if False:\n            return False, \"空文件(0 字节)\"",
     ["B2"]),

    ("② 删掉「必须在租户登记表内」这条判据",
     'erp_db.py',
     "            if tid in registry:\n                ids.append(tid)",
     "            if True:\n                ids.append(tid)",
     ["B1", "B3"]),

    ("③ 调度器退回「按文件名 glob 枚举租户」",
     'scheduler.py',
     "        return db.list_tenant_db_ids(registered_only=True)",
     ("        import glob as _g, re as _r, os as _o\n"
      "        _base = _o.path.dirname(db.DB_PATH)\n"
      "        _ids = set()\n"
      "        for _f in _g.glob(_o.path.join(_base, \"tenant_*.db\")):\n"
      "            _m = _r.fullmatch(r\"tenant_(\\d+)\\.db\", _o.path.basename(_f))\n"
      "            if _m and int(_m.group(1)) > 0:\n"
      "                _ids.add(int(_m.group(1)))\n"
      "        return sorted(_ids)"),
     ["F scheduler.py::_tenant_ids", "E present scheduler.py"]),

    ("④ 去掉「不给未登记租户建库」闸门",
     'db/connection.py',
     "    if _tenant_registered(tenant_id) is False:",
     "    if False:",
     ["D2", "D3"]),

    ("⑤ 回填/迁移循环退回裸 glob（绕过结构校验）",
     'erp_db.py',
     "    for path in iter_tenant_db_paths():",
     "    for path in sorted(glob.glob(os.path.join(DB_DIR, \"tenant_*.db\"))):",
     ["A2", "E gone    erp_db.py"]),

    ("⑥ 跳过时不再留痕（静默跳过 = 把事故伪装成正常）",
     'erp_db.py',
     "    if skipped:\n        # 一条汇总 + 逐条明细",
     "    if False:\n        # 一条汇总 + 逐条明细",
     ["B12", "G3b"]),

    ("⑦ 登记表为空时 fail-closed（全体租户定时推送静默停摆）",
     'erp_db.py',
     "            if total == 0 and struct:",
     "            if False:",
     ["C[存在但一行都没有]"]),

    ("⑧ 删掉「不含任何表」判据（空库被当租户库）",
     'erp_db.py',
     ("        row = con.execute(\n"
      "            \"SELECT COUNT(*) FROM sqlite_master WHERE type='table'\").fetchone()\n"
      "        if not row or int(row[0]) <= 0:\n"
      "            return False, \"不含任何表（不是库文件）\""),
     ("        row = con.execute(\n"
      "            \"SELECT COUNT(*) FROM sqlite_master WHERE type='table'\").fetchone()\n"
      "        if False:\n"
      "            return False, \"不含任何表（不是库文件）\""),
     ["B7"]),

    ("⑨ `iter_tenant_db_paths` 内部改用裸 glob（权威实现被架空）",
     'erp_db.py',
     ("    return [os.path.join(DB_DIR, \"tenant_%d.db\" % tid)\n"
      "            for tid in list_tenant_db_ids(registered_only=registered_only,\n"
      "                                          active_only=active_only)]"),
     ("    import glob as _gg\n"
      "    return sorted(_gg.glob(os.path.join(DB_DIR, \"tenant_*.db\")))"),
     ["A2", "B1"]),

    ("⑩ 去掉「同一次启动内只告警一次」的去重（一次启动刷 10 行相同告警）",
     'erp_db.py',
     ("        _sig = tuple(sorted((s[\"file\"], s[\"reason\"]) for s in skipped))\n"
      "        if _sig not in _TENANT_SCAN_WARNED:\n"
      "            _TENANT_SCAN_WARNED.add(_sig)\n"
      "            logger.warning("),
     ("        _sig = tuple(sorted((s[\"file\"], s[\"reason\"]) for s in skipped))\n"
      "        if True:\n"
      "            _TENANT_SCAN_WARNED.add(_sig)\n"
      "            logger.warning("),
     ["B13"]),
]


def make_shadow():
    """造源码副本：排除数据库与缓存（另用符号链接补上两个模板库）。"""
    d = tempfile.mkdtemp(prefix='v206_disc_')
    shadow = os.path.join(d, 'server')
    shutil.copytree(REAL_SERVER, shadow,
                    ignore=shutil.ignore_patterns('*.db', '*.db-wal', '*.db-shm',
                                                  '*.db-journal', '__pycache__', '.git'))
    for tpl in ('erp.db', 'tenant_2.db'):
        src = os.path.join(REAL_SERVER, tpl)
        if os.path.exists(src):
            dst = os.path.join(shadow, tpl)
            if not os.path.exists(dst):
                os.symlink(src, dst)
    return d, shadow


def run_check(server_dir):
    env = dict(os.environ)
    env['HERGENT_SERVER'] = server_dir
    r = subprocess.run([PYBIN, CHECK], capture_output=True, text=True, env=env, timeout=900)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def main():
    print('v206 判别力自证 —— 每次只破坏一处，护栏必须 FAIL 且失败项指向该处')
    print('真源码: %s' % REAL_SERVER)
    print('')
    bad = 0
    for title, relpath, old, new, expect in BREAKS:
        d, shadow = make_shadow()
        try:
            p = os.path.join(shadow, relpath)
            src = open(p, encoding='utf-8').read()
            if src.count(old) != 1:
                print('  ERROR 破坏点未唯一命中：%s :: %s（命中 %d 次）'
                      % (relpath, old.splitlines()[0][:60], src.count(old)))
                bad += 1
                continue
            open(p, 'w', encoding='utf-8').write(src.replace(old, new))
            code, out = run_check(shadow)
            fails = [l.strip()[len('FAIL  '):] for l in out.splitlines()
                     if l.strip().startswith('FAIL')]
            hit = [e for e in expect if any(e in f for f in fails)]
            passed = (code != 0) and len(hit) == len(expect)
            print('  %s %s' % ('PASS  ' if passed else 'ERROR ', title))
            print('         期望命中 %d/%d：%s' % (len(hit), len(expect), expect))
            if not passed:
                bad += 1
                print('         实际 FAIL 项：%s' % (fails[:6] or '（无 —— 护栏没抓到！）'))
        finally:
            shutil.rmtree(d, ignore_errors=True)
    print('')
    print('=' * 72)
    print('判别力自证：%d 项破坏，%d 项未被抓出' % (len(BREAKS), bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
