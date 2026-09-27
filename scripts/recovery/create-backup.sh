#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

# shellcheck source=scripts/recovery/recovery-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-lib.sh"

output_directory=''
destination_kind=''
age_recipient=''
signing_key=''
while (($#)); do
  case "$1" in
    --output-directory) output_directory="${2:-}"; shift 2 ;;
    --destination-kind) destination_kind="${2:-}"; shift 2 ;;
    --age-recipient) age_recipient="${2:-}"; shift 2 ;;
    --signing-key) signing_key="${2:-}"; shift 2 ;;
    *) fail_recovery "UNKNOWN_ARGUMENT:$1" ;;
  esac
done

[[ -n "$output_directory" && -n "$destination_kind" && -n "$age_recipient" && -f "$signing_key" ]] || fail_recovery 'OUTPUT_DESTINATION_ENCRYPTION_AND_SIGNING_REQUIRED'
[[ "$destination_kind" == 'off-host' || "$destination_kind" == 'local-drill' ]] || fail_recovery 'INVALID_DESTINATION_KIND'
require_environment SCO_BACKUP_DATABASE_URL
for name in SCO_BACKUP_S3_BUCKET SCO_BACKUP_S3_REGION; do require_environment "$name"; done
for command_name in age jq openssl sha256sum tar flock; do require_command "$command_name"; done
select_postgres_tools

mkdir -p "$output_directory"
output_directory="$(realpath "$output_directory")"
chmod 0700 "$output_directory"
if [[ "$destination_kind" == 'off-host' ]]; then
  require_environment SCO_BACKUP_OFF_HOST_ROOT
  off_host_root="$(realpath "$SCO_BACKUP_OFF_HOST_ROOT")"
  [[ "$output_directory" == "$off_host_root" || "$output_directory" == "$off_host_root/"* ]] || fail_recovery 'OUTPUT_OUTSIDE_DECLARED_OFF_HOST_ROOT'
  [[ "$(findmnt -n -o SOURCE -T "$output_directory")" != "$(findmnt -n -o SOURCE -T /)" ]] || fail_recovery 'OFF_HOST_DESTINATION_REQUIRED'
  [[ "${SCO_BACKUP_DOCUMENT_WRITES_QUIESCED:-}" == 'true' ]] || fail_recovery 'DOCUMENT_WRITES_MUST_BE_QUIESCED'
else
  [[ "${SCO_RECOVERY_ENVIRONMENT:-}" == 'local-drill' ]] || fail_recovery 'LOCAL_DRILL_ENVIRONMENT_REQUIRED'
fi

work_root="${SCO_BACKUP_WORK_ROOT:-/dev/shm}"
[[ -d "$work_root" ]] || fail_recovery 'BACKUP_WORK_ROOT_MISSING'
if [[ "$destination_kind" == 'off-host' ]]; then
  [[ "$(findmnt -n -o FSTYPE -T "$work_root")" == 'tmpfs' ]] || fail_recovery 'PLAINTEXT_WORK_ROOT_MUST_BE_TMPFS'
fi

exec 9>"$output_directory/.sco-backup.lock"
flock -n 9 || fail_recovery 'BACKUP_ALREADY_RUNNING'
work_directory="$(mktemp -d "$work_root/sco-recovery-backup.XXXXXX")"
temporary_archive=''
cleanup() {
  rm -rf "$work_directory"
  [[ -z "$temporary_archive" ]] || rm -f "$temporary_archive"
}
trap cleanup EXIT INT TERM

start_milliseconds="$(date +%s%3N)"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
backup_id="sco-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 6)"
release_sha="${RELEASE_SHA:-unknown}"
mkdir -p "$work_directory/objects/blobs"
configure_postgres_connection SCO_BACKUP_DATABASE_URL "$work_directory/postgres-connection"
server_version="$(assert_postgres_17)"
database_name="$PGDATABASE"
log_recovery info backup_started --arg backup_id "$backup_id" --arg destination_kind "$destination_kind"

"$PG_DUMP" --format=custom --compress=9 --no-owner --file="$work_directory/database.dump"
"$PSQL" -X -v ON_ERROR_STOP=1 -Atc "SELECT json_build_object('appliedCount', count(*), 'latest', max(migration_name), 'migrations', coalesce(json_agg(migration_name ORDER BY finished_at), '[]'::json)) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" > "$work_directory/database-migrations.json"
node "$RECOVERY_ROOT/apps/api/scripts/recovery/object-store.mjs" export --root "$work_directory" --backup-id "$backup_id" --created-at "$created_at"
node "$RECOVERY_ROOT/apps/api/scripts/recovery/object-store.mjs" reconcile --prefix SCO_BACKUP_S3 --database-url-environment SCO_BACKUP_DATABASE_URL --inventory "$work_directory/objects/inventory.json" --report "$work_directory/objects/reconciliation.json"
node "$RECOVERY_ROOT/apps/api/scripts/recovery/manifest-cli.mjs" create --root "$work_directory" --backup-id "$backup_id" --created-at "$created_at" --release-sha "$release_sha" --server-version "$server_version" --database-name "$database_name"
node "$RECOVERY_ROOT/apps/api/scripts/recovery/manifest-cli.mjs" verify --root "$work_directory"
rm -rf "$work_directory/postgres-connection"

archive_name="$backup_id.tar.age"
envelope_name="$backup_id.envelope.json"
signature_name="$backup_id.envelope.sig"
temporary_archive="$output_directory/.$archive_name.tmp-$$"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -C "$work_directory" -cf - database.dump database-migrations.json manifest.json objects | age --encrypt --recipient "$age_recipient" --output "$temporary_archive"
archive_sha256="$(sha256sum "$temporary_archive" | awk '{print $1}')"
archive_bytes="$(stat -c '%s' "$temporary_archive")"
temporary_envelope="$output_directory/.$envelope_name.tmp-$$"
jq -n --arg backupId "$backup_id" --arg createdAt "$created_at" --arg archive "$archive_name" --arg sha256 "$archive_sha256" --argjson bytes "$archive_bytes" --arg releaseSha "$release_sha" '{kind:"sco-recovery-envelope",schemaVersion:1,backupId:$backupId,createdAt:$createdAt,releaseSha:$releaseSha,encryption:"age-x25519",archive:$archive,sha256:$sha256,bytes:$bytes}' > "$temporary_envelope"
chmod 0600 "$temporary_archive" "$temporary_envelope"
mv "$temporary_archive" "$output_directory/$archive_name"
temporary_archive=''
mv "$temporary_envelope" "$output_directory/$envelope_name"
openssl pkeyutl -sign -rawin -inkey "$signing_key" -in "$output_directory/$envelope_name" -out "$output_directory/$signature_name"
chmod 0600 "$output_directory/$signature_name"
duration_milliseconds="$(( $(date +%s%3N) - start_milliseconds ))"
log_recovery info backup_completed --arg backup_id "$backup_id" --arg sha256 "$archive_sha256" --argjson bytes "$archive_bytes" --argjson duration_ms "$duration_milliseconds"