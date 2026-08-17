#!/bin/bash
# stubs oversight watcher — 30-min cadence over ~12h.
# Real-work vs hollow-output, independent gate re-run, SATURATED.md check.
# Appends a real-work directive to PRIORITIES.md after 2 consecutive hollow windows.
# CWD-scoped; never touches cntrl/cntnr.
set -u
case ":$PATH:" in *":/Users/lappier/.local/bin:"*) ;; *) PATH="/Users/lappier/.local/bin:/usr/local/bin:$PATH" ;; esac
export PATH

REPO="/Users/lappier/code/projects/stubs"
PIDDIR="$REPO/.desktop"
LOG="$PIDDIR/overseer-30m.log"
PRIO="$REPO/PRIORITIES.md"
NOW() { date -u +%FT%TZ; }

HOLLOW_WINDOWS=0

while true; do
  sleep 1800

  # Independent gate re-run (do NOT trust self-report). CI=true caps Jest to 2 workers
  # (operator thermal-throttle directive). 1800s sleep already covers the 180s cooldown.
  cd "$REPO" || exit 1
  CI=true npm run build >/dev/null 2>&1; B=$?
  CI=true npm run build:web >/dev/null 2>&1; BW=$?
  CI=true npm test >/dev/null 2>&1; T=$?
  CI=true npm run lint >/dev/null 2>&1; L=$?

  # Classify changed files in the last window: src/ vs tests/docs.
  SRC=$(find src -type f -newermt '-30 minutes' 2>/dev/null | wc -l | tr -d ' ')
  DOCS=$(find tests knowledge '*.md' -type f -newermt '-30 minutes' 2>/dev/null | wc -l | tr -d ' ')

  echo "[$(NOW)] gate build=$B buildweb=$BW test=$T lint=$L | src_changes=$SRC doc_changes=$DOCS" >> "$LOG"

  if [ "$T" -eq 0 ] && [ "$L" -eq 0 ] && [ "$SRC" -eq 0 ]; then
    HOLLOW_WINDOWS=$((HOLLOW_WINDOWS+1))
    echo "[$(NOW)] HOLLOW window $HOLLOW_WINDOWS (green gate, zero src/ change)" >> "$LOG"
    if [ "$HOLLOW_WINDOWS" -ge 2 ]; then
      echo "" >> "$PRIO"
      echo "<!-- OVERSEER DIRECTIVE $(NOW): 2 consecutive hollow windows (green gate, no src/ change). Prioritize a real src/ task from PHASE 1-4. Do NOT re-run completed phases. -->" >> "$PRIO"
      echo "[$(NOW)] appended real-work directive to PRIORITIES.md" >> "$LOG"
      HOLLOW_WINDOWS=0
    fi
  else
    HOLLOW_WINDOWS=0
  fi

  # SATURATED.md present => verify before trusting.
  if [ -f "$REPO/SATURATED.md" ]; then
    echo "[$(NOW)] SATURATED.md present — operator must verify; gate build=$B test=$T lint=$L" >> "$LOG"
  fi
done
