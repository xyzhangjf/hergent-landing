import hashlib, os, shutil, subprocess, sys, tempfile
P = 'src/components/CopilotDrawer.vue'
# 备份放系统临时目录：别在仓库里留 .bak（会被 git status 当未跟踪文件）
BAK = os.path.join(tempfile.mkdtemp(prefix='hg-v664-'), 'drawer.bak')
shutil.copy2(P, BAK)
orig = open(BAK, encoding='utf-8').read()
before = hashlib.md5(orig.encode()).hexdigest()

# 注入回历史面板那个按钮（模拟"回潮"）
anchor = '            <b>历史会话</b>'
assert orig.count(anchor) == 1, '锚点不唯一'
bad = orig.replace(anchor, anchor + '\n            <button class="btn btn-primary btn-sm" @click="newSession">＋ 新对话</button>')
open(P, 'w', encoding='utf-8').write(bad)
r = subprocess.run(['node', 'tests/copilot-newchat.contract.mjs'], capture_output=True, text=True)
print('注入后 exit =', r.returncode)
for ln in r.stdout.splitlines():
    if '❌' in ln or ln.startswith('FAILED') or ln == 'PASS':
        print('  ', ln.strip())

shutil.copy2(BAK, P)
after = hashlib.md5(open(P, encoding='utf-8').read().encode()).hexdigest()
print('恢复 md5 一致:', before == after, before[:12], after[:12])
print('判别力自证:', 'PASS' if r.returncode == 1 else 'FAIL —— 测试抓不到回潮')
sys.exit(0 if r.returncode == 1 and before == after else 1)
