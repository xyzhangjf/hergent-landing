#!/bin/bash
cd /Users/zhangjunfeng/Documents/laozhangai-product/desktop-app
cp -f ../engines/hermes/hermes.tar.gz hermes.tar.gz
/opt/homebrew/bin/npm run dist:mac 2>&1
