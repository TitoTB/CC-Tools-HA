#!/usr/bin/env bash
set -euo pipefail

OPTIONS_FILE="/data/options.json"

export CCTOOLS_DATA_DIR="/data"
export CCTOOLS_HOST="0.0.0.0"
export CCTOOLS_PORT="8080"
export TZ="$(jq -r '.timezone // "Europe/Madrid"' "$OPTIONS_FILE" 2>/dev/null || echo "Europe/Madrid")"

mkdir -p /data/screenshots /data/browser-session

display_number="${DISPLAY#:}"
display_number="${display_number%%.*}"
rm -f "/tmp/.X${display_number}-lock" "/tmp/.X11-unix/X${display_number}"
mkdir -p /tmp/.X11-unix

wait_for_process() {
  local name="$1"
  local pid="$2"
  local log_file="$3"
  local check="$4"

  for _ in $(seq 1 300); do
    if eval "$check"; then
      echo "[remote-browser] ${name} listo."
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[remote-browser] ${name} terminó durante el arranque."
      sed "s/^/[${name}] /" "$log_file" >&2 || true
      return 1
    fi
    sleep 0.1
  done

  echo "[remote-browser] ${name} no estuvo disponible a tiempo."
  sed "s/^/[${name}] /" "$log_file" >&2 || true
  return 1
}

Xvfb :99 -screen 0 1366x768x24 >/tmp/xvfb.log 2>&1 &
xvfb_pid=$!
wait_for_process "xvfb" "$xvfb_pid" /tmp/xvfb.log "[[ -S /tmp/.X11-unix/X${display_number} ]]"

x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 >/tmp/x11vnc.log 2>&1 &
x11vnc_pid=$!
wait_for_process "x11vnc" "$x11vnc_pid" /tmp/x11vnc.log "(echo >/dev/tcp/127.0.0.1/5900) >/dev/null 2>&1"

websockify --web /usr/share/novnc 127.0.0.1:6081 localhost:5900 >/tmp/websockify.log 2>&1 &
websockify_pid=$!
wait_for_process "websockify" "$websockify_pid" /tmp/websockify.log "(echo >/dev/tcp/127.0.0.1/6081) >/dev/null 2>&1"

exec npm start
