#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PYTHONHOME=""
export PYTHONPATH="$SCRIPT_DIR/libs"
export PATH="$SCRIPT_DIR/python/bin:$PATH"
exec "$SCRIPT_DIR/python/bin/python3.11" "$SCRIPT_DIR/hermes" "$@"
