#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v206 前端护栏：「侧栏入口按权限隐藏」既要**藏得住**，也要**藏对了**。

事故/缺口的来源
----------------
`payroll` 拆出来之后，没这个模块的角色**看得见「算工资」菜单、点进去 403** ——
入口存在但走不通，用户只会觉得系统坏了。v206 把入口按权限收起来，本脚本验三件事：

  A 形态：store 提供 `perms/loadPerms/canModule`；Shell 两处入口（桌面 + 手机抽屉）
    都挂了 `v-if`；命令面板（⌘⇧K）按 module 过滤（否则「侧栏藏了、快捷键还能跳」）。
  B 语义：**切片真实源码**在 node 里跑 `loadPerms/canModule`，验 4 条不变量：
     ① 未知（null）⇒ 不隐藏（fail-open：一次接口抖动不能把老板菜单藏起来）
     ② `['*']` ⇒ 全放行；`[]` ⇒ **已加载但无任何模块** ⇒ 隐藏（空数组不能被当「未知」）
     ③ **换租户必须重取**（权限表按租户分叉 ⇒ 否则按上一个租户的权限显示菜单）
     ④ 请求失败 ⇒ 退回「未知」，不得把结果写成空数组（那等于失败即全禁）
  C 跨仓一致性：**菜单可见 ⇒ 页面接口有权限** —— 「算工资」页调用的每个接口，
     在后端 `_PATH_MODULE_MAP` 里首个命中的前缀都必须是 `payroll`。
     这条是真正防「点进去 403」的判据（前端藏菜单只是体验，边界在后端）。

