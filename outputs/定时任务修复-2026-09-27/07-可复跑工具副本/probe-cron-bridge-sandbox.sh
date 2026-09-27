#!/bin/bash
# 探针：验证「hergent-erp.service 的 ProtectHome=true 让 /root 变成空 tmpfs」
# 是 /api/cron/jobs 报 EROFS 的唯一原因，并验证 BindPaths=/root/.hermes 能解。
#
# 判别设计（正反两侧都要）：
#   ① 复刻当前 drop-in（ProtectHome=true，无 BindPaths） ⇒ 期望**复现** EROFS/traceback
#   ② 加上 BindPaths=/root/.hermes ⇒ 期望 ok:true + 真实 jobs
#   ③ ls /root 对照 ⇒ 证明只暴露这一棵子树（其余仍是空的），不是把整个 /root 放开
# 只读：绝不写任何生产文件（systemd-run --collect 跑完即销毁临时 unit）。
set -u

BRIDGE=/usr/local/lib/hermes-agent/hermes_cron_bridge.py
ERPPY=/usr/bin/python3

run() { # run <unit> <额外 -p 参数...> -- <cmd...>
  local unit="$1"; shift
  systemd-run --unit="$unit" --collect --wait --pipe -q \
    -p User=hergent -p Group=hergent \
    -p ProtectSystem=full -p PrivateTmp=true -p NoNewPrivileges=true \
    "$@" 2>&1 | head -c 1200
}

echo "==================== ① 当前状态：ProtectHome=true，无 BindPaths ===================="
run cron-probe-nobind -p ProtectHome=true -- "$BRIDGE" list
echo

echo "==================== ② 修复候选：ProtectHome=true + BindPaths=/root/.hermes ===================="
run cron-probe-bind -p ProtectHome=true -p BindPaths=/root/.hermes -- "$BRIDGE" list
echo

echo "==================== ③ 暴露面对照：BindPaths 后 /root 里还剩什么 ===================="
echo "--- 3a 当前（ProtectHome=true）---"
run cron-probe-ls-a -p ProtectHome=true -- /bin/ls -a /root
echo "--- 3b 加 BindPaths 后 ---"
run cron-probe-ls-b -p ProtectHome=true -p BindPaths=/root/.hermes -- /bin/ls -a /root
echo

echo "==================== ④ 只读性确认：hergent 能读 jobs.json 吗 ===================="
run cron-probe-read -p ProtectHome=true -p BindPaths=/root/.hermes -- /bin/ls -l /root/.hermes/cron
echo

echo "==================== ⑤ 对照：SSH 交互 shell（无沙箱）同一命令 ===================="
"$BRIDGE" list 2>&1 | head -c 300
echo
echo "==================== 探针结束 ===================="
