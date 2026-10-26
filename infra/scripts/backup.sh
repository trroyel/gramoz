#!/usr/bin/env bash
# ── Gramoz Operational PostgreSQL Backup Script (TASK-27F Hardened) ─────────────
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/trroyel/gramoz/infra/backups}"
LOCK_FILE="/tmp/gramoz_backup.lock"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/gramoz_backup_${TIMESTAMP}.dump"
LOG_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.log"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-platform_db}"
DB_USER="${DB_USER:-platform_user}"
DB_PASSWORD="${PLATFORM_DB_PASSWORD:-${DB_PASSWORD:-platform_pass}}"
CONTAINER_NAME="${DOCKER_CONTAINER:-gramoz-postgres-1}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
OFFSITE_S3_URI="${OFFSITE_S3_URI:-}"

# ── 1. Concurrency Lock: Prevent Overlapping Backup Jobs ─────────────────────
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] WARNING: Another backup is already in progress. Exiting cleanly." | tee -a "${BACKUP_DIR}/backup_overlap.log"
    exit 0
fi

# Failure alert notification function
trigger_alert() {
    local error_msg="$1"
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ALERT: ${error_msg}" >&2
    if [ -n "${ALERT_WEBHOOK_URL}" ]; then
        curl -s -X POST -H "Content-Type: application/json" \
          -d "{\"text\":\"[Gramoz SRE Alert] Backup Failure on ${DB_NAME}: ${error_msg}\"}" \
          "${ALERT_WEBHOOK_URL}" || true
    fi
}

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting automated logical backup for database '${DB_NAME}'..." | tee -a "${LOG_FILE}"

# ── 2. Execute pg_dump (Custom Compressed Archive Format -Fc) ─────────────────
DUMP_SUCCESS=false

if command -v pg_dump &> /dev/null; then
    export PGPASSWORD="${DB_PASSWORD}"
    if pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -Fc -f "${BACKUP_FILE}" 2>> "${LOG_FILE}"; then
        DUMP_SUCCESS=true
    fi
elif docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Host pg_dump not found; executing pg_dump via docker container '${CONTAINER_NAME}'..." | tee -a "${LOG_FILE}"
    if docker exec -e PGPASSWORD="${DB_PASSWORD}" "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" -Fc > "${BACKUP_FILE}" 2>> "${LOG_FILE}"; then
        DUMP_SUCCESS=true
    fi
else
    trigger_alert "Neither host pg_dump nor running Docker container '${CONTAINER_NAME}' was found."
    exit 1
fi

if [ "${DUMP_SUCCESS}" = true ] && [ -s "${BACKUP_FILE}" ]; then
    BACKUP_SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Backup completed successfully: ${BACKUP_FILE} (Size: ${BACKUP_SIZE})" | tee -a "${LOG_FILE}"

    # Generate SHA-256 checksum for tamper detection and restore verification
    sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Generated checksum: $(cat "${BACKUP_FILE}.sha256")" | tee -a "${LOG_FILE}"

    FINAL_UPLOAD_TARGET="${BACKUP_FILE}"

    # Optional symmetric encryption with OpenSSL if ENCRYPTION_PASSPHRASE is provided
    if [ -n "${ENCRYPTION_PASSPHRASE:-}" ]; then
        openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 -in "${BACKUP_FILE}" -out "${BACKUP_FILE}.enc" -pass pass:"${ENCRYPTION_PASSPHRASE}"
        rm -f "${BACKUP_FILE}"
        FINAL_UPLOAD_TARGET="${BACKUP_FILE}.enc"
        echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Encrypted backup generated with AES-256-CBC: ${FINAL_UPLOAD_TARGET}" | tee -a "${LOG_FILE}"
    fi

    # ── 3. Offsite Cloud Storage Upload Hook ─────────────────────────────────
    if [ -n "${OFFSITE_S3_URI}" ]; then
        echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Uploading backup to offsite cloud storage: ${OFFSITE_S3_URI}..." | tee -a "${LOG_FILE}"
        if command -v aws &> /dev/null; then
            aws s3 cp "${FINAL_UPLOAD_TARGET}" "${OFFSITE_S3_URI}/" 2>> "${LOG_FILE}"
            aws s3 cp "${BACKUP_FILE}.sha256" "${OFFSITE_S3_URI}/" 2>> "${LOG_FILE}"
            echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Offsite cloud sync completed." | tee -a "${LOG_FILE}"
        else
            echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] WARNING: aws CLI not installed. Offsite upload skipped." | tee -a "${LOG_FILE}"
        fi
    else
        echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] OFFSITE_S3_URI not configured. Backup retained locally (Offsite sync UNEXECUTED)." | tee -a "${LOG_FILE}"
    fi

    # ── 4. Prune Local Backups Older than Retention Policy ───────────────────
    find "${BACKUP_DIR}" -name "gramoz_backup_*.dump*" -type f -mtime "+${RETENTION_DAYS}" -delete || true
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Retention policy enforced: removed local backups older than ${RETENTION_DAYS} days." | tee -a "${LOG_FILE}"

    echo "BACKUP_SUCCESS=${FINAL_UPLOAD_TARGET}"
else
    trigger_alert "pg_dump failed or produced an empty backup file. Check log: ${LOG_FILE}"
    exit 1
fi