切片真实源码（而非重写一份等价实现）是本项目既定要求：复刻件会与源码漂移，
「测试全绿但线上不对」正是那么来的。
"""
import os, re, sys, ast, json, subprocess, tempfile

HOME = os.path.expanduser('~')
FE = os.path.join(HOME, 'Documents', 'laozhangai-product', 'hergent-cn-v2')
BE_SERVER = os.path.join(HOME, 'Documents', 'hergent-erp', 'server')

STORE = os.path.join(FE, 'src', 'store', 'index.js')
SHELL = os.path.join(FE, 'src', 'components', 'Shell.vue')
CMDPAL = os.path.join(FE, 'src', 'components', 'CommandPalette.vue')
FE_API = os.path.join(FE, 'src', 'api', 'modules.js')
BE_SERVER_PY = os.path.join(BE_SERVER, 'server.py')

P, F, NOTES = [], [], []


def ok(name, cond, detail=''):
    (P if cond else F).append(name)
    print(('  PASS  ' if cond else '  FAIL  ') + name + (('   [' + detail + ']') if detail else ''))
    return cond


def sec(t):
    print('\n== ' + t + ' ' + '=' * max(0, 66 - len(t)))


def node_bin():
    for c in [os.environ.get('HERGENT_NODE'),
              os.path.join(HOME, '.workbuddy/binaries/node/versions/22.22.2-3/bin/node'),
              'node']:
        try:
            r = subprocess.run([c, '--version'], capture_output=True, text=True)
            if r.returncode == 0:
                return c
        except Exception:
            continue
    raise RuntimeError('找不到 node')


NODE = node_bin()


# ---------------------------------------------------------------- A 形态
def section_a():
    sec('A 形态：store / 侧栏 / 命令面板三处接线')
    store = open(STORE, encoding='utf-8').read()
    shell = open(SHELL, encoding='utf-8').read()
    cmd = open(CMDPAL, encoding='utf-8').read()

    for s in ('const perms = ref(null)', 'const permsTenant = ref(\'\')',
              'async function loadPerms(force = false) {', 'function canModule(m) {',
              'perms, permsTenant, loadPerms, canModule,'):
        ok('A store :: %s' % s[:46], s in store)

    n_gate = shell.count('v-if="store.canModule(\'payroll\')"')
    ok('A Shell：两处入口都挂了 v-if（桌面 + 手机抽屉）', n_gate == 2, 'count=%d' % n_gate)
    ok('A Shell：不再有无门禁的 /payroll 入口',
       shell.count('to="/payroll"') == n_gate, 'to=/payroll 共 %d 处' % shell.count('to="/payroll"'))
    ok('A Shell：onMounted 里拉权限', 'store.loadPerms()' in shell)

    ok('A 命令面板：payroll 条目带 module 标注', "path: '/payroll', module: 'payroll'" in cmd)
    ok('A 命令面板：过滤用的是同一个 canModule',
       'const pool = COMMANDS.filter(c => !c.module || store.canModule(c.module))' in cmd)
    ok('A 命令面板：关键词过滤作用在**收窄之后**的池子上',
       'const reach = pool' in cmd or 'pool.filter(c => c.title' in cmd)


# ---------------------------------------------------------------- B 语义
def _slice_function(src, header):
    """从源码里切出 `header` 开头的那段函数体（按大括号配平），返回字符串。

    切真实源码、不是在测试里重写一份等价实现 —— 否则测试与源码会各自漂移。
    """
    i = src.index(header)
    j = src.index('{', i)
    depth = 0
    k = j
    while k < len(src):
        if src[k] == '{':
            depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0:
                return src[i:k + 1]
        k += 1
    raise RuntimeError('括号未配平：' + header)


HARNESS = r'''
// ---- 由护栏脚本注入的真实源码切片（不重写、不改写）----
const state = { perms: null, permsTenant: '' };
const auth = { tenant: '1' };
const user = { name: '', role: '' };
let API_LIST = [];
let API_THROW = false;
let API_CALLS = 0;
async function api() {
  API_CALLS++;
  if (API_THROW) throw new Error('boom');
  return { permissions: API_LIST, user: { role: 'accountant' } };
}
const perms = { get value() { return state.perms; }, set value(v) { state.perms = v; } };
const permsTenant = { get value() { return state.permsTenant; }, set value(v) { state.permsTenant = v; } };

__LOADPERMS__
__CANMODULE__

const out = [];
const t = (name, cond, extra) => out.push({ name, pass: !!cond, extra: String(extra) });

(async () => {
  // ① 未知（未加载）⇒ 不隐藏
  t('① 未加载(perms=null) ⇒ canModule 返回 true（fail-open）', canModule('payroll') === true, state.perms);

  // ② 通配与空数组
  state.perms = ['*']; state.permsTenant = '1';
  t('②a 通配 * ⇒ 全放行', canModule('payroll') === true && canModule('hr') === true);
  state.perms = [];
  t('②b 空数组(已加载但无任何模块) ⇒ 隐藏（不得当「未知」）', canModule('payroll') === false);
  state.perms = ['dashboard', 'accounts'];
  t('②c 无 payroll ⇒ 隐藏；有 accounts ⇒ 放行', canModule('payroll') === false && canModule('accounts') === true);

  // ③ 换租户必须重取
  auth.tenant = '1'; API_LIST = ['payroll']; API_CALLS = 0;
  state.perms = null; state.permsTenant = '';
  await loadPerms();
  t('③a 首次拉取落 permsTenant=当前租户', state.permsTenant === '1' && canModule('payroll') === true, state.permsTenant);
  API_CALLS = 0;
  await loadPerms();
  t('③b 同租户重复调用**不重复请求**（幂等）', API_CALLS === 0, API_CALLS);
  auth.tenant = '10'; API_LIST = ['dashboard'];
  await loadPerms();
  t('③c 换租户后**必须重取**（否则按上个租户的权限显示菜单）',
    API_CALLS === 1 && state.permsTenant === '10' && canModule('payroll') === false,
    'calls=' + API_CALLS + ' perms=' + JSON.stringify(state.perms));

  // ④ 失败 ⇒ 退回「未知」，不得写成空数组
  API_THROW = true;
  await loadPerms(true);
  t('④ 请求失败 ⇒ perms 回到 null、canModule 为 true（失败≠全禁）',
    state.perms === null && canModule('payroll') === true, state.perms);

  console.log('@@RESULT@@' + JSON.stringify(out));
})();
'''


def section_b():
    sec('B 语义：切片真实源码在 node 里跑（4 条不变量）')
    src = open(STORE, encoding='utf-8').read()
    load = _slice_function(src, 'async function loadPerms(')
    canm = _slice_function(src, 'function canModule(')
    js = HARNESS.replace('__LOADPERMS__', load).replace('__CANMODULE__', canm)
    d = tempfile.mkdtemp(prefix='v206_fe_')
    p = os.path.join(d, 'probe.mjs')
    open(p, 'w', encoding='utf-8').write(js)
    try:
        r = subprocess.run([NODE, p], capture_output=True, text=True, timeout=60)
        line = ''
        for ln in (r.stdout or '').splitlines():
            if ln.startswith('@@RESULT@@'):
                line = ln[len('@@RESULT@@'):]
        if not line:
            print(r.stdout[-1200:]); print(r.stderr[-1200:])
            ok('B 探针产出结果', False, '未产出（见上方输出）')
            return
        for item in json.loads(line):
            ok('B ' + item['name'], item['pass'], item['extra'])
    finally:
        try:
            import shutil
            shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------- C 跨仓一致性
def _frontend_api_paths():
    """从 `src/api/modules.js` 的 payrollApi / adviceApi 里取出**字面量**接口路径。"""
    src = open(FE_API, encoding='utf-8').read()
    paths = []
    for key in ('payrollApi', 'adviceApi'):
        i = src.index('export const %s = {' % key)
        j = src.index('\n}', i)
        block = src[i:j]
        for m in re.finditer(r"api\(\s*[`'\"](/api/[^`'\"?$]*)", block):
            paths.append(m.group(1))
        # 带模板串的（如 `/api/payroll-workflow/history?month=`）也要收
        for m in re.finditer(r"api\(\s*`(/api/[^`]*)`", block):
            base = m.group(1).split('?')[0].split('$')[0]
            paths.append(base)
    return sorted(set(paths))


def _backend_path_map():
    """读 `_PATH_MODULE_MAP` 字面量，**保持顺序**（顺序即优先级，首个 startswith 命中即停）。"""
    src = open(BE_SERVER_PY, encoding='utf-8').read()
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == '_PATH_MODULE_MAP':
                    return [(k.value, v.value) for k, v in zip(node.value.keys, node.value.values)]
    raise RuntimeError('未找到 _PATH_MODULE_MAP')


def section_c():
    sec('C 跨仓一致性：菜单可见 ⇒ 页面接口有权限')
    fe_paths = _frontend_api_paths()
    pmap = _backend_path_map()
    ok('C0 取到算工资页的接口清单', len(fe_paths) >= 5, ','.join(fe_paths))
    if not fe_paths:
        return
    bad = []
    for p in fe_paths:
        hit = next((mod for pref, mod in pmap if p.startswith(pref)), None)
        if hit != 'payroll':
            bad.append('%s → %s' % (p, hit))
    ok('C1 每个算工资接口的首个命中模块都是 payroll（否则菜单可见但页面 403）',
       not bad, '; '.join(bad) if bad else '%d 个路径全部命中 payroll' % len(fe_paths))
    # 反向对照：证明「首个命中」判定真的会区分 —— 拿一个必然走 hr 的路径喂进去必须报错
    probe = next((mod for pref, mod in pmap if '/api/employees'.startswith(pref)), None)
    ok('C2 对照：/api/employees 命中的是 hr 而不是 payroll（证明 C1 不是恒真）',
       probe == 'hr', 'probe=%s' % probe)
    # 相邻优先级：/api/payroll/bank-file 必须排在 /api/payroll 之前
    keys = [k for k, _ in pmap]
    if '/api/payroll/bank-file' in keys and '/api/payroll' in keys:
        ok('C3 /api/payroll/bank-file 排在 /api/payroll **之前**（顺序即优先级）',
           keys.index('/api/payroll/bank-file') < keys.index('/api/payroll'))
    else:
        ok('C3 bank-file 与 payroll 两条前缀都在映射表里', False, '缺一条')


def main():
    print('v206 前端护栏 —— 侧栏入口按权限隐藏')
    print('前端: %s' % FE)
    print('后端: %s' % BE_SERVER)
    for fn in (section_a, section_b, section_c):
        try:
            fn()
        except Exception as e:
            ok('%s 段异常' % fn.__name__, False, repr(e)[:200])
    print('\n' + '=' * 72)
    print('通过 %d / 失败 %d' % (len(P), len(F)))
    if F:
        print('失败项：')
        for x in F:
            print('  - ' + x)
    return 1 if F else 0


if __name__ == '__main__':
    sys.exit(main())
