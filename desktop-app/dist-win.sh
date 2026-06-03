#!/bin/bash
set -e
cd "$(dirname "$0")"

# Swap in Windows tarball
cp -f hermes.tar.gz hermes-mac-backup.tar.gz 2>/dev/null || true
cp -f ../engines/hermes-win/hermes.tar.gz hermes.tar.gz

# Build
npm run dist:win

# Copy VC++ DLLs into win-unpacked root so Electron can start
WIN_DIR="release/win-unpacked"
if [ -d "$WIN_DIR" ]; then
  for dll in vcruntime140.dll vcruntime140_1.dll; do
    if [ ! -f "$WIN_DIR/$dll" ]; then
      cp -f "../engines/hermes-win/$dll" "$WIN_DIR/" 2>/dev/null || \
      cp -f "../engines/hermes-win/python/$dll" "$WIN_DIR/" 2>/dev/null || true
    fi
  done
  # Rebuild NSIS installer with DLLs included
  npm run dist:win
fi

# Restore macOS tarball
cp -f hermes-mac-backup.tar.gz hermes.tar.gz 2>/dev/null || true
rm -f hermes-mac-backup.tar.gz
echo "Windows build complete"
