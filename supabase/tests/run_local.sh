#!/usr/bin/env bash
# Runs every database test against a brand-new, disposable PostgreSQL server on THIS computer.
# It never connects to Supabase or to any real database: the server it starts lives in a temporary folder and is deleted afterwards.
#
# Windows:  double-click RUN-TESTS.cmd in the project folder (it calls this script). See SETUP.md.
# Linux/Mac: bash supabase/tests/run_local.sh
# To choose which PostgreSQL to use:  PGBIN=/path/to/postgres/bin bash supabase/tests/run_local.sh
#
# Exit code 0 = every check passed; 1 = at least one failed; 2 = PostgreSQL could not be found or started.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PGPORT:-54329}"

# ---- find a PostgreSQL (needs initdb, pg_ctl and psql from the same folder)
has_tools() { [ -f "$1/initdb" -o -f "$1/initdb.exe" ] && [ -f "$1/pg_ctl" -o -f "$1/pg_ctl.exe" ] && [ -f "$1/psql" -o -f "$1/psql.exe" ]; }
find_bin() {
  if [ -n "${PGBIN:-}" ]; then has_tools "$PGBIN" && { echo "$PGBIN"; return; }; return; fi
  local d
  for d in $(ls -d /c/PressGO-Tools/postgresql-*/pgsql/bin /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r); do has_tools "$d" && { echo "$d"; return; }; done
  d=$(command -v initdb 2>/dev/null) && { d=$(dirname "$d"); has_tools "$d" && echo "$d"; }
}
BIN="$(find_bin)"
if [ -z "$BIN" ]; then
  echo "Could not find PostgreSQL (initdb, pg_ctl, psql). On Windows, follow the 'One-time setup' part of SETUP.md." >&2
  exit 2
fi

# initdb refuses to run as root (Linux containers): hand over to the postgres user once
if [ "$(id -u)" = 0 ] && [ -z "${PRESSGO_AS_POSTGRES:-}" ]; then
  exec su postgres -c "PRESSGO_AS_POSTGRES=1 PGBIN='$BIN' PGPORT='$PORT' bash '$DIR/run_local.sh'"
fi

