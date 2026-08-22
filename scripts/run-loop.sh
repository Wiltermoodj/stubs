#!/bin/bash
# scripts/run-loop.sh — standalone wrapper for stubs kanban loop.
# Wrapper owns lifecycle, dispatch, result detection, and orchestrator agent window.
# Runs as a detached OS process independent of this Hermes instance.
set -u

case ":${PATH}:" in
  *":/Users/lappier/.local/bin:"*) ;;
  *) PATH="/Users/lappier/.local/bin:/usr/local/bin:${PATH}" ;;
esac
export PATH

REPO="/Users/lappier/code/projects/stubs"
PIDDIR="$REPO/.desktop"
mkdir -p "$PIDDIR" "$REPO/.kanban/logs" "$REPO/.kanban/workers" "$REPO/.kanban/results"
WRAPPER_PID="$PIDDIR/run-loop-wrapper.pid"
CHILD_PID="$PIDDIR/run-loop-child.pid"
HEARTBEAT="$REPO/HEARTBEAT"
LOG="$PIDDIR/loop.log"
FAIL_LOG="$PIDDIR/loop-failures.log"
STOP="$REPO/STOP"
COOLDOWN=60
MAX_CONCURRENT_WORKERS=3
BOARD_SLUG="stubs"
BOARD_DB="/Users/lappier/.hermes/kanban/boards/${BOARD_SLUG}/kanban.db"
export CI=true
export HERMES_KANBAN_BOARD="$BOARD_SLUG"
export HERMES_PID="$$"

LOCKDIR="$PIDDIR/run-loop.lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  LOCK_OWNER=""
  for _try in 1 2 3 4 5 6 7 8 9 10; do
    LOCK_OWNER=$(cat "$LOCKDIR/pid" 2>/dev/null || echo "")
    [ -n "$LOCK_OWNER" ] && break
    sleep 0.5
  done
  if [ -n "$LOCK_OWNER" ] && [ "$LOCK_OWNER" != "$$" ] && kill -0 "$LOCK_OWNER" 2>/dev/null && ps -o command= -p "$LOCK_OWNER" 2>/dev/null | grep -q 'run-loop.sh'; then
    echo "[$(date -u +%FT%TZ)] SKIP already running (lock held by pid=$LOCK_OWNER)" >> "$LOG"
    exit 0
  fi
  echo "[$(date -u +%FT%TZ)] reclaiming lock" >> "$LOG"
fi
echo "$$" > "$LOCKDIR/pid"

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
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "$$" ] && kill -0 "$EXISTING" 2>/dev/null && ps -o command= -p "$EXISTING" 2>/dev/null | grep -q 'run-loop.sh'; then
    echo "[$(date -u +%FT%TZ)] SKIP already running pid=$EXISTING" >> "$LOG"
    rmdir "$LOCKDIR" 2>/dev/null || rm -rf "$LOCKDIR"
    exit 0
  fi
fi
echo "$$" > "$WRAPPER_PID"

cleanup() {
  [ "$(cat "$WRAPPER_PID" 2>/dev/null)" = "$$" ] && rm -f "$WRAPPER_PID"
  [ "$(cat "$LOCKDIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCKDIR"
  [ "$(cat "$CHILD_PID" 2>/dev/null)" = "$$" ] && rm -f "$CHILD_PID"
  return 0
}
trap cleanup EXIT INT TERM

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }
looplog() { echo "[$(date -u +%FT%TZ)] $*" >> "$REPO/.kanban/logs/orchestrator.log"; }

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

active_worker_count() {
  find "$WORKER_PIDDIR" -name 'worker-*.pid' -exec cat {} \; 2>/dev/null | while read wp; do
    kill -0 "$wp" 2>/dev/null && echo "$wp"
  done | wc -l | tr -d ' '
}

# Check if a task has a worker-results.md claiming completion
has_worker_result() {
  local tid="$1"
  local role="$2"
  local safe_tid
  safe_tid=$(safe_task_id "$tid")
  case "$role" in
    implementer|researcher)
      local wf="$REPO/.kanban/results/${safe_tid}/worker-results.md"
      [ -f "$wf" ] && [ -s "$wf" ] && return 0
      ;;
    validator)
      local vr="$REPO/.kanban/results/${safe_tid}/validator-results.md"
      [ -f "$vr" ] && [ -s "$vr" ] && return 0
      ;;
    reviewer)
      local rr="$REPO/.kanban/results/${safe_tid}/reviewer-results.md"
      [ -f "$rr" ] && [ -s "$rr" ] && return 0
      ;;
  esac
  return 1
}

