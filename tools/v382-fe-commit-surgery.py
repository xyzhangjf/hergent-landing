#!/usr/bin/env python3
# v382：受控提交前的「blob 手术」—— 把工作区文件里**并行会话**的 2 行深色适配剔掉，
# 得到"只含我本轮改动"的干净版；工作区本身**保持原样不动**（仍是待对方提交的状态）。
#
# 为什么不能整文件提交：那 2 行（.df-role.stopped / .stopped-tag 的硬编码灰 → CSS 变量）
# 是别的会话的在途改动，整文件 add 等于**冒认**。
import pathlib, subprocess, sys, difflib

REPO = pathlib.Path('/Users/zhangjunfeng/Documents/laozhangai-product')
REL  = 'hergent-cn-v2/src/pages/EmployeeArchive.vue'
WORK = REPO / REL
OUT  = pathlib.Path('/tmp/v382-EA.mine.vue')
BAK  = pathlib.Path('/tmp/v382-EA.work.bak')
KEY  = '--st-draft-bg'

def die(msg):
    print('🔴 ' + msg); sys.exit(1)

# ---- 0. 备份工作区（可回退）----
work_txt = WORK.read_text(encoding='utf-8')
BAK.write_text(work_txt, encoding='utf-8')
print(f'[0] 工作区已备份 → {BAK}  ({len(work_txt.encode("utf-8"))} B)')

head_txt = subprocess.run(['git', 'show', f'HEAD:{REL}'], cwd=REPO,
                          capture_output=True, text=True, check=True).stdout
if head_txt.count(KEY) != 0:
    die(f'HEAD 版里已有 {KEY} ⇒ 这几行**早已提交**，手术前提不成立，停手重判。')

# ---- 1. 定位「平行会话的那几行」：工作区有、HEAD 没有，且带 KEY ----
work_lines = work_txt.splitlines()
head_lines = head_txt.splitlines()
head_idx = {l: i for i, l in enumerate(head_lines)}

pairs = []
for wl in work_lines:
    if KEY not in wl:
        continue
    # 找 HEAD 里同选择器的原行（前缀相同、只是颜色写法不同）
    sel = wl.split('{')[0]
    cand = [h for h in head_lines if h.split('{')[0] == sel]
    if len(cand) != 1:
        die(f'选择器 "{sel}" 在 HEAD 里匹配到 {len(cand)} 行（应恰 1）')
    pairs.append((wl, cand[0]))

if len(pairs) != 2:
    die(f'带 {KEY} 的行数 = {len(pairs)}（预期 2）')
print(f'[1] 命中并行会话改动 {len(pairs)} 行：')
for wl, hl in pairs:
    print(f'      work: {wl[:92]}')
    print(f'      HEAD: {hl[:92]}')

# ---- 2. 生成干净版：逐行替换（每处断言 count == 1，防"改了别的地方"）----
clean_txt = work_txt
for wl, hl in pairs:
    n = clean_txt.count(wl)
    if n != 1:
        die(f'工作区里该行出现 {n} 次（应恰 1）⇒ 无法精确手术')
    clean_txt = clean_txt.replace(wl, hl)
OUT.write_text(clean_txt, encoding='utf-8')
print(f'[2] 干净版已生成 → {OUT}')

# ---- 3. 三面自证（缺一即假通过）----
clean_lines = clean_txt.splitlines()
diff2 = list(difflib.unified_diff(clean_lines, work_lines, lineterm='', n=0))
diff2 = [l for l in diff2 if l[:1] in ('+', '-') and not l.startswith(('+++', '---'))]
plus2 = [l for l in diff2 if l.startswith('+')]
minus2 = [l for l in diff2 if l.startswith('-')]
print(f'[3a] 干净版 vs 工作区：+{len(plus2)} -{len(minus2)}（应 +2 -2）')
if len(plus2) != 2 or len(minus2) != 2:
    die('差异不是恰好 2 行 ⇒ 手术动到了别的东西')
# ⚠️ 方向：unified_diff(clean, work) 里 `-` 侧 = clean(=HEAD 的硬编码灰)、`+` 侧 = work(=变量)
if not all(KEY not in l for l in minus2):
    die('`-` 侧（干净版）竟含 KEY ⇒ 方向判错')
if not all(KEY in l for l in plus2):
    die('`+` 侧（工作区）不含 KEY ⇒ 方向判错')

diff1 = list(difflib.unified_diff(head_lines, clean_lines, lineterm='', n=0))
diff1 = [l for l in diff1 if l[:1] in ('+', '-') and not l.startswith(('+++', '---'))]
plus1 = [l for l in diff1 if l.startswith('+')]
bad1 = [l for l in plus1 if KEY in l]
print(f'[3b] 干净版 vs HEAD：{len(diff1)} 处差异，其中新增行含 KEY 的 = {len(bad1)}（应 0）')
if bad1:
    die('干净版相对 HEAD 仍新增了 KEY 行 ⇒ 没剔干净')

c_clean, c_work, c_head = (t.count(KEY) for t in (clean_txt, work_txt, head_txt))
print(f'[3c] KEY 计数： 干净版={c_clean}（应0） 工作区={c_work}（应2） HEAD={c_head}（应0）')
if (c_clean, c_work, c_head) != (0, 2, 0):
    die('计数不符 ⇒ 手术结果不对')

# ---- 4. 自证：干净版确实保留了本轮改动、且旧入口确已删 ----
for must in ('async function saveAll(', 'async function saveEmployeeCore(',
             'async function saveAccRoleCore(', 'async function saveAccScopeCore('):
    if must not in clean_txt:
        die(f'干净版缺少本轮改动：{must}')
for must_not in ('@click="saveAccRole"', '@click="saveAccScope"', '@click="saveEmployee"'):
    if must_not in clean_txt:
        die(f'干净版残留旧入口：{must_not}')
print('[4] 干净版保留本轮全部改动、旧入口已清零 ✅')
print('\n✅ 手术精确无误 —— 可用于临时索引提交（工作区保持原样）')
