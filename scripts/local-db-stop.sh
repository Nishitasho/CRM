#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_DIR="$ROOT_DIR/work/postgres-runtime/pg16"
DATA_DIR="$ROOT_DIR/work/postgres-runtime/data"

if [[ ! -x "$PG_DIR/bin/pg_ctl" ]]; then
  echo "PostgreSQL runtime not found: $PG_DIR"
  exit 1
fi

if [[ ! -f "$DATA_DIR/postmaster.pid" ]]; then
  echo "PostgreSQL is not running"
  exit 0
fi

"$PG_DIR/bin/pg_ctl" -D "$DATA_DIR" stop -m fast