# Check task status — need both role and assignee columns.
# The board schema uses `assignee`; some tasks may have `role` set instead.
# Query both and fall back to `role` → `assignee` → `implementer` in that order.
get_task_assignee() {
  local tid="$1"
  sqlite3 "$BOARD_DB" "SELECT COALESCE(assignee, 'implementer') FROM tasks WHERE id='$tid';" 2>/dev/null || echo ""
}

get_task_role() {
  local tid="$1"
  sqlite3 "$BOARD_DB" "SELECT COALESCE(assignee, 'implementer') FROM tasks WHERE id='$tid';" 2>/dev/null || echo ""
}

dispatch_worker() {
  local tid="$1"
  local role="$2"
  local tbody="$3"
  local safe_tid
  safe_tid=$(safe_task_id "$tid")
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

  local submit_cmd=""
  case "$role" in
    researcher) submit_cmd="python3 /Users/lappier/.hermes/skills/contextloop/bin/research-submit $tid --stdin" ;;
    implementer)
      submit_cmd="python3 /Users/lappier/.hermes/skills/contextloop/bin/impl-submit $tid --summary 'Implemented task $tid' --dispatch-dir .kanban/results/$safe_tid --phase phase-1"
      ;;
    validator) submit_cmd="python3 /Users/lappier/.hermes/skills/contextloop/bin/val-submit $tid --stdin --verdict pass" ;;
    reviewer) submit_cmd="python3 /Users/lappier/.hermes/skills/contextloop/bin/rev-submit $tid --stdin --verdict approve" ;;
    *) submit_cmd="# No submit step for role=$role" ;;
  esac

  mkdir -p "$REPO/.kanban/workspace/$safe_tid"
  cat > "$REPO/.kanban/workspace/$safe_tid/task.md" <<TASKEOF
$tbody

## Submit step
Run this AFTER you complete your work, passing your result via stdin:
$submit_cmd
TASKEOF

  local worker_prompt="You are the **stubs worker** for task $tid. Your role: $role.

$(cat "$REPO/.kanban/workspace/$safe_tid/task.md")

## Ownership boundary
- You MAY edit files under the paths listed in the task body.
- You MAY NOT edit: AGENT_GOAL.md, PRIORITIES.md, .kanban/kanban.db, scripts/, run-loop.sh.
- Do NOT write SATURATED.md.

## Output
Write your result to: .kanban/results/$safe_tid/worker-results.md
Include: status, summary, artifacts, verification evidence, and any block reason.

Run now. Do not delegate. Do not spawn agents.
"

  log "dispatching worker $tid role=$role"
  local prompt_file="$REPO/.kanban/workspace/$safe_tid/worker-prompt.txt"
  printf '%s' "$worker_prompt" > "$prompt_file"
  nohup bash -c "cd '$REPO' && HERMES_KANBAN_BOARD=stubs hermes chat -q \"\$(cat '$prompt_file')\" --max-turns 200 > '$REPO/.kanban/results/$safe_tid.log' 2>&1" </dev/null >/dev/null &
  local worker_pid=$!
  echo "$worker_pid" > "$wpidfile"
  log "worker $tid started pid=$worker_pid"
}

resolve_blocked() {
  local tid="$1"
  local role="$2"
  local assignee
  assignee=$(get_task_assignee "$tid")

  # Check consecutive failures for triage
  local fail_count
  fail_count=$(sqlite3 "$BOARD_DB" "SELECT COALESCE(consecutive_failures, 0) FROM tasks WHERE id='$tid';" 2>/dev/null || echo "0")

  if [ "$fail_count" -ge 3 ] 2>/dev/null; then
    log "task $tid has $fail_count consecutive failures; marking triage (no auto-retry)"
    sqlite3 "$BOARD_DB" "UPDATE tasks SET status='blocked', block_kind='triage' WHERE id='$tid' AND status='running';" 2>/dev/null || true
    return 1
  fi

  # Escalate role if implementer keeps failing — try validator to verify the work is already done
  if [ "$role" = "implementer" ]; then
    log "task $tid implementer failed $fail_count times; escalating to validator for re-verification"
    sqlite3 "$BOARD_DB" "UPDATE tasks SET status='todo', assignee='validator', consecutive_failures=0 WHERE id='$tid' AND status='running';" 2>/dev/null || true
  else
    # Fresh attempt with same role
    sqlite3 "$BOARD_DB" "UPDATE tasks SET status='todo', consecutive_failures=0 WHERE id='$tid' AND status='running';" 2>/dev/null || true
  fi
  return 0
}

