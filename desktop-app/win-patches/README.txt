Windows 引擎补丁目录

构建 Windows 版时，此目录会自动打包到 Resources/win-patches/
引擎解压后自动复制到 hermes-engine/ 根目录。

复制目标：
  win-patches/libs/*  → hermes-engine/libs/
  win-patches/tools/* → hermes-engine/tools/

当前需要的补丁文件：
  1. libs/hermes_constants.py  — 添加 secure_parent_dir 函数
  2. tools/threat_patterns.py  — 空壳模块
