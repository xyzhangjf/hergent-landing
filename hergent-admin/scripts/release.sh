#!/usr/bin/env bash
# Hergent 管理后台 —— 发布版本管理（保留历史产物 + 一键回退）
#
# 为什么需要它：产物是**内容哈希命名**（index-<hash>.js / .css），本应天然支持回滚；
# 但此前部署用 `rsync --delete`，会把上一版产物删掉 ⇒ **回滚能力被部署动作自己清掉**。
#
# 🔴 版本单位是「index.html 快照」，不是一个 hash。
#    原因：js 与 css 的哈希**各自独立生成**，按单个 hash 回退会拼出
#    「旧 JS + 新 CSS」的错配组合（页面可能崩）。快照天然记录了**成对**的引用。
#
# 子命令：
#   snapshot          把当前 index.html 记为一个版本（部署后立刻执行）
#   list              列出所有可回退版本（含产物是否还在、哪个是当前）
#   rollback <id>     回退到指定版本；<id> 可用完整 id、js 哈希或 css 哈希
#   prune [N]         只保留最近 N 个版本（默认 5），并清理无人引用的产物
#
# 部署流程（务必按此顺序）：
#   rsync -av            dist/ root@host:/opt/hergent-admin/     # ⚠️ 不要加 --delete
#   bash /opt/hergent-admin/scripts/release.sh snapshot
#   bash /opt/hergent-admin/scripts/release.sh prune 5
#
# 回退：
#   bash /opt/hergent-admin/scripts/release.sh list
#   bash /opt/hergent-admin/scripts/release.sh rollback <js-hash>
set -euo pipefail

ROOT="${HG_ROOT:-/opt/hergent-admin}"
ASSETS="$ROOT/assets"
INDEX="$ROOT/index.html"
RELEASES="$ROOT/releases"

die() { echo "✗ $*" >&2; exit 1; }
mtime() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null || echo 0; }
ts() { date -d "@$1" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "$1" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '—'; }

ref_js()  { grep -o 'index-[A-Za-z0-9_-]*\.js'  "$1" 2>/dev/null | head -1 || true; }
ref_css() { grep -o 'index-[A-Za-z0-9_-]*\.css' "$1" 2>/dev/null | head -1 || true; }
# index-OA5Y7RtY.js -> OA5Y7RtY
h_of() { [ -n "${1:-}" ] && printf '%s' "${1#index-}" | sed 's/\.[a-z]*$//' || true; }
id_of() { local f="$1"; printf '%s_%s' "$(h_of "$(ref_js "$f")")" "$(h_of "$(ref_css "$f")")"; }

cmd_snapshot() {
  [ -f "$INDEX" ] || die "index.html 不存在：$INDEX"
  local js css id
  js=$(h_of "$(ref_js "$INDEX")"); css=$(h_of "$(ref_css "$INDEX")")
  [ -n "$js" ] && [ -n "$css" ] || die "index.html 里读不到 js/css 引用，拒绝记录"
  [ -f "$ASSETS/index-$js.js" ]   || die "产物缺失：index-$js.js（先 rsync 再 snapshot）"
  [ -f "$ASSETS/index-$css.css" ] || die "产物缺失：index-$css.css"
  id="${js}_${css}"
  mkdir -p "$RELEASES"
  if [ -f "$RELEASES/$id.html" ]; then
    echo "= 版本 $id 已存在，未重复记录"
  else
    cp -p "$INDEX" "$RELEASES/$id.html"
    echo "✓ 已记录版本 $id"
  fi
}

releases_desc() {
  [ -d "$RELEASES" ] || return 0
  local f
  for f in "$RELEASES"/*.html; do
    [ -f "$f" ] || continue
    echo "$(mtime "$f") $(basename "$f" .html) $f"
  done | sort -rn -k1
}

cmd_list() {
  [ -f "$INDEX" ] || die "index.html 不存在：$INDEX"
  local cur; cur=$(id_of "$INDEX")
  echo "当前版本： $cur"
  echo
  printf '%-26s %-6s %-6s %-6s %s\n' '版本(id)' 'JS' 'CSS' '当前' '记录时间'
  if [ ! -d "$RELEASES" ] || [ -z "$(ls -1 "$RELEASES" 2>/dev/null)" ]; then
    echo "(还没有任何版本快照 —— 部署后执行 release.sh snapshot)"
    return 0
  fi
  local t id f js css mark
  while read -r t id f; do
    js=$(h_of "$(ref_js "$f")"); css=$(h_of "$(ref_css "$f")")
    local mjs='✗' mcss='✗'
    [ -f "$ASSETS/index-$js.js" ] && mjs='✓'
    [ -f "$ASSETS/index-$css.css" ] && mcss='✓'
    mark=''; [ "$id" = "$cur" ] && mark='←'
    printf '%-26s %-6s %-6s %-6s %s\n' "$id" "$mjs" "$mcss" "$mark" "$(ts "$t")"
  done < <(releases_desc)
}

cmd_rollback() {
  local want="${1:-}"
  [ -n "$want" ] || die "用法：release.sh rollback <id | js-hash | css-hash>"
  local target='' t id f
  while read -r t id f; do
    if [ "$id" = "$want" ] || [ "${id%%_*}" = "$want" ] || [ "${id##*_}" = "$want" ]; then
      target="$f"; break
    fi
  done < <(releases_desc)
  [ -n "$target" ] || die "找不到版本 $want（先 release.sh list）"

  # 回退前先给「当前版本」留档，避免把线上唯一状态弄丢
  cmd_snapshot >/dev/null || true

  local js css
  js=$(h_of "$(ref_js "$target")"); css=$(h_of "$(ref_css "$target")")
  [ -f "$ASSETS/index-$js.js" ]   || die "版本 $want 的 js 产物已不在，无法回退"
  [ -f "$ASSETS/index-$css.css" ] || die "版本 $want 的 css 产物已不在，无法回退"
  cp "$target" "$INDEX.tmp.$$" && mv -f "$INDEX.tmp.$$" "$INDEX"
  echo "✓ 已回退到 $(basename "$target" .html)  →  index-$js.js / index-$css.css"
}

cmd_prune() {
  local keep="${1:-5}"
  case "$keep" in ''|*[!0-9]*) die "保留数必须是整数" ;; esac
  local -a ids=() files=()
  local t id f
  while read -r t id f; do ids+=("$id"); files+=("$f"); done < <(releases_desc)
  local n=${#ids[@]}
  [ "$n" -gt 0 ] || { echo "还没有版本快照"; return 0; }

  local cur; cur=$(id_of "$INDEX")
  local i
  if [ "$n" -gt "$keep" ]; then
    for ((i=keep; i<n; i++)); do
      # 当前版本必须留档，不参与清理
      if [ "${ids[$i]}" = "$cur" ]; then echo "  跳过（当前） ${ids[$i]}"; continue; fi
      rm -f "${files[$i]}"; echo "  移除旧版本快照 ${ids[$i]}"
    done
  fi

  # 重新收集「保留下来的快照 + 当前 index.html」所引用的产物，其余产物删除
  local tmp; tmp=$(mktemp)
  { [ -f "$INDEX" ] && echo "$(ref_js "$INDEX") $(ref_css "$INDEX")"
    for ((i=0; i<n && i<keep; i++)); do echo "$(ref_js "${files[$i]}") $(ref_css "${files[$i]}")"; done
  } >> "$tmp"
  local removed=0 ff base
  for ff in "$ASSETS"/index-*.js "$ASSETS"/index-*.css; do
    [ -f "$ff" ] || continue
    base=$(basename "$ff")
    if ! grep -q -- "$base" "$tmp"; then rm -f "$ff"; removed=$((removed+1)); fi
  done
  rm -f "$tmp"
  echo "✓ 保留最近 $keep 个版本（共 $n 个），清理无引用产物 $removed 个"
}

case "${1:-}" in
  snapshot) cmd_snapshot ;;
  list)     cmd_list ;;
  rollback) shift; cmd_rollback "${1:-}" ;;
  prune)    shift; cmd_prune "${1:-5}" ;;
  *) echo "用法：release.sh {snapshot | list | rollback <id> | prune [N]}" >&2; exit 1 ;;
esac
