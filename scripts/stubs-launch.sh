#!/bin/bash
# Stubs local launcher — starts web portal server and opens browser.
set -u
REPO="/Users/lappier/code/projects/stubs"
cd "$REPO" || exit 1
PORT=3001

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Stubs portal already running on port $PORT"
else
  echo "Starting stubs serve on port $PORT..."
  nohup /Users/lappier/.local/bin/node .agents/skills/stubs/dist/cli.cjs serve -p "$PORT" >/tmp/stubs-serve.log 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > /tmp/stubs-serve.pid
  sleep 2
fi

open "http://localhost:$PORT"