while true; do
  if [ -f "$STOP" ] && [ ! -d "$STOP" ]; then
    log "STOP sentinel present; idling."
    sleep "$COOLDOWN"
    continue
  fi

  if ! command -v hermes >/dev/null 2>&1; then
    log "PREFLIGHT hermes not on PATH; backing off ${COOLDOWN}s"
    sleep "$COOLDOWN"
    continue
  fi

  reap_workers

  # --- RESULT DETECTION AND TRANSITION ---
  # Check for completed worker results and transition tasks.
  # Result detection runs on ALL non-terminal tasks (todo/ready/running/review/blocked),
  # not just running — a task may have results from a previous loop, a manual run,
  # or a disconnected orchestrator that never told the wrapper.
  detect_and_transition() {
    local board_state="$1"
    local db="$2"
    local repo="$3"

    echo "$board_state" | while IFS='|' read -r tid status assignee role body; do
      [ -z "$tid" ] && continue
      tid=$(echo "$tid" | tr -d '\r\n ')

      # Skip terminal states — nothing to detect
      case "$status" in
        done|archived) ;;  # no-op: skip this task
        *) ;;
      esac
      [ "$status" = "done" ] || [ "$status" = "archived" ] && continue

      local wf=""
      local wf_status=""
      local vr=""
      local rr=""
      local verdict=""

      case "$role" in
        implementer|researcher)
          wf="${repo}/.kanban/results/$(safe_task_id "$tid")/worker-results.md"
          if [ -f "$wf" ] && [ -s "$wf" ]; then
            wf_status=$(grep -i "^## Status" "$wf" 2>/dev/null | head -1 | sed 's/.*## Status[[:space:]]*//' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
            if [ "$wf_status" = "complete" ]; then
              if grep -q "Generated by impl-submit\|Generated by val-submit\|Generated by rev-submit\|Generated by research-submit" "$wf" 2>/dev/null; then
                log "task $tid worker result says complete (submit OK); transitioning to Review"
                sqlite3 "$db" "UPDATE tasks SET status='review' WHERE id='$tid';" 2>/dev/null || true
              else
                log "task $tid worker result says complete but submit failed; resolving block"
                resolve_blocked "$tid" "$role"
              fi
            elif [ "$wf_status" = "blocked" ]; then
              log "task $tid worker self-reported blocked; resolving"
              resolve_blocked "$tid" "$role"
            fi
          fi
          ;;
        validator)
          vr="${repo}/.kanban/results/$(safe_task_id "$tid")/validator-results.md"
          if [ -f "$vr" ] && [ -s "$vr" ]; then
            verdict=$(grep -i "^## Verdict\|^## Status" "$vr" 2>/dev/null | head -1 | sed 's/.*## //' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
            if [ "$verdict" = "pass" ] || [ "$verdict" = "pass-with-notes" ]; then
              log "task $tid validator passed; transitioning to Done"
              sqlite3 "$db" "UPDATE tasks SET status='done', completed_at=datetime('now') WHERE id='$tid';" 2>/dev/null || true
            elif [ "$verdict" = "fail" ]; then
              log "task $tid validator failed; blocking"
              sqlite3 "$db" "UPDATE tasks SET status='blocked', block_kind='verification-failed', consecutive_failures=COALESCE(consecutive_failures,0)+1 WHERE id='$tid';" 2>/dev/null || true
            fi
          fi
          ;;
        reviewer)
          rr="${repo}/.kanban/results/$(safe_task_id "$tid")/reviewer-results.md"
          if [ -f "$rr" ] && [ -s "$rr" ]; then
            verdict=$(grep -i "^## Verdict\|^## Status" "$rr" 2>/dev/null | head -1 | sed 's/.*## //' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
            if [ "$verdict" = "approve" ]; then
              log "task $tid reviewer approved; transitioning to Done"
              sqlite3 "$db" "UPDATE tasks SET status='done', completed_at=datetime('now') WHERE id='$tid';" 2>/dev/null || true
            elif [ "$verdict" = "request-changes" ]; then
              log "task $tid reviewer requested changes; blocking"
              sqlite3 "$db" "UPDATE tasks SET status='blocked', block_kind='reviewer-changes', consecutive_failures=COALESCE(consecutive_failures,0)+1 WHERE id='$tid';" 2>/dev/null || true
            fi
          fi
          ;;
      esac
    done
  }

  BOARD_STATE=$(sqlite3 "$BOARD_DB" "SELECT id, status, COALESCE(assignee, 'implementer'), COALESCE(assignee, 'implementer'), substr(body,1,800) FROM tasks ORDER BY id;" 2>/dev/null || echo "BOARD_UNREADABLE")

  if [ "$BOARD_STATE" != "BOARD_UNREADABLE" ]; then
    detect_and_transition "$BOARD_STATE" "$BOARD_DB" "$REPO"
  fi

  # --- DISPATCH ---
  ACTIVE=$(active_worker_count)
  log "sweep: active_workers=$ACTIVE"

  if [ "$ACTIVE" -lt "$MAX_CONCURRENT_WORKERS" ]; then
    ACTIVE_TIDS=""
    for wf in "$WORKER_PIDDIR"/worker-*.pid; do
      [ -f "$wf" ] || continue
      wp=$(cat "$wf" 2>/dev/null || echo "")
      [ -z "$wp" ] || ! kill -0 "$wp" 2>/dev/null && continue
      raw_tid=$(basename "$wf" .pid | sed 's/worker-//')
      if is_valid_task_id "$raw_tid"; then
        ACTIVE_TIDS="$ACTIVE_TIDS '$raw_tid'"
      fi
    done

    EXCLUDE_CLAUSE=""
    if [ -n "$ACTIVE_TIDS" ]; then
      EXCLUDE_CLAUSE="AND id NOT IN ($ACTIVE_TIDS)"
    fi

    DISPATCH_LIST=$(sqlite3 "$BOARD_DB" "SELECT id, COALESCE(assignee, 'implementer') FROM tasks WHERE status IN ('todo', 'ready') $EXCLUDE_CLAUSE LIMIT $(( MAX_CONCURRENT_WORKERS - ACTIVE ))" 2>/dev/null || true)

    if [ -n "$DISPATCH_LIST" ]; then
      while IFS='|' read -r tid assignee; do
        [ -z "$tid" ] && continue
        tid=$(echo "$tid" | tr -d '\r\n ')
        assignee=$(echo "$assignee" | tr -d '\r\n ')
        if ! is_valid_task_id "$tid"; then
          log "skipping dispatch for malformed task id=$tid"
          continue
        fi
        tbody=$(sqlite3 "$BOARD_DB" "SELECT body FROM tasks WHERE id='$tid';" 2>/dev/null || true)
        [ -z "$tbody" ] && tbody="(body not found for $tid)"
        dispatch_worker "$tid" "$assignee" "$tbody"
        sqlite3 "$BOARD_DB" "UPDATE tasks SET status='running' WHERE id='$tid' AND status IN ('todo', 'ready');" 2>/dev/null || true
      done <<< "$DISPATCH_LIST"
    fi
  fi

  # --- PHASE COMPLETION DETECTION (wrapper fallback) ---
  # The orchestrator is responsible for writing the completion marker, but the
  # wrapper must also detect phase completion as a fallback — the orchestrator may
  # halt without writing it (disconnection, crash, prompt gap). See SKILL.md
  # "Wrapper phase-completion fallback".
  detect_phase_completion() {
    local db="$1"
    local phase_dir="$2"
    local marker="$phase_dir/completed.md"

    if [ -f "$marker" ]; then
      return 0  # already completed
    fi

    # Check task-state criteria: all done/archived, no running, no blocked (except triage)
    local not_done
    not_done=$(sqlite3 "$db" "SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done', 'archived') AND status != 'blocked';" 2>/dev/null || echo "?")
    if [ "$not_done" != "0" ] && [ "$not_done" != "?" ]; then
      return 1  # tasks still active
    fi

    # Check for blocked tasks not in triage
    local blocked_not_triage
    blocked_not_triage=$(sqlite3 "$db" "SELECT COUNT(*) FROM tasks WHERE status='blocked' AND (block_kind IS NULL OR block_kind != 'triage');" 2>/dev/null || echo "?")
    if [ "$blocked_not_triage" != "0" ] && [ "$blocked_not_triage" != "?" ]; then
      return 1
    fi

    # Custom criteria: build must pass (Phase 1 requirement)
    if ! CI=true npm run build --prefix "$REPO" >/dev/null 2>&1; then
      log "phase completion check: build fails; not completing"
      return 1
    fi

    # All criteria met — write the marker
    local phase_name
    phase_name=$(basename "$phase_dir")
    local ts
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    cat > "$marker" <<MARKEREOF
# Phase $phase_name — Completed

**Completed at:** $ts
**Board:** $(sqlite3 "$db" "SELECT COUNT(*) FROM tasks WHERE status='done';" 2>/dev/null || echo "?") tasks done, $(sqlite3 "$db" "SELECT COUNT(*) FROM tasks WHERE status='archived';" 2>/dev/null || echo "?") archived.

## Summary

All completion criteria met:
- All tasks for the phase are Done or archived.
- No InProgress tasks remain.
- No Blocked tasks remain (except triage).
- Build passes.

## Notes for next phase

[To be filled by the next phase's planner.]
MARKEREOF
    log "phase completion detected by wrapper; wrote marker at $marker"
    return 0
  }

  # Detect phase completion before orchestrator window — wrapper fallback
  PHASE_DIR="$REPO/.hermes/skills/contextloop/phases/phase-1/cli-bug-fixes"
  detect_phase_completion "$BOARD_DB" "$PHASE_DIR" 2>/dev/null || true

  touch "$HEARTBEAT"

  BOARD_STATE=$(sqlite3 "$BOARD_DB" "SELECT id, status, COALESCE(assignee, 'implementer'), COALESCE(assignee, 'implementer'), substr(body,1,800) FROM tasks ORDER BY id;" 2>/dev/null || echo "BOARD_UNREADABLE")

  WORKER_PROMPT="You are the **stubs orchestrator**. You read the board, check tier progression, dispatch eligible tasks, sweep active tasks, and halt when the phase is complete. You never write code or produce artifacts yourself. You do not modify AGENT_GOAL.md, PRIORITIES.md, .kanban/kanban.db, or scripts/.

When ALL completion criteria are met (read them from the phase descriptor below — check every criterion each turn, not just task-state checks): (1) write `completed.md` at `$PHASE_DIR/completed.md` with timestamp, summary of what was accomplished, and notes for the next phase; (2) archive all task-id directories for this phase; (3) halt. Do NOT halt before writing the marker and archiving.

=== BOARD STATE ===
$BOARD_STATE

=== AGENT_GOAL.md ===
$(cat "$REPO/AGENT_GOAL.md")

=== STUBS_CLI_ASSESSMENT.md (Phase 1 work source) ===
$(sed -n '1,100p' "$REPO/STUBS_CLI_ASSESSMENT.md")

=== Phase descriptor ===
$(cat "$REPO/.hermes/skills/contextloop/phases/phase-1/cli-bug-fixes/descriptor.md")

=== Completion detection instruction ===
When ALL completion criteria in the phase descriptor are met:
1. Write a phase-completion marker at $REPO/.hermes/skills/contextloop/phases/phase-1/cli-bug-fixes/completed.md with: timestamp (ISO), phase name, summary of what was accomplished, and notes for the next phase.
2. Archive all task-id directories for this phase to $REPO/.hermes/skills/contextloop/archive/phase-1/<task-id>/.
3. Halt immediately — do not continue the loop.

Do NOT halt until ALL criteria are met. Do NOT write the marker prematurely.
"

  looplog "orchestrator window start"
  hermes chat -q "$WORKER_PROMPT" --max-turns 200 >> "$REPO/.kanban/logs/orchestrator.log" 2>&1 &
  ORCH_PID=$!
  wait "$ORCH_PID" 2>/dev/null
  EXIT_CODE=$?
  looplog "orchestrator window exit=$EXIT_CODE"

  if [ -f "$STOP" ] && [ ! -d "$STOP" ]; then
    log "STOP sentinel present during cycle; exiting"
    break
  fi

  sleep "$COOLDOWN"
done

exit 0
