#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"

LABEL="${LAUNCHD_LABEL:-com.ipmds.backup}"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-$SCRIPT_DIR/backup-db.sh}"

BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_MINUTE="${BACKUP_MINUTE:-30}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/ipmds-backups}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"

STDOUT_LOG="${STDOUT_LOG:-$HOME/Library/Logs/${LABEL}.log}"
STDERR_LOG="${STDERR_LOG:-$HOME/Library/Logs/${LABEL}.err.log}"

ensure_launch_agents_dir() {
  mkdir -p "$HOME/Library/LaunchAgents"
  mkdir -p "$HOME/Library/Logs"
}

write_plist() {
  ensure_launch_agents_dir

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${BACKUP_SCRIPT}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>RCLONE_REMOTE</key>
    <string>${RCLONE_REMOTE}</string>
    <key>BACKUP_DIR</key>
    <string>${BACKUP_DIR}</string>
    <key>LOCAL_RETENTION_DAYS</key>
    <string>${LOCAL_RETENTION_DAYS}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${BACKUP_HOUR}</integer>
    <key>Minute</key>
    <integer>${BACKUP_MINUTE}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${STDOUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
</dict>
</plist>
EOF
}

install_job() {
  if [[ ! -x "$BACKUP_SCRIPT" ]]; then
    echo "[backup-launchd] Backup script not executable: $BACKUP_SCRIPT"
    exit 1
  fi
  write_plist
  launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl load "$PLIST_PATH"
  echo "[backup-launchd] Installed: $PLIST_PATH"
  echo "[backup-launchd] Schedule: ${BACKUP_HOUR}:$(printf "%02d" "$BACKUP_MINUTE") daily"
}

uninstall_job() {
  launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "[backup-launchd] Uninstalled: $PLIST_PATH"
}

status_job() {
  if [[ ! -f "$PLIST_PATH" ]]; then
    echo "[backup-launchd] Not installed: $PLIST_PATH"
    exit 0
  fi
  echo "[backup-launchd] Installed plist: $PLIST_PATH"
  launchctl list | grep -E "${LABEL}$" || echo "[backup-launchd] launchctl list: not currently loaded"
}

run_now() {
  /bin/bash "$BACKUP_SCRIPT"
}

usage() {
  cat <<'EOF'
Usage:
  ./scripts/backup-launchd.sh install
  ./scripts/backup-launchd.sh uninstall
  ./scripts/backup-launchd.sh status
  ./scripts/backup-launchd.sh run-now

Optional env vars:
  BACKUP_HOUR=2 BACKUP_MINUTE=30
  RCLONE_REMOTE='oss:ipmds-backups'
  BACKUP_DIR="$HOME/ipmds-backups"
  LOCAL_RETENTION_DAYS=7
  LAUNCHD_LABEL='com.ipmds.backup'
EOF
}

case "$ACTION" in
  install) install_job ;;
  uninstall) uninstall_job ;;
  status) status_job ;;
  run-now) run_now ;;
  *) usage ;;
esac
