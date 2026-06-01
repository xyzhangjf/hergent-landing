#!/bin/bash
set -e
cd "$(dirname "$0")"
# Backup macOS tarball
cp -f hermes.tar.gz hermes-mac-backup.tar.gz 2>/dev/null
# Copy Windows tarball  
cp -f ../engines/hermes-win/hermes.tar.gz hermes.tar.gz
# Build
npm run dist:win
# Restore macOS tarball
cp -f hermes-mac-backup.tar.gz hermes.tar.gz 2>/dev/null
rm -f hermes-mac-backup.tar.gz
echo "Windows build complete"
