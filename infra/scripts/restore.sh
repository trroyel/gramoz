#!/usr/bin/env bash
# ── Gramoz Operational PostgreSQL Disaster Recovery / Restore Script (TASK-27F) ──
set -euo pipefail

BACKUP_SOURCE="${1:?Usage: $0 <backup_file_or_s3_uri> [target_db_name]}"
TARGET_DB="${2:-platform_db}"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-platform_user}"
DB_PASSWORD="${PLATFORM_DB_PASSWORD:-${DB_PASSWORD:-platform_pass}}"
CONTAINER_NAME="${DOCKER_CONTAINER:-gramoz-postgres-1}"

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Starting database restore into '${TARGET_DB}'..."

LOCAL_BACKUP_FILE="${BACKUP_SOURCE}"
TEMP_DOWNLOAD_DIR=""

# If source is an S3 URI, download first
if [[ "${BACKUP_SOURCE}" =~ ^s3:// ]]; then
    TEMP_DOWNLOAD_DIR="$(mktemp -d /tmp/gramoz_s3_download_XXXXXX)"
    echo "Downloading remote backup from S3: ${BACKUP_SOURCE}..."
    if command -v aws &> /dev/null; then
        aws s3 cp "${BACKUP_SOURCE}" "${TEMP_DOWNLOAD_DIR}/"
        LOCAL_BACKUP_FILE="${TEMP_DOWNLOAD_DIR}/$(basename "${BACKUP_SOURCE}")"
        # Attempt downloading corresponding sha256 checksum
        aws s3 cp "${BACKUP_SOURCE%.enc}.sha256" "${TEMP_DOWNLOAD_DIR}/" || true
    else
        echo "ERROR: Remote s3:// source specified but aws CLI is not installed!" >&2
        exit 1
    fi
fi

RESTORE_INPUT="${LOCAL_BACKUP_FILE}"

# If encrypted, decrypt to temporary file
TEMP_DECRYPTED=""
if [[ "${LOCAL_BACKUP_FILE}" == *.enc ]]; then
    if [ -z "${ENCRYPTION_PASSPHRASE:-}" ]; then
        echo "ERROR: Backup file is encrypted but ENCRYPTION_PASSPHRASE is not set!" >&2
        exit 1
    fi
    TEMP_DECRYPTED="$(mktemp /tmp/gramoz_restore_XXXXXX.dump)"
    echo "Decrypting ${LOCAL_BACKUP_FILE} via AES-256-CBC (PBKDF2)..."
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in "${LOCAL_BACKUP_FILE}" -out "${TEMP_DECRYPTED}" -pass pass:"${ENCRYPTION_PASSPHRASE}"
    RESTORE_INPUT="${TEMP_DECRYPTED}"
fi

# Verify SHA-256 checksum if .sha256 file exists alongside backup
CHECKSUM_FILE="${LOCAL_BACKUP_FILE%.enc}.sha256"
if [ -f "${CHECKSUM_FILE}" ]; then
    echo "Verifying SHA-256 integrity checksum..."
    CHECKSUM_BASE_FILE="$(basename "${LOCAL_BACKUP_FILE%.enc}")"
    EXPECTED_HASH="$(awk '{print $1}' "${CHECKSUM_FILE}")"
    ACTUAL_HASH="$(sha256sum "${RESTORE_INPUT}" | awk '{print $1}')"
    if [ "${EXPECTED_HASH}" != "${ACTUAL_HASH}" ]; then
        echo "ERROR: SHA-256 checksum mismatch! Expected ${EXPECTED_HASH}, computed ${ACTUAL_HASH}." >&2
        exit 1
    fi
    echo "Checksum verification PASSED (${EXPECTED_HASH})."
fi

echo "Executing pg_restore into database '${TARGET_DB}'..."
set +e
if command -v pg_restore &> /dev/null; then
    export PGPASSWORD="${DB_PASSWORD}"
    pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${TARGET_DB}" \
      --clean --if-exists --no-owner --no-privileges --verbose "${RESTORE_INPUT}" 2>&1
    RESTORE_STATUS=$?
elif docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Host pg_restore not found; streaming restore into docker container '${CONTAINER_NAME}'..."
    cat "${RESTORE_INPUT}" | docker exec -i -e PGPASSWORD="${DB_PASSWORD}" "${CONTAINER_NAME}" \
      pg_restore -U "${DB_USER}" -d "${TARGET_DB}" --clean --if-exists --no-owner --no-privileges --verbose 2>&1
    RESTORE_STATUS=$?
else
    echo "ERROR: Neither host pg_restore nor running Docker container '${CONTAINER_NAME}' was found!" >&2
    exit 1
fi
set -e

# Cleanup temporary files
if [ -n "${TEMP_DECRYPTED}" ] && [ -f "${TEMP_DECRYPTED}" ]; then
    rm -f "${TEMP_DECRYPTED}"
fi
if [ -n "${TEMP_DOWNLOAD_DIR}" ] && [ -d "${TEMP_DOWNLOAD_DIR}" ]; then
    rm -rf "${TEMP_DOWNLOAD_DIR}"
fi

# pg_restore exit code 0 is clean success; exit code 1 can indicate benign warnings (e.g. drop if exists on fresh tables)
if [ ${RESTORE_STATUS} -eq 0 ] || [ ${RESTORE_STATUS} -eq 1 ]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Database restore completed successfully with status code ${RESTORE_STATUS}."
    exit 0
else
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ERROR: pg_restore failed with exit code ${RESTORE_STATUS}!" >&2
    exit ${RESTORE_STATUS}
fi
