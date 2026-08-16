#!/bin/bash
# stubs autonomous loop — kanban-orchestrator wrapper.
# Owns its PID file. Launches the orchestrator agent, waits, re-launches on exit.
# Liveness: HEARTBEAT is touched by ABSOLUTE PATH after each validated iteration.
set -u

# --- launchd minimal-PATH defense ---
case ":$PATH:" in
  *":/Users/lappier/.local/bin:"*) ;;
  *) PATH="/Users/lappier/.local/bin:/usr/local/bin:$PATH" ;;
esac
export PATH

REPO="/Users/lappier/code/projects/stubs"
PIDDIR="$REPO/.desktop"
mkdir -p "$PIDDIR"
WRAPPER_PID="$PIDDIR/run-loop-wrapper.pid"
CHILD_PID="$PIDDIR/run-loop-child.pid"
HEARTBEAT="$REPO/HEARTBEAT"
LOG="$PIDDIR/loop.log"
FAIL_LOG="$PIDDIR/loop-failures.log"
STOP="$REPO/STOP"
COOLDOWN=10
MAX_CONCURRENT_WORKERS=3
BOARD_SLUG="stubs"
BOARD_DB="/Users/lappier/.hermes/kanban/boards/${BOARD_SLUG}/kanban.db"
export CI=true
export HERMES_KANBAN_BOARD="$BOARD_SLUG"

# Atomic lockdir for single-wrapper guarantee
LOCKDIR="$PIDDIR/run-loop.lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  LOCK_OWNER=""
  for _try in 1 2 3 4 5 6 7 8 9 10; do
    LOCK_OWNER=$(cat "$LOCKDIR/pid" 2>/dev/null || echo "")
    [ -n "$LOCK_OWNER" ] && break
    sleep 0.5
  done
  if [ -n "$LOCK_OWNER" ] && [ "$LOCK_OWNER" != "$$" ] \
     && kill -0 "$LOCK_OWNER" 2>/dev/null \
     && ps -o command= -p "$LOCK_OWNER" 2>/dev/null | grep -q 'run-loop.sh'; then
    echo "[$(date -u +%FT%TZ)] SKIP already running (lock held by pid=$LOCK_OWNER)" >> "$LOG"
    exit 0
  fi
  echo "[$(date -u +%FT%TZ)] reclaiming lock" >> "$LOG"
fi
echo "$$" > "$LOCKDIR/pid"

# Single-instance guard by resolved cwd — only match actual bash run-loop.sh processes
REPO_REAL=$(cd "$REPO" 2>/dev/null && pwd -P)
for _p in $(ps -A -o pid=,command= 2>/dev/null | awk -v repo="$REPO_REAL" -v mypid=$$ '$2 ~ /run-loop\.sh/ && $1 != mypid {print $1}'); do
  kill -0 "$_p" 2>/dev/null || continue
  _cw=$(lsof -a -p "$_p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  [ -n "$_cw" ] || continue
  _cw_real=$(cd "$_cw" 2>/dev/null && pwd -P)
  if [ -n "$_cw_real" ] && [ "$_cw_real" = "$REPO_REAL" ]; then
    echo "[$(date -u +%FT%TZ)] SKIP peer wrapper pid=$_p already owns $REPO" >> "$LOG"
    rmdir "$LOCKDIR" 2>/dev/null || rm -rf "$LOCKDIR"
    exit 0
  fi
done

if [ -f "$WRAPPER_PID" ]; then
  EXISTING=$(cat "$WRAPPER_PID" 2>/dev/null)
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "$$" ] \
     && kill -0 "$EXISTING" 2>/dev/null \
     && ps -o command= -p "$EXISTING" 2>/dev/null | grep -q 'run-loop.sh'; then
    echo "[$(date -u +%FT%TZ)] SKIP already running pid=$EXISTING" >> "$LOG"
    rmdir "$LOCKDIR" 2>/dev/null || rm -rf "$LOCKDIR"
    exit 0
  fi
fi
echo "$$" > "$WRAPPER_PID"

cleanup() {
  _owned=0
  [ "$(cat "$WRAPPER_PID" 2>/dev/null)" = "$$" ] && _owned=1
  [ "$_owned" = "1" ] && rm -f "$WRAPPER_PID"
  [ "$(cat "$LOCKDIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCKDIR"
  [ "$_owned" = "1" ] && rm -f "$CHILD_PID"
  return 0
}
trap cleanup EXIT INT TERM

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }

WORKER_PIDDIR="$PIDDIR/workers"
mkdir -p "$WORKER_PIDDIR"

