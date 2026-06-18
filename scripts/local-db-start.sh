#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_DIR="$ROOT_DIR/work/postgres-runtime/pg16"
DATA_DIR="$ROOT_DIR/work/postgres-runtime/data"
LOG_FILE="$ROOT_DIR/work/postgres-runtime/postgres.log"

if [[ ! -x "$PG_DIR/bin/pg_ctl" ]]; then
  echo "PostgreSQL runtime not found: $PG_DIR"
  exit 1
fi

if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
  echo "PostgreSQL data directory is not initialized: $DATA_DIR"
  exit 1
fi

if "$PG_DIR/bin/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "PostgreSQL is already running at 127.0.0.1:5432"
  exit 0
fi

mkdir -p "$(dirname "$LOG_FILE")"
"$PG_DIR/bin/pg_ctl" \
  -D "$DATA_DIR" \
  -l "$LOG_FILE" \
  -o "-h 127.0.0.1 -p 5432" \
  start

