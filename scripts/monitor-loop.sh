#!/bin/bash
# stubs loop monitor (watchdog). Polls every 60s.
#  - launches the wrapper if missing/dead (launchd also KeepAlives it; this is belt-and-suspenders)
#  - detects a wedged child (SYN_SENT, 0 children, 0 established sockets, stale log) and kills ONLY the child
#  - never writes the wrapper pidfile (wrapper owns it)
#  - liveness decision uses BOTH HEARTBEAT and the per-tool-call loop.log, per ADR-082 discipline
set -u

case ":$PATH:" in
  *":/Users/lappier/.local/bin:"*) ;;
  *) PATH="/Users/lappier/.local/bin:/usr/local/bin:$PATH" ;;
esac
export PATH

REPO="/Users/lappier/code/projects/stubs"
PIDDIR="$REPO/.desktop"
mkdir -p "$PIDDIR"
MONITOR_PID="$PIDDIR/monitor.pid"
WRAPPER_PID="$PIDDIR/run-loop-wrapper.pid"
CHILD_PID="$PIDDIR/run-loop-child.pid"
HEARTBEAT="$REPO/HEARTBEAT"
LOOPLOG="$PIDDIR/loop.log"
LOG="$PIDDIR/monitor.log"
ALERT="$PIDDIR/monitor-supervision"
STOP="$REPO/STOP"

MAX_NO_HEARTBEAT_SECONDS=3600
POLL=60

# Single-instance guard via pidfile (but never block launchd's own process).
if [ -f "$MONITOR_PID" ]; then
  EXISTING=$(cat "$MONITOR_PID" 2>/dev/null)
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "$$" ] && kill -0 "$EXISTING" 2>/dev/null; then
    # another monitor alive — do not start a twin
    exit 0
  fi
fi
echo "$$" > "$MONITOR_PID"
echo "=== monitor start pid=$$ ===" >> "$LOG"

mtime() { case "$(uname)" in Darwin) stat -f %m "$1" 2>/dev/null || echo 0;; *) stat -c %Y "$1" 2>/dev/null || echo 0;; esac; }
now() { date +%s; }

launch_wrapper() {
  echo "[$(date -u +%FT%TZ)] ACTION launching wrapper (reason: $1)" >> "$LOG"
  nohup bash "$REPO/scripts/run-loop.sh" >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

while true; do
  sleep "$POLL"

  # 0. STOP sentinel -> stand down but stay alive (launchd keeps us; we just idle)
  if [ -f "$STOP" ]; then
    echo "[$(date -u +%FT%TZ)] STOP present; idling" >> "$LOG"
    continue
  fi

  # 1. wrapper liveness
  WRAPPER_ALIVE=0
  if [ -f "$WRAPPER_PID" ]; then
    WP=$(cat "$WRAPPER_PID" 2>/dev/null)
    if [ -n "$WP" ] && kill -0 "$WP" 2>/dev/null; then WRAPPER_ALIVE=1; fi
  fi
  if [ "$WRAPPER_ALIVE" -eq 0 ]; then
    echo "[$(date -u +%FT%TZ)] wrapper missing/dead; launching" >> "$LOG"
    launch_wrapper "wrapper-missing"
    continue
  fi

  # 2. child liveness
  CHILD_ALIVE=0; CHILD=0
  if [ -f "$CHILD_PID" ]; then
    CHILD=$(cat "$CHILD_PID" 2>/dev/null)
    if [ -n "$CHILD" ] && kill -0 "$CHILD" 2>/dev/null; then CHILD_ALIVE=1; fi
  fi
  if [ "$CHILD_ALIVE" -eq 0 ]; then
    # wrapper will self-relaunch the child; just note it
    echo "[$(date -u +%FT%TZ)] child not running (wrapper will respawn)" >> "$LOG"
    continue
  fi

  # 3. liveness age (BOTH signals)
  HB_AGE=$(( $(now) - $(mtime "$HEARTBEAT") ))
  LL_AGE=$(( $(now) - $(mtime "$LOOPLOG") ))

  # 4. WEDGED-CHILD rule (rule 4b): runs before the stale-heartbeat suppression.
  #    Kill ONLY the child when: wrapper+child alive, hb stale > threshold,
  #    loop.log stale > 600s, ZERO established TCP sockets, 3 consecutive polls.
  ESTAB=""
  if command -v lsof >/dev/null 2>&1; then
    ESTAB_RAW=$(lsof -nP -a -p "$CHILD" -iTCP -sTCP:ESTABLISHED 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
    case "$ESTAB_RAW" in ''|*[!0-9]*) ESTAB="" ;; *) ESTAB="$ESTAB_RAW" ;; esac
  fi
  WEDGE_CONSEC_FILE="$PIDDIR/wedge-polls"
  if [ "$HB_AGE" -gt "$MAX_NO_HEARTBEAT_SECONDS" ] && [ "$LL_AGE" -gt 600 ]; then
    if [ -z "$ESTAB" ]; then
      : # lsof missing -> unknown -> skip (never kill on unknown)
    elif [ "$ESTAB" -eq 0 ]; then
      N=$(cat "$WEDGE_CONSEC_FILE" 2>/dev/null || echo 0)
      N=$((N+1)); echo "$N" > "$WEDGE_CONSEC_FILE"
      if [ "$N" -ge 3 ]; then
        echo "[$(date -u +%FT%TZ)] WEDGED child=$CHILD (hb=${HB_AGE}s ll=${LL_AGE}s estab=0, polls=$N); killing child only" >> "$LOG"
        kill -TERM "$CHILD" 2>/dev/null
        rm -f "$WEDGE_CONSEC_FILE"
        continue
      fi
    else
      rm -f "$WEDGE_CONSEC_FILE"
    fi
  else
    rm -f "$WEDGE_CONSEC_FILE"
  fi

  # 5. stale-heartbeat suppression (long iteration is NOT a dead loop)
  if [ "$HB_AGE" -gt "$MAX_NO_HEARTBEAT_SECONDS" ]; then
    if [ "$LL_AGE" -le 600 ]; then
      # fresh loop.log => working, not stalled
      echo "[$(date -u +%FT%TZ)] Restart suppressed: wrapper+child alive (iteration in progress), hb_age=${HB_AGE}s loop.log_age=${LL_AGE}s" >> "$LOG"
      rm -f "$ALERT"
      continue
    else
      # BOTH stale => real stall. Alert but do not kill (wrapper+child alive).
      echo "[$(date -u +%FT%TZ)] loop.stalled hb=${HB_AGE}s loop.log=${LL_AGE}s" >> "$ALERT"
      continue
    fi
  fi

  rm -f "$ALERT"
done
