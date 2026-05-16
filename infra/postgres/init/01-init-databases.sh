#!/usr/bin/env bash
# =============================================================================
# Gramoz — PostgreSQL Database Provisioning Script
#
# Runs automatically on first container start via docker-entrypoint-initdb.d.
# Idempotent: safe to re-run against an already-provisioned instance.
#
# Creates:
#   - platform_user  → owns gramoz platform database
# Isolation:
#   - PUBLIC schema access revoked on database
#
# All credentials are injected via environment — NO hardcoded values.
# =============================================================================

set -euo pipefail

# ── Guard: fail fast if any required variable is missing ──────────────────────
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${PLATFORM_DB_NAME:?PLATFORM_DB_NAME is required}"
: "${PLATFORM_DB_USER:?PLATFORM_DB_USER is required}"
: "${PLATFORM_DB_PASSWORD:?PLATFORM_DB_PASSWORD is required}"

echo "🔧 Provisioning Gramoz databases and users..."

# ── Step 1: Create roles and databases ────────────────────────────────────────
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL

  -- Create platform_user (idempotent)
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PLATFORM_DB_USER}') THEN
      CREATE ROLE "${PLATFORM_DB_USER}" WITH LOGIN PASSWORD '${PLATFORM_DB_PASSWORD}';
      RAISE NOTICE 'Created role: ${PLATFORM_DB_USER}';
    ELSE
      ALTER ROLE "${PLATFORM_DB_USER}" WITH PASSWORD '${PLATFORM_DB_PASSWORD}';
      RAISE NOTICE 'Role already exists, password updated: ${PLATFORM_DB_USER}';
    END IF;
  END
  \$\$;

  -- Harden role: no superuser, no db creation, no role creation
  ALTER ROLE "${PLATFORM_DB_USER}" NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB;

  -- Create gramoz database (idempotent)
  SELECT 'CREATE DATABASE "${PLATFORM_DB_NAME}" OWNER "${PLATFORM_DB_USER}"'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PLATFORM_DB_NAME}')
  \gexec

EOSQL

# ── Step 2: Permissions for gramoz database ───────────────────────────────────
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${PLATFORM_DB_NAME}" <<-EOSQL

  -- Revoke public schema default access
  REVOKE ALL ON SCHEMA public FROM PUBLIC;

  -- Grant full schema ownership to platform_user
  GRANT ALL PRIVILEGES ON SCHEMA public TO "${PLATFORM_DB_USER}";
  GRANT ALL PRIVILEGES ON DATABASE "${PLATFORM_DB_NAME}" TO "${PLATFORM_DB_USER}";

  -- Future tables auto-grant to platform_user
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${PLATFORM_DB_USER}";

EOSQL

echo "✅ Gramoz databases and users provisioned successfully."
echo "   Database: ${PLATFORM_DB_NAME} → User: ${PLATFORM_DB_USER}"