reap_workers() {
  for wf in "$WORKER_PIDDIR"/worker-*.pid; do
    [ -f "$wf" ] || continue
    wp=$(cat "$wf" 2>/dev/null || echo "")
    [ -z "$wp" ] && continue
    if ! kill -0 "$wp" 2>/dev/null; then
      tid=$(basename "$wf" .pid | sed 's/worker-//')
      log "worker $tid (pid=$wp) finished; reaped"
      rm -f "$wf"
    fi
  done
}

safe_task_id() {
  printf '%s' "$1" | sed 's/[^a-zA-Z0-9_-]/-/g'
}

is_valid_task_id() {
  case "$1" in
    ''|*[!a-zA-Z0-9_-]*) return 1 ;;
    *) return 0 ;;
  esac
}

cleanup_malformed_task_artifacts() {
  local bad_count=0
  for wf in "$WORKER_PIDDIR"/worker-*.pid; do
    [ -f "$wf" ] || continue
    local raw_tid
    raw_tid=$(basename "$wf" .pid | sed 's/worker-//')
    if ! is_valid_task_id "$raw_tid"; then
      wp=$(cat "$wf" 2>/dev/null || echo "")
      [ -n "$wp" ] && kill -0 "$wp" 2>/dev/null && continue
      rm -f "$wf"
      bad_count=$((bad_count + 1))
    fi
  done
  if [ "$bad_count" -gt 0 ]; then
    log "cleaned $bad_count malformed worker pidfiles"
  fi
}

active_worker_count() {
  find "$WORKER_PIDDIR" -name 'worker-*.pid' -exec cat {} \; 2>/dev/null | while read wp; do
    kill -0 "$wp" 2>/dev/null && echo "$wp"
  done | wc -l | tr -d ' '
}

dispatch_worker() {
  local tid="$1"
  local role="$2"
  local task_body="$3"
  local safe_tid
  safe_tid=$(printf '%s' "$tid" | sed 's/[^a-zA-Z0-9_-]/-/g')
  local wpidfile="$WORKER_PIDDIR/worker-${safe_tid}.pid"
  
  if [ -f "$wpidfile" ]; then
    local existing_pid
    existing_pid=$(cat "$wpidfile" 2>/dev/null || echo "")
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
      log "worker $tid already running (pid=$existing_pid); skip"
      return 0
    else
      rm -f "$wpidfile"
    fi
  fi
  
  mkdir -p "$REPO/.kanban/workspace/$safe_tid"
  mkdir -p "$REPO/.kanban/results"
  cat > "$REPO/.kanban/workspace/$safe_tid/task.md" <<TASKEOF
$task_body
TASKEOF
  
  local worker_prompt="You are the **stubs implementer** for task $tid. Your role: $role.

## Task
$(head -100 "$REPO/.kanban/workspace/$safe_tid/task.md")

## Ownership boundary
- You MAY edit files under: src/, tests/, public/, .agents/skills/stubs/dist/
- You MAY NOT edit: AGENT_GOAL.md, PRIORITIES.md, .kanban/kanban.db, scripts/
- Do NOT write SATURATED.md

## Standing gate
Run these after your changes:
- CI=true npm run build
- CI=true npm run build:web
- CI=true npm test --maxWorkers=2
- CI=true npm run lint

After EACH gate run, sleep 10s before next command. Do not claim green without re-running.

## Output
Write your result to: .kanban/results/$tid.md
Include: what changed, gate results (build/build:web/lint/jest counts), and next-gap.

Run now. Do not delegate. Do not spawn agents."
  
  log "dispatching worker $tid role=$role"
  nohup bash -c "cd '$REPO' && HERMES_KANBAN_BOARD=stubs hermes chat -s kanban-orchestrator -s loop-swarm --max-turns 10000 -q '$worker_prompt' > '$REPO/.kanban/results/$safe_tid.log' 2>&1" </dev/null >/dev/null &
  local worker_pid=$!
  echo "$worker_pid" > "$wpidfile"
  log "worker $tid started pid=$worker_pid"
}

