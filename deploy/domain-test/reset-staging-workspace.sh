#!/usr/bin/env bash
set -euo pipefail
echo "V4 deliberately disables the legacy staging workspace reset: its former subscription/role assumptions no longer apply." >&2
echo "Use an operator-reviewed isolated-volume backup, migration and recovery procedure. Setup does NOT reset anything." >&2
exit 2
