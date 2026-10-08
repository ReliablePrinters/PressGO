#!/usr/bin/env bash
# Runs every permission test, each against a brand-new throwaway Postgres database.
# Usage: bash supabase/tests/run_local.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PGDATA=$(mktemp -d); PORT=54329
BIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
chown postgres "$PGDATA" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$BIN/initdb -D $PGDATA -A trust >/dev/null"
run "$BIN/pg_ctl -D $PGDATA -o '-p $PORT -k /tmp' -l $PGDATA/log -w start >/dev/null"
trap 'run "$BIN/pg_ctl -D $PGDATA -m immediate stop >/dev/null" || true' EXIT
P="psql -h /tmp -p $PORT -U postgres -q -v ON_ERROR_STOP=1"
for t in 0001_foundation_test 0002_job_core_test 0003_files_holds_handoffs_test 0005_chat_test 0007_tasks_alerts_test 0008_assigned_jobs_test 0009_chat_images_test 0010_delete_messages_test 0011_approve_pictures_test 0012_break_status_test 0013_close_direct_writes_test; do
  db="t_${t}"
  run "$P -d postgres -c 'create database $db'"
  run "$P -d $db -f $DIR/local_stub.sql"
  for m in $DIR/../migrations/*.sql; do run "$P -d $db -f $m"; done
  run "$P -d $db -f $DIR/$t.sql" | grep -E "PASSED|ERROR|FAILED" || true
done