while true; do
  if [ -f "$STOP" ]; then
    log "STOP sentinel present; idling."
    sleep "$COOLDOWN"
    continue
  fi

  if ! command -v hermes >/dev/null 2>&1; then
    log "PREFLIGHT hermes not on PATH; backing off ${COOLDOWN}s"
    sleep "$COOLDOWN"
    continue
  fi

  cleanup_malformed_task_artifacts

  # Reap finished workers
  reap_workers

  # Count active workers
  ACTIVE=$(active_worker_count)
  log "sweep: active_workers=$ACTIVE"
  
  # Dispatch eligible tasks FIRST
  if [ "$ACTIVE" -lt "$MAX_CONCURRENT_WORKERS" ]; then
    ACTIVE_TIDS=""
    for wf in "$WORKER_PIDDIR"/worker-*.pid; do
      [ -f "$wf" ] || continue
      wp=$(cat "$wf" 2>/dev/null || echo "")
      [ -z "$wp" ] && continue
      if kill -0 "$wp" 2>/dev/null; then
        raw_tid=$(basename "$wf" .pid | sed 's/worker-//')
        if is_valid_task_id "$raw_tid"; then
          ACTIVE_TIDS="$ACTIVE_TIDS '$raw_tid'"
        fi
      fi
    done
    
    EXCLUDE_CLAUSE=""
    if [ -n "$ACTIVE_TIDS" ]; then
      EXCLUDE_CLAUSE="AND id NOT IN ($ACTIVE_TIDS)"
    fi
    
    DISPATCH_LIST=$(sqlite3 "$BOARD_DB" "
      SELECT id, role, COALESCE(
        (SELECT body FROM task_bodies WHERE task_id=tasks.id LIMIT 1),
        'Implement this task. Write result to .kanban/results/' || id || '.md'
      )
      FROM tasks
      WHERE status IN ('todo', 'ready')
        $EXCLUDE_CLAUSE
      LIMIT $(( MAX_CONCURRENT_WORKERS - ACTIVE ))
    " 2>/dev/null || true)

    if [ -n "$DISPATCH_LIST" ]; then
      while IFS='|' read -r tid role tbody; do
        [ -z "$tid" ] && continue
        if ! is_valid_task_id "$tid"; then
          log "skipping dispatch for malformed task id=$tid"
          continue
        fi
        dispatch_worker "$tid" "$role" "$tbody"
        sqlite3 "$BOARD_DB" "
          UPDATE tasks SET status='running', updated_at=datetime('now')
          WHERE id='$tid' AND status IN ('todo', 'ready');
        " 2>/dev/null || true
      done <<< "$DISPATCH_LIST"
    fi
  fi
  
  # Verify completed workers
  for wf in "$WORKER_PIDDIR"/worker-*.pid; do
    [ -f "$wf" ] || continue
    wp=$(cat "$wf" 2>/dev/null || echo "")
    [ -z "$wp" ] && continue
    if ! kill -0 "$wp" 2>/dev/null; then
      raw_tid=$(basename "$wf" .pid | sed 's/worker-//')
      safe_result_tid=$(safe_task_id "$raw_tid")
      result_file="$REPO/.kanban/results/$safe_result_tid.md"
      if [ -f "$result_file" ]; then
        sqlite3 "$BOARD_DB" "
          UPDATE tasks SET status='review', updated_at=datetime('now')
          WHERE id='$raw_tid' AND status='running';
        " 2>/dev/null || true
        log "worker $raw_tid results found; marked review"
      else
        sqlite3 "$BOARD_DB" "
          UPDATE tasks SET status='blocked', claim='orchestrator-block',
            updated_at=datetime('now')
          WHERE id='$raw_tid' AND status='running';
        " 2>/dev/null || true
        log "worker $raw_tid no results; marked blocked"
      fi
      rm -f "$wf"
    fi
  done

  # Short agent window for meta-work (review, unblock, phase management)
  AGENT_GOAL="$REPO/AGENT_GOAL.md"
  PRIORITIES="$REPO/PRIORITIES.md"
  WORKER_PROMPT="You are the **kanban orchestrator** for an unattended Hermes loop. You own the durable task board, sweep it, dispatch workers, resolve blocks, declare phases complete, and create the next phase's tasks. Run autonomously until STOP or SATURATED.md appears.

=== AGENT_GOAL.md ===
$(sed -n '1,220p' "$AGENT_GOAL" 2>/dev/null || true)

=== PRIORITIES.md ===
$(sed -n '1,220p' "$PRIORITIES" 2>/dev/null || true)

Quick review of board state and any blocks. Do not repeat previous sweeps. End quickly."

  export HERMES_KANBAN_BOARD="$BOARD_SLUG"
  log "starting orchestrator pid=$$"
  hermes chat -s kanban-orchestrator -s loop-swarm \
    --max-turns 10000 \
    -q "$WORKER_PROMPT" \
    > "$LOG" 2>&1 &
  CHILD=$!
  echo "$CHILD" > "$CHILD_PID"
  wait "$CHILD"
  RC=$?

  if [ "$RC" -eq 130 ] || [ "$RC" -eq 143 ] || [ "$RC" -eq 137 ]; then
    echo "[$(date -u +%FT%TZ)] API_DISCONNECT exit=$RC" >> "$FAIL_LOG"
    log "child exited $RC (API_DISCONNECT); restarting after backoff"
  else
    echo "[$(date -u +%FT%TZ)] child exited rc=$RC" >> "$FAIL_LOG"
    log "child exited rc=$RC; restarting after backoff"
  fi

  touch "$HEARTBEAT"
  sleep "$COOLDOWN"
done