PGDATA="$(mktemp -d)"; LOG="$(mktemp -d)"
P=("$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
cleanup() { "$BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1; sleep 1; rm -rf "$PGDATA" 2>/dev/null; true; }
trap cleanup EXIT

"$BIN/initdb" -D "$PGDATA" -A trust -U postgres -E UTF8 --no-locale >"$LOG/initdb.out" 2>&1 \
  || { echo "initdb failed:"; tail -15 "$LOG/initdb.out"; exit 2; }
"$BIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$LOG/server.log" -w start >"$LOG/start.out" 2>&1 \
  || { echo "the test server did not start:"; tail -15 "$LOG/start.out"; tail -15 "$LOG/server.log"; exit 2; }
echo "PostgreSQL in use: $("${P[@]}" -d postgres -At -c 'show server_version') (a disposable server on this computer, port $PORT; deleted when this finishes)"
echo

pass=0; fail=0; failed=()
ok()  { pass=$((pass + 1)); printf '  PASS  %s\n' "$1"; }
bad() { fail=$((fail + 1)); failed+=("$1"); printf '  FAIL  %s\n' "$1"; [ -n "${2:-}" ] && tail -n 12 "$2" | sed 's/^/        /'; }

# one brand-new database per test: the stand-in for Supabase's login/storage, then migrations in order
newdb()  { "${P[@]}" -d postgres -c "create database $1" >"$LOG/$1.setup" 2>&1 && "${P[@]}" -d "$1" -f "$DIR/local_stub.sql" >>"$LOG/$1.setup" 2>&1; }
migrate() { local db="$1" skip="${2:-^$}" m; for m in "$DIR"/../migrations/*.sql; do
              [[ "$(basename "$m")" =~ $skip ]] && continue
              "${P[@]}" -d "$db" -f "$m" >>"$LOG/$db.setup" 2>&1 || return 1; done; }

echo "Migration files (must be numbered 0001, 0002, ... with no gap or repeat)"
n=0; order_ok=1
for m in "$DIR"/../migrations/*.sql; do n=$((n + 1)); b=$(basename "$m"); [ "$((10#${b:0:4}))" = "$n" ] || { order_ok=0; echo "        out of order: $b (expected number $n)"; }; done
[ "$order_ok" = 1 ] && ok "$n migration files, numbered 1 to $n in order" || bad "migration numbering"
echo

echo "Permission tests (each on a fresh database built from all migrations)"
for t in 0001_foundation_test 0002_job_core_test 0003_files_holds_handoffs_test 0005_chat_test 0007_tasks_alerts_test 0008_assigned_jobs_test 0009_chat_images_test 0010_delete_messages_test 0011_approve_pictures_test 0012_break_status_test 0013_close_direct_writes_test 0014_artwork_approval_roles_test 0015_avatars_test 0016_preferences_test 0017_delete_job_test; do
  db="t_${t}"
  if ! newdb "$db" || ! migrate "$db"; then bad "$t (could not build the database)" "$LOG/$db.setup"; continue; fi
  "${P[@]}" -d "$db" -f "$DIR/$t.sql" >"$LOG/$t.out" 2>&1; rc=$?
  if [ "$rc" = 0 ] && grep -q "PASSED" "$LOG/$t.out"; then ok "$t"; else bad "$t" "$LOG/$t.out"; fi
done
echo

echo "Rollback test (migrations 0015-0017 applied with data, then undone; the database must end up exactly as before)"
db="t_rollback"; out="$LOG/rollback.out"; : >"$out"
if newdb "$db" && migrate "$db" '^001[567]_' \
   && "${P[@]}" -d "$db" -f "$DIR/rollback/snapshot.sql" >>"$out" 2>&1 \
   && for m in "$DIR"/../migrations/0015*.sql "$DIR"/../migrations/0016*.sql "$DIR"/../migrations/0017*.sql; do "${P[@]}" -d "$db" -f "$m" >>"$out" 2>&1 || exit 1; done \
   && "${P[@]}" -d "$db" -f "$DIR/rollback/a_setup.sql" >>"$out" 2>&1; then
  if "${P[@]}" -d "$db" -f "$DIR/../rollbacks/0017_rollback.sql" >"$LOG/guard.out" 2>&1; then
    bad "0017 rollback must REFUSE while a job is deleted, but it ran" "$LOG/guard.out"
  else ok "0017 rollback refuses while a job is deleted"; fi
  "${P[@]}" -d "$db" -f "$DIR/rollback/b_rollback.sql" >>"$out" 2>&1; rc=$?
  if [ "$rc" = 0 ] && grep -q "PASSED: rollback" "$out"; then ok "rollbacks 0017, 0016, 0015 restore the structure exactly"; else bad "rollbacks 0017, 0016, 0015" "$out"; fi
else bad "rollback test (could not set up)" "$out"; fi
echo

echo "Concurrency test (the 0017 rollback starts while another session is still in the middle of deleting a job)"
db="t_race"
if newdb "$db" && migrate "$db" && "${P[@]}" -d "$db" -f "$DIR/rollback/race_setup.sql" >"$LOG/race_setup.out" 2>&1; then
  # session B deletes the job and stays inside its transaction for 8 seconds before it commits
  { cat "$DIR/rollback/race_b.sql"; sleep 8; echo "commit;"; } | "${P[@]}" -d "$db" -f - >"$LOG/race_b.out" 2>&1 &
  bpid=$!
  for i in $(seq 1 60); do   # wait (up to 15 s) until B really is inside its open transaction
    n=$("${P[@]}" -d postgres -At -c "select count(*) from pg_stat_activity where datname = '$db' and state = 'idle in transaction'" 2>/dev/null); [ "${n:-0}" -ge 1 ] && break; sleep 0.25
  done
  "${P[@]}" -d "$db" -f "$DIR/../rollbacks/0017_rollback.sql" >"$LOG/race_a.out" 2>&1; rc=$?
  wait "$bpid"
  cols=$("${P[@]}" -d "$db" -At -c "select count(*) from information_schema.columns where table_schema = 'pressgo' and table_name = 'jobs' and column_name in ('deleted_at', 'deleted_by', 'delete_reason')")
  gone=$("${P[@]}" -d "$db" -At -c "select count(*) from pressgo.jobs where deleted_at is not null" 2>/dev/null)
  if [ "$rc" != 0 ] && grep -q "still marked deleted" "$LOG/race_a.out" && [ "$cols" = 3 ] && [ "${gone:-0}" = 1 ]; then
    ok "the 0017 rollback waits for a delete in progress, then refuses (the job stays deleted and the columns stay)"
  else
    { echo "rollback exit code: $rc | delete columns left: $cols of 3 | deleted jobs: ${gone:-?}"; tail -n 6 "$LOG/race_a.out"; tail -n 4 "$LOG/race_b.out"; } >"$LOG/race.summary"
    bad "the 0017 rollback must refuse when a delete finishes while it waits" "$LOG/race.summary"
  fi
else bad "concurrency test (could not set up)" "$LOG/race_setup.out"; fi
echo

echo "Release check (supabase/checks/verify_release.sql, read-only, on a database built from all migrations)"
db="t_verify"
if newdb "$db" && migrate "$db" && "${P[@]}" -d "$db" -At -F $'\t' -f "$DIR/../checks/verify_release.sql" >"$LOG/verify.out" 2>&1; then
  req=$(awk -F'\t' '$2=="required"' "$LOG/verify.out" | wc -l); reqok=$(awk -F'\t' '$2=="required" && $NF=="t"' "$LOG/verify.out" | wc -l)
  adv=$(awk -F'\t' '$2=="advisory"' "$LOG/verify.out" | wc -l); advok=$(awk -F'\t' '$2=="advisory" && $NF=="t"' "$LOG/verify.out" | wc -l)
  if [ "$req" -gt 0 ] && [ "$req" = "$reqok" ]; then ok "required checks $reqok of $req ok (advisory fingerprints: $advok of $adv ok)"; else bad "required checks: $reqok of $req ok" "$LOG/verify.out"; fi
else bad "release check (could not run)" "$LOG/verify.out"; fi
echo

echo "Result: $pass passed, $fail failed."
if [ "$fail" -gt 0 ]; then printf 'Failed: %s\n' "${failed[@]}"; echo "Details above; full logs are in $LOG"; trap - EXIT; cleanup; exit 1; fi
rm -rf "$LOG" 2>/dev/null
exit 0
