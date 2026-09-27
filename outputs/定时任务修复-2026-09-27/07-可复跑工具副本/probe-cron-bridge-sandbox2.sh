#!/bin/bash
# 第二轮探针：1:1 复刻 hergent-erp.service 的沙箱（含 sudo -u root 路径），
# 找出「既不关掉 ProtectHome，又能让 bridge 读到 /root/.hermes」的组合。
#
# 背景（第一轮已证）：
#   · ProtectHome=true ⇒ /root 被挂成 **mode 700 的空 tmpfs**（root 自己都进不去）
#   · sudo/exec **不会**重置 systemd 的挂载命名空间 ⇒ 从服务里 sudo -u root 也穿不过
#   · 因此 `BindPaths=/root/.hermes` **无效**（到达它必须先穿过 mode-700 的 /root）
#
# 候选：ProtectHome=read-only（保留真实 /root 与它的 traverse 位 x）
#       ＋ ReadWritePaths=/root/.hermes（把 cron 子树重新放成可写）
set -u
BRIDGE=/usr/local/lib/hermes-agent/hermes_cron_bridge.py
BASE=(-p User=hergent -p Group=hergent -p ProtectSystem=full -p PrivateTmp=true -p NoNewPrivileges=false -p UMask=0007)
RW_BASE=(-p ReadWritePaths=/opt/hergent-erp -p ReadWritePaths=/opt/hermes-tenants)

probe() {
  local unit="$1"; shift
  systemd-run --unit="$unit" --collect --wait --pipe -q "${BASE[@]}" "$@" 2>&1 | head -c 900
}

echo "===== A 现状复刻：ProtectHome=true ＋ sudo -u root ====="
probe cron-p2-a -p ProtectHome=true "${RW_BASE[@]}" sudo -u root "$BRIDGE" list
echo
echo "===== B 候选：ProtectHome=read-only ＋ ReadWritePaths=/root/.hermes ＋ sudo -u root ====="
probe cron-p2-b -p ProtectHome=read-only "${RW_BASE[@]}" -p ReadWritePaths=/root/.hermes sudo -u root "$BRIDGE" list
echo
echo "===== C 可写性硬证：在自有 cron 目录里 touch 再删（瞬时、无残留）====="
probe cron-p2-c -p ProtectHome=read-only "${RW_BASE[@]}" -p ReadWritePaths=/root/.hermes \
  /bin/sh -c 'touch /root/.hermes/cron/.wprobe && echo WRITABLE && rm -f /root/.hermes/cron/.wprobe && echo CLEANED'
echo
echo "===== D 反例：read-only 但**不**放开 /root/.hermes 写权 ⇒ 应只读 ====="
probe cron-p2-d -p ProtectHome=read-only -p ReadWritePaths=/opt/hergent-erp \
  /bin/sh -c 'touch /root/.hermes/cron/.wprobe2 && echo UNEXPECTED-WRITABLE && rm -f /root/.hermes/cron/.wprobe2 || echo READONLY-AS-EXPECTED'
echo
echo "===== E 暴露面对照：read-only 下 /root 看得见什么（诚实评估用）====="
probe cron-p2-e -p ProtectHome=read-only -- /bin/ls -la /root
echo
echo "===== F 对照：read-only 下能否读到 gateway 的其它敏感文件（.ssh / 私钥类）====="
probe cron-p2-f -p ProtectHome=read-only -- /bin/sh -c 'ls -ld /root/.ssh 2>&1; head -c 20 /root/.ssh/id_rsa 2>&1; echo; ls -l /root/.hermes/config.yaml 2>&1'
echo "===== 结束 ====="
