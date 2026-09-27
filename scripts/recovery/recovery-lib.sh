#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

RECOVERY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export RECOVERY_ROOT

log_recovery() {
  local level="$1"
  local event="$2"
  shift 2
  jq -cn --arg level "$level" --arg event "$event" '$ARGS.named' "$@"
}

fail_recovery() {
  log_recovery error recovery_failed --arg reason "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail_recovery "REQUIRED_COMMAND_MISSING:$1"
}

require_environment() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail_recovery "REQUIRED_ENVIRONMENT_MISSING:$name"
}

select_postgres_tools() {
  local candidate="${SCO_RECOVERY_PG_BIN:-/usr/lib/postgresql/17/bin}"
  [[ -x "$candidate/psql" && -x "$candidate/pg_dump" && -x "$candidate/pg_restore" ]] || fail_recovery 'POSTGRESQL_17_CLIENT_TOOLS_REQUIRED'
  PSQL="$candidate/psql"
  PG_DUMP="$candidate/pg_dump"
  PG_RESTORE="$candidate/pg_restore"
  export PSQL PG_DUMP PG_RESTORE
}

configure_postgres_connection() {
  local url_environment="$1"
  local connection_directory="$2"
  node "$RECOVERY_ROOT/apps/api/scripts/recovery/write-pg-connection.mjs" "$url_environment" "$connection_directory"
  local configuration="$connection_directory/connection.json"
  export PGHOST PGPORT PGDATABASE PGUSER PGPASSFILE
  PGHOST="$(jq -er '.host' "$configuration")"
  PGPORT="$(jq -er '.port' "$configuration")"
  PGDATABASE="$(jq -er '.database' "$configuration")"
  PGUSER="$(jq -er '.user' "$configuration")"
  PGPASSFILE="$(jq -er '.passwordFile' "$configuration")"
  export PGAPPNAME="sco-recovery"
  PGCONNECT_TIMEOUT="$(jq -r '.parameters.connect_timeout // "10"' "$configuration")"
  export PGCONNECT_TIMEOUT
  local parameter
  for parameter in sslmode sslrootcert sslcert sslkey; do
    local value
    value="$(jq -r --arg parameter "$parameter" '.parameters[$parameter] // empty' "$configuration")"
    if [[ -n "$value" ]]; then
      export "PG${parameter^^}=$value"
    else
      unset "PG${parameter^^}" 2>/dev/null || true
    fi
  done
}

assert_postgres_17() {
  local server_version
  server_version="$($PSQL -X -v ON_ERROR_STOP=1 -Atc 'SHOW server_version')"
  [[ "${server_version%%.*}" == '17' ]] || fail_recovery "POSTGRESQL_SERVER_MAJOR_UNSUPPORTED:${server_version%%.*}"
  [[ "$($PSQL --version)" == *' 17.'* && "$($PG_DUMP --version)" == *' 17.'* && "$($PG_RESTORE --version)" == *' 17.'* ]] || fail_recovery 'POSTGRESQL_CLIENT_MAJOR_MUST_BE_17'
  printf '%s' "$server_version"
}

assert_restore_environment() {
  local expected_environment="$1"
  local actual_environment
  local effective_environment
  actual_environment="$($PSQL -X -v ON_ERROR_STOP=1 -Atc "
    SELECT COALESCE((
      SELECT split_part(setting, '=', 2)
      FROM pg_db_role_setting AS settings
      CROSS JOIN LATERAL unnest(settings.setconfig) AS setting
      WHERE settings.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND settings.setrole = 0
        AND split_part(setting, '=', 1) = 'sco.environment'
    ), '')")"
  effective_environment="$($PSQL -X -v ON_ERROR_STOP=1 -Atc "SELECT current_setting('sco.environment', true)")"
  [[ "$actual_environment" =~ ^(development|test|staging|production)$ ]] || fail_recovery 'RESTORE_TARGET_ENVIRONMENT_INVALID'
  [[ "$actual_environment" != 'production' ]] || fail_recovery 'PRODUCTION_RESTORE_REFUSED'
  [[ "$effective_environment" == "$actual_environment" ]] || fail_recovery 'RESTORE_TARGET_ENVIRONMENT_OVERRIDE_REFUSED'
  [[ "$expected_environment" =~ ^(development|test|staging|production)$ ]] || fail_recovery 'EXPECTED_RESTORE_ENVIRONMENT_INVALID'
  [[ "$expected_environment" != 'production' ]] || fail_recovery 'PRODUCTION_RESTORE_REFUSED'
  [[ "$expected_environment" == "$actual_environment" ]] || fail_recovery 'RESTORE_TARGET_ENVIRONMENT_MISMATCH'
  printf '%s' "$actual_environment"
}

assert_safe_archive_entries() {
  local archive="$1"
  local entry
  while IFS= read -r entry; do
    [[ -n "$entry" && "$entry" != /* && "$entry" != *'../'* && "$entry" != '..' ]] || fail_recovery 'UNSAFE_ARCHIVE_PATH'
  done < <(tar -tf "$archive")
  if tar -tvf "$archive" | awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { exit 1 }'; then
    :
  else
    fail_recovery 'UNSAFE_ARCHIVE_ENTRY_TYPE'
  fi
}