#!/bin/bash
# v290 受控批次隔离：临时把「别人的在途改动」回退到 HEAD，只留本次改动去构建。
# 用法: bash isolate.sh          -> 备份并回退
#       bash isolate.sh restore  -> 从备份还原
# 🔴 绝不使用 git stash：共享文件里叠着别人**已上线**的在途改动，stash 会一起移走。
set -u
REPO="/Users/zhangjunfeng/Documents/laozhangai-product"
BAK="/tmp/v290-others"
MINE="hergent-cn-v2/src/pages/EmployeeArchive.vue"
MODE="${1:-isolate}"

cd "$REPO" || exit 1

if [ "$MODE" = "restore" ]; then
  echo "=== 还原别人的在途改动 ==="
  n=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    mkdir -p "$(dirname "$p")"
    if cp "$BAK/$p" "$p"; then n=$((n+1)); else echo "  !! 还原失败: $p"; fi
  done < <(cd "$BAK" && find . -type f ! -name '.deleted_list' | sed 's|^\./||')
  echo "已还原 $n 个文件"
  if [ -f "$BAK/.deleted_list" ]; then
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      rm -f "$p" && echo "  已恢复「删除」态: $p"
    done < "$BAK/.deleted_list"
  fi
  echo "=== 还原后 hergent-cn-v2 状态 ==="
  git status --porcelain -- hergent-cn-v2
  exit 0
fi

echo "=== 备份 + 回退 ==="
rm -rf "$BAK"; mkdir -p "$BAK"
MOD=(); DEL=()
while IFS= read -r ln; do
  [ -z "$ln" ] && continue
  st="${ln:0:2}"; p="${ln:3}"
  case "$st" in
    "??") continue ;;
    " M"|"M "|"MM") MOD+=("$p") ;;
    "D "|" D") DEL+=("$p") ;;
    *) echo "[跳过未识别状态] [$st] $p" ;;
  esac
done < <(git status --porcelain -- hergent-cn-v2 | grep -v -F "$MINE")

for p in "${MOD[@]}"; do
  mkdir -p "$BAK/$(dirname "$p")"
  cp "$p" "$BAK/$p"
done
: > "$BAK/.deleted_list"
for p in "${DEL[@]}"; do echo "$p" >> "$BAK/.deleted_list"; done

for p in "${MOD[@]}" "${DEL[@]}"; do
  git show "HEAD:$p" > "$p" 2>/dev/null || echo "  !! 回退失败: $p"
done

echo "已备份: ${#MOD[@]} 个修改 + ${#DEL[@]} 个删除"
echo "=== 回退后 hergent-cn-v2 状态（应当只剩我的文件）==="
git status --porcelain -- hergent-cn-v2
