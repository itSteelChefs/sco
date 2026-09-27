#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

# shellcheck source=scripts/recovery/recovery-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-lib.sh"

archive=''
envelope=''
age_identity=''
signature=''
signing_public_key=''
confirm_database=''
confirm_target=''
environment=''
report_path=''
while (($#)); do
  case "$1" in
    --archive) archive="${2:-}"; shift 2 ;;
    --envelope) envelope="${2:-}"; shift 2 ;;
    --age-identity) age_identity="${2:-}"; shift 2 ;;
    --signature) signature="${2:-}"; shift 2 ;;
    --signing-public-key) signing_public_key="${2:-}"; shift 2 ;;
    --confirm-database) confirm_database="${2:-}"; shift 2 ;;
    --confirm-target) confirm_target="${2:-}"; shift 2 ;;
    --environment) environment="${2:-}"; shift 2 ;;
    --report) report_path="${2:-}"; shift 2 ;;
    *) fail_recovery "UNKNOWN_ARGUMENT:$1" ;;
  esac
done

[[ -f "$archive" && -f "$envelope" && -f "$age_identity" && -f "$signature" && -f "$signing_public_key" && -n "$confirm_database" && -n "$confirm_target" && -n "$environment" ]] || fail_recovery 'ARCHIVE_ENVELOPE_KEYS_CONFIRMATIONS_AND_ENVIRONMENT_REQUIRED'
[[ "$environment" != 'production' && "$environment" != 'prod' ]] || fail_recovery 'PRODUCTION_RESTORE_REFUSED'
[[ "$environment" =~ ^(local-drill|test|development|staging)$ ]] || fail_recovery 'INVALID_RESTORE_ENVIRONMENT'
require_environment SCO_RESTORE_DATABASE_URL
for name in SCO_RESTORE_S3_BUCKET SCO_RESTORE_S3_REGION RUNTIME_DATABASE_PASSWORD SCO_INTERNAL_DATABASE_PASSWORD; do require_environment "$name"; done
for command_name in age jq openssl sha256sum tar; do require_command "$command_name"; done
select_postgres_tools

work_root="${SCO_RESTORE_WORK_ROOT:-/dev/shm}"
[[ -d "$work_root" ]] || fail_recovery 'RESTORE_WORK_ROOT_MISSING'
if [[ "$environment" == 'staging' ]]; then
  [[ "$(findmnt -n -o FSTYPE -T "$work_root")" == 'tmpfs' ]] || fail_recovery 'PLAINTEXT_WORK_ROOT_MUST_BE_TMPFS'
fi
work_directory="$(mktemp -d "$work_root/sco-recovery-restore.XXXXXX")"
cleanup() { rm -rf "$work_directory"; }
trap cleanup EXIT INT TERM
start_milliseconds="$(date +%s%3N)"

openssl pkeyutl -verify -rawin -pubin -inkey "$signing_public_key" -in "$envelope" -sigfile "$signature" >/dev/null 2>&1 || fail_recovery 'RECOVERY_ENVELOPE_SIGNATURE_FAILED'
jq -e '.kind == "sco-recovery-envelope" and .schemaVersion == 1 and .encryption == "age-x25519" and (.sha256 | test("^[a-f0-9]{64}$"))' "$envelope" >/dev/null || fail_recovery 'INVALID_RECOVERY_ENVELOPE'
[[ "$(jq -r '.archive' "$envelope")" == "$(basename "$archive")" ]] || fail_recovery 'ENVELOPE_ARCHIVE_MISMATCH'
expected_archive_hash="$(jq -r '.sha256' "$envelope")"
[[ "$(sha256sum "$archive" | awk '{print $1}')" == "$expected_archive_hash" ]] || fail_recovery 'ENCRYPTED_ARCHIVE_CHECKSUM_FAILED'
age --decrypt --identity "$age_identity" --output "$work_directory/recovery.tar" "$archive"
assert_safe_archive_entries "$work_directory/recovery.tar"
mkdir "$work_directory/set"
tar --extract --file "$work_directory/recovery.tar" --directory "$work_directory/set" --no-same-owner --no-same-permissions
node "$RECOVERY_ROOT/apps/api/scripts/recovery/manifest-cli.mjs" verify --root "$work_directory/set"
backup_id="$(jq -r '.backupId' "$work_directory/set/manifest.json")"
[[ "$backup_id" == "$(jq -r '.backupId' "$envelope")" ]] || fail_recovery 'ENVELOPE_MANIFEST_BACKUP_ID_MISMATCH'

configure_postgres_connection SCO_RESTORE_DATABASE_URL "$work_directory/postgres-connection"
server_version="$(assert_postgres_17)"
source_server_version="$(jq -r '.database.serverVersion' "$work_directory/set/manifest.json")"
[[ "${source_server_version%%.*}" == "${server_version%%.*}" ]] || fail_recovery 'POSTGRESQL_RESTORE_MAJOR_MISMATCH'
[[ "$confirm_database" == "RESTORE:$PGDATABASE" ]] || fail_recovery 'RESTORE_DATABASE_CONFIRMATION_MISMATCH'
[[ "$confirm_target" == "RESTORE:$PGHOST:$PGPORT/$PGDATABASE" ]] || fail_recovery 'RESTORE_TARGET_CONFIRMATION_MISMATCH'
[[ ! "$PGDATABASE" =~ ^(postgres|template0|template1)$ ]] || fail_recovery 'SYSTEM_DATABASE_RESTORE_REFUSED'
relation_count="$($PSQL -X -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f')")"
[[ "$relation_count" == '0' ]] || fail_recovery 'RESTORE_DATABASE_NOT_EMPTY'

log_recovery info restore_started --arg backup_id "$backup_id" --arg environment "$environment"
DATABASE_URL="$SCO_RESTORE_DATABASE_URL" node "$RECOVERY_ROOT/apps/api/scripts/provision-runtime-role.mjs"
"$PG_RESTORE" --exit-on-error --single-transaction --no-owner --dbname="$PGDATABASE" "$work_directory/set/database.dump"
DATABASE_URL="$SCO_RESTORE_DATABASE_URL" node "$RECOVERY_ROOT/apps/api/scripts/provision-runtime-role.mjs"
DATABASE_URL="$SCO_RESTORE_DATABASE_URL" corepack pnpm --filter @sco/api exec prisma migrate status --schema prisma/schema.prisma
node "$RECOVERY_ROOT/apps/api/scripts/recovery/object-store.mjs" restore --root "$work_directory/set" --backup-id "$backup_id"
[[ -n "$report_path" ]] || report_path="$work_directory/reconciliation.json"
node "$RECOVERY_ROOT/apps/api/scripts/recovery/object-store.mjs" reconcile --inventory "$work_directory/set/objects/inventory.json" --report "$report_path"
duration_milliseconds="$(( $(date +%s%3N) - start_milliseconds ))"
log_recovery info restore_completed --arg backup_id "$backup_id" --arg archive_sha256 "$expected_archive_hash" --argjson duration_ms "$duration_milliseconds"