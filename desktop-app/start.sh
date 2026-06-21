#!/bin/bash
# Hergent 启动脚本（绕过 Claude 环境的 ELECTRON_RUN_AS_NODE）
cd "$(dirname "$0")"
env -u ELECTRON_RUN_AS_NODE npx electron . "$@"
