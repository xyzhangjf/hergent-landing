#!/usr/bin/env python3
# v382：对 saveAll 的**编排约束**做源码级断言。
# 为什么不是 DOM 断言：本轮要证的是"一次点击能否把原来三段存完、且顺序/失败语义正确"，
# 那是编排逻辑，只有读源码才能逐条验；单纯看按钮数量证明不了功能等价。
import re, sys, pathlib

P = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                 'hergent-cn-v2/src/pages/EmployeeArchive.vue')
src = P.read_text(encoding='utf-8')
lines = src.splitlines()

# 抽出 saveAll 函数体（从 `async function saveAll(` 到与之配对的 `}`）
start = next(i for i, l in enumerate(lines) if l.startswith('async function saveAll('))
depth = 0
body = []
for l in lines[start:]:
    body.append(l)
    depth += l.count('{') - l.count('}')
    if depth == 0 and len(body) > 1:
        break
fn = '\n'.join(body)

fails, passes = [], []
def ck(cond, msg):
    (passes if cond else fails).append(msg)

def idx(pat):
    m = re.search(pat, fn)
    return m.start() if m else -1

# --- ① 三步都存在，且顺序固定：基本信息 → 角色 → 可登录端 ---
i_basic = idx(r'await saveEmployeeCore\(\)')
i_role  = idx(r'await saveAccRoleCore\(')
i_scope = idx(r'await saveAccScopeCore\(')
ck(i_basic >= 0, '① 调用了 saveEmployeeCore()（基本信息）')
ck(i_role  >= 0, '① 调用了 saveAccRoleCore()（角色/兼任）')
ck(i_scope >= 0, '① 调用了 saveAccScopeCore()（可登录端）')
ck(0 <= i_basic < i_role < i_scope,
   f'① 顺序正确（基本信息@{i_basic} < 角色@{i_role} < 可登录端@{i_scope}）'
   if 0 <= i_basic < i_role < i_scope else
   f'🔴 ① 顺序错误：基本信息@{i_basic} / 角色@{i_role} / 可登录端@{i_scope}')

# --- ② 快照必须在第一次写库之前（否则编辑态被刷新覆盖 = 静默丢改动）---
i_snap = idx(r'const snap = \{')
ck(0 <= i_snap < i_basic, f'② 快照在首次写库之前（snap@{i_snap} < basic@{i_basic}）'
   if 0 <= i_snap < i_basic else f'🔴 ② 快照位置错：snap@{i_snap} vs basic@{i_basic}')

# --- ③ 快照里必须含四项：role / roles / scope / roleDirty / scopeDirty ---
for k in ('role:', 'roles:', 'scope:', 'roleDirty:', 'scopeDirty:'):
    ck(k in fn, f"③ 快照含 {k}")

# --- ④ 角色步骤必须传"用户是否自己改了端"这个开关（否则对齐会覆盖用户选择）---
ck(re.search(r'saveAccRoleCore\(snap\.role,\s*snap\.roles,\s*!snap\.scopeDirty\)', fn) is not None,
   '④ saveAccRoleCore 第三参 = !snap.scopeDirty（用户显式改端时不问对齐）')

# --- ⑤ 可登录端步骤必须带 !scopeHandled 去重（避免重复写一遍）---
ck(re.search(r'if \(canAcc && snap\.scopeDirty && !scopeHandled\)', fn) is not None,
   '⑤ 可登录端步骤带 !scopeHandled 去重')

# --- ⑥ 失败即停：三个 ok 检查都在（且都是 return，不关窗）---
ck(re.search(r'if \(!r1\.ok\)\s*return', fn) is not None, '⑥ 基本信息失败 ⇒ return')
ck(re.search(r'if \(!r2\.ok\)\s*return', fn) is not None, '⑥ 角色失败 ⇒ return')
ck(re.search(r'if \(!r3\.ok\)\s*return', fn) is not None, '⑥ 可登录端失败 ⇒ return')

# --- ⑦ 新建分支：创建成功即收工（与原行为一致：留在弹窗以便开账号）---
ck(re.search(r'if \(r1\.created\)\s*return', fn) is not None, '⑦ created=true ⇒ 本轮收工')

# --- ⑧ 关窗必须是最后一步（在刷新与 pending 检查之后）---
i_close  = idx(r'editOpen\.value = false')
i_load   = idx(r'await loadEmployees\(\)')
i_pend   = idx(r'const pending = nameDirty')
ck(i_load >= 0 and i_close >= 0 and i_load < i_close, '⑧ 先刷新再关窗')
ck(i_pend >= 0 and i_pend < i_close, '⑧ pending 检查在关窗之前（独立动作不会被丢）')

# --- ⑨ 全弹窗只有一个保存入口；三个旧入口不复存在 ---
n_saveall = src.count('@click="saveAll"')
ck(n_saveall == 1, f'⑨ 模板里 saveAll 入口恰 1 个（实测 {n_saveall}）')
for old in ('@click="saveAccRole"', '@click="saveAccScope"', '@click="saveEmployee"'):
    ck(old not in src, f'⑨ 旧入口已删：{old}')
for old_fn in ('function saveEmployee(', 'function saveAccRole(', 'function saveAccScope('):
    ck(old_fn not in src, f'⑨ 旧函数已删：{old_fn}')

# --- ⑩ 无 data/update 权限时，三块账号控件整行隐藏（避免"看得见存不了"）---
# ⚠️ 计数必须与断言用**同一个表达式**：先前消息里用手拼字符串，算出 2 而断言是 3，
#    出现"显示 2 却判 PASS"的自相矛盾 —— 这类"证据自身不一致"比判错更危险。
GATE = """v-if="canDo('data', 'update')" class="df-acc-row"""
n_gate = src.count(GATE)
ck(n_gate == 3, f'⑩ 角色 / 可登录端 / 兼任 三行都挂同轴门禁（实测 {n_gate}，应 3）')

print(f"源码级编排断言：{len(passes)} PASS / {len(fails)} FAIL\n")
for m in passes:
    print('  ✅', m)
for m in fails:
    print('  🔴', m)
sys.exit(1 if fails else 0)
