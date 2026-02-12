#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Configurable via env
BACKUP_DIR="${BACKUP_DIR:-$HOME/ipmds-backups}"
DB_NAME="${DB_NAME:-ipmds2}"
DB_USER="${DB_USER:-ipmds_user}"
DB_PASSWORD="${DB_PASSWORD:-ipmds_pass}"
DB_HOST_IN_CONTAINER="${DB_HOST_IN_CONTAINER:-127.0.0.1}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"

# Optional cloud upload (rclone)
RCLONE_REMOTE="${RCLONE_REMOTE:-}" # e.g. oss:ipmds-backups

detect_container() {
  if docker ps --format '{{.Names}}' | grep -q '^ipmds-postgres$'; then
    echo "ipmds-postgres"
    return
  fi
  if docker ps --format '{{.Names}}' | grep -q '^ipmds-postgres-prod$'; then
    echo "ipmds-postgres-prod"
    return
  fi
  echo ""
}

DB_CONTAINER="${DB_CONTAINER:-$(detect_container)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "[backup-db] No running postgres container found (expected ipmds-postgres or ipmds-postgres-prod)."
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%F_%H%M%S)"
OUT_FILE="$BACKUP_DIR/${DB_NAME}_${TS}.sql.gz"

echo "[backup-db] Dumping ${DB_NAME} from container ${DB_CONTAINER} ..."
docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
  pg_dump -h "$DB_HOST_IN_CONTAINER" -U "$DB_USER" -d "$DB_NAME" \
  | gzip > "$OUT_FILE"

echo "[backup-db] Backup created: $OUT_FILE"

if [[ -n "$RCLONE_REMOTE" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    echo "[backup-db] Uploading to $RCLONE_REMOTE ..."
    rclone copy "$OUT_FILE" "$RCLONE_REMOTE"
    echo "[backup-db] Upload completed."
  else
    echo "[backup-db] rclone not found; skipping cloud upload."
  fi
fi

echo "[backup-db] Cleaning local backups older than ${LOCAL_RETENTION_DAYS} days ..."
find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +"$LOCAL_RETENTION_DAYS" -delete

echo "[backup-db] Done."
