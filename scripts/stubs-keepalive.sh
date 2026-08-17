#!/bin/bash
# stubs keepalive watcher — tight 60s loop.
# Dead-monitor resurrection + launchd-PATH wedge reload + orphan kill.
# Logs ONLY on ACTION (silent = healthy). CWD-scoped: never touches cntrl/cntnr.
set -u
case ":$PATH:" in *":/Users/lappier/.local/bin:"*) ;; *) PATH="/Users/lappier/.local/bin:/usr/local/bin:$PATH" ;; esac
export PATH

REPO="/Users/lappier/code/projects/stubs"
PIDDIR="$REPO/.desktop"
MONITOR_PID="$PIDDIR/monitor.pid"
PLIST="$REPO/scripts/com.lappier.stubs.monitor.plist"
LOG="$PIDDIR/keepalive.log"
STOP="$REPO/STOP"
NOW() { date -u +%FT%TZ; }

launchctl kickstart -k "gui/$(id -u)/com.lappier.stubs.monitor" >/dev/null 2>&1 || true

while true; do
  sleep 60
  [ -f "$STOP" ] && continue

  # 1. monitor alive?
  MP=$(cat "$MONITOR_PID" 2>/dev/null)
  MON_ALIVE=0
  if [ -n "$MP" ] && kill -0 "$MP" 2>/dev/null; then MON_ALIVE=1; fi
  if [ "$MON_ALIVE" -eq 0 ]; then
    echo "[$(NOW)] ACTION monitor down; launchctl kickstart" >> "$LOG"
    launchctl kickstart -k "gui/$(id -u)/com.lappier.stubs.monitor" 2>/dev/null || \
      launchctl load "$PLIST" 2>/dev/null
    continue
  fi

  # 2. orphan 'hermes chat' for THIS repo (ppid=1, cwd=stubs)?
  for p in $(pgrep -f 'hermes chat'); do
    cw=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
    case "$cw" in
      */projects/stubs)
        pp=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
        if [ "$pp" = "1" ]; then
          echo "[$(NOW)] ACTION kill orphan hermes pid=$p (ppid=1 cwd=stubs)" >> "$LOG"
          kill -TERM "$p" 2>/dev/null
        fi
        ;;
    esac
  done
done
