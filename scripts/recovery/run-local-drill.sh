#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

# shellcheck source=scripts/recovery/recovery-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-lib.sh"
cd "$RECOVERY_ROOT"

for command_name in age-keygen curl docker jq openssl; do require_command "$command_name"; done
select_postgres_tools

postgres_image='postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
s3_image='adobe/s3mock@sha256:ab01a6946750f451ca215a47e91030695b260e4003b8a5a6201d25029b8fca92'
postgres_port="${SCO_DRILL_POSTGRES_PORT:-55442}"
s3_port="${SCO_DRILL_S3_PORT:-59090}"
api_port="${SCO_DRILL_API_PORT:-55443}"
owner_password="$(openssl rand -hex 24)"
runtime_password="$(openssl rand -hex 24)"
internal_password="$(openssl rand -hex 24)"
s3_access_key="$(openssl rand -hex 16)"
s3_secret_key="$(openssl rand -hex 32)"
session_secret="$(openssl rand -hex 32)"
database_name='sco_dev'
bucket='sco-recovery-drill'
source_database='sco-b4-drill-source-db'
source_storage='sco-b4-drill-source-s3'
target_database='sco-b4-drill-target-db'
target_storage='sco-b4-drill-target-s3'
source_database_volume='sco-b4-drill-source-db-data'
source_storage_volume='sco-b4-drill-source-s3-data'
target_database_volume='sco-b4-drill-target-db-data'
target_storage_volume='sco-b4-drill-target-s3-data'
network='sco-b4-drill-network'
work_directory=''
api_pid=''

cleanup() {
  if [[ -n "$api_pid" ]]; then kill "$api_pid" >/dev/null 2>&1 || true; wait "$api_pid" 2>/dev/null || true; fi
  docker rm -f "$source_database" "$source_storage" "$target_database" "$target_storage" >/dev/null 2>&1 || true
  docker volume rm "$source_database_volume" "$source_storage_volume" "$target_database_volume" "$target_storage_volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  [[ -z "$work_directory" ]] || rm -rf "$work_directory"
}
trap cleanup EXIT INT TERM
cleanup
work_directory="$(mktemp -d /tmp/sco-b4-recovery-drill.XXXXXX)"
trap cleanup EXIT INT TERM

wait_for_postgres() {
  local container="$1"
  local _
  for _ in {1..60}; do
    if docker exec "$container" pg_isready -U sco_restore_owner -d "$database_name" >/dev/null 2>&1 && PGPASSWORD="$owner_password" "$PSQL" -h 127.0.0.1 -p "$postgres_port" -U sco_restore_owner -d "$database_name" -Atc 'SELECT 1' 2>/dev/null | grep -qx 1; then return; fi
    sleep 1
  done
  fail_recovery 'POSTGRES_DRILL_START_TIMEOUT'
}

wait_for_s3() {
  local _
  for _ in {1..90}; do
    if curl --fail --silent "http://127.0.0.1:$s3_port/favicon.ico" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  fail_recovery 'S3_DRILL_START_TIMEOUT'
}

start_database() {
  local container="$1"
  local volume="$2"
  docker run -d --name "$container" --network "$network" -p "127.0.0.1:$postgres_port:5432" -v "$volume:/var/lib/postgresql/data" -e POSTGRES_USER=sco_restore_owner -e POSTGRES_PASSWORD="$owner_password" -e POSTGRES_DB="$database_name" "$postgres_image" >/dev/null
  wait_for_postgres "$container"
}

start_storage() {
  local container="$1"
  local volume="$2"
  docker run -d --name "$container" --network "$network" -p "127.0.0.1:$s3_port:9090" -v "$volume:/s3mockroot" -e COM_ADOBE_TESTING_S3MOCK_STORE_ROOT=/s3mockroot -e COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT=true -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS="$bucket" "$s3_image" >/dev/null
  wait_for_s3
}

export SCO_RECOVERY_ENVIRONMENT='local-drill'
export SCO_BACKUP_DOCUMENT_WRITES_QUIESCED='true'
export SCO_BACKUP_DATABASE_URL="postgresql://sco_restore_owner:$owner_password@127.0.0.1:$postgres_port/$database_name"
export SCO_RESTORE_DATABASE_URL="$SCO_BACKUP_DATABASE_URL"
export DATABASE_URL="$SCO_BACKUP_DATABASE_URL"
export RUNTIME_DATABASE_PASSWORD="$runtime_password"
export SCO_INTERNAL_DATABASE_PASSWORD="$internal_password"
export RUNTIME_DATABASE_URL="postgresql://sco_runtime:$runtime_password@127.0.0.1:$postgres_port/$database_name"
export SCO_INTERNAL_DATABASE_URL="postgresql://sco_internal_executor:$internal_password@127.0.0.1:$postgres_port/$database_name"
export SCO_BACKUP_S3_BUCKET="$bucket"
export SCO_BACKUP_S3_REGION='us-east-1'
export SCO_BACKUP_S3_ENDPOINT="http://127.0.0.1:$s3_port"
export SCO_BACKUP_S3_FORCE_PATH_STYLE='true'
export SCO_BACKUP_S3_ACCESS_KEY_ID="$s3_access_key"
export SCO_BACKUP_S3_SECRET_ACCESS_KEY="$s3_secret_key"
export SCO_RESTORE_S3_BUCKET="$bucket"
export SCO_RESTORE_S3_REGION="$SCO_BACKUP_S3_REGION"
export SCO_RESTORE_S3_ENDPOINT="$SCO_BACKUP_S3_ENDPOINT"
export SCO_RESTORE_S3_FORCE_PATH_STYLE='true'
export SCO_RESTORE_S3_ACCESS_KEY_ID="$s3_access_key"
export SCO_RESTORE_S3_SECRET_ACCESS_KEY="$s3_secret_key"
export NODE_ENV='test'
export SESSION_SECRET="$session_secret"
export SCO_DOCUMENT_STORAGE='s3'
export SCO_S3_BUCKET="$bucket"
export SCO_S3_REGION='us-east-1'
export SCO_S3_ENDPOINT="$SCO_BACKUP_S3_ENDPOINT"
export SCO_S3_FORCE_PATH_STYLE='true'
export SCO_S3_ACCESS_KEY_ID="$s3_access_key"
export SCO_S3_SECRET_ACCESS_KEY="$s3_secret_key"

drill_start="$(date +%s%3N)"
docker network create "$network" >/dev/null
docker volume create "$source_database_volume" >/dev/null
docker volume create "$source_storage_volume" >/dev/null
start_database "$source_database" "$source_database_volume"
start_storage "$source_storage" "$source_storage_volume"
node apps/api/scripts/recovery/object-store.mjs ensure-bucket --prefix SCO_BACKUP_S3 --enable-versioning true
corepack pnpm --filter @sco/api exec prisma migrate deploy --schema prisma/schema.prisma
node apps/api/scripts/provision-runtime-role.mjs
SCO_SEED_PASSWORD='local-recovery-drill-only' corepack pnpm --filter @sco/api exec prisma db seed
node apps/api/scripts/recovery/object-store.mjs seed-drill --output "$work_directory/object-fixtures.json"

document_key="$(jq -r '.objects[0].key' "$work_directory/object-fixtures.json")"
document_bytes="$(jq -r '.objects[0].bytes' "$work_directory/object-fixtures.json")"
document_hash="$(jq -r '.objects[0].sha256' "$work_directory/object-fixtures.json")"
version_key="$(jq -r '.objects[1].key' "$work_directory/object-fixtures.json")"
version_hash="$(jq -r '.objects[1].sha256' "$work_directory/object-fixtures.json")"
PGPASSWORD="$owner_password" "$PSQL" -h 127.0.0.1 -p "$postgres_port" -U sco_restore_owner -d "$database_name" -v ON_ERROR_STOP=1 -v document_key="$document_key" -v document_bytes="$document_bytes" -v document_hash="$document_hash" -v version_key="$version_key" -v version_hash="$version_hash" <<'SQL'
INSERT INTO documents (id, company_id, uploader_user_id, filename, detected_mime_type, byte_size, storage_key, sha256, status)
VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010', 'recovery-drill.txt', 'text/plain', :document_bytes, :'document_key', :'document_hash', 'AVAILABLE');
INSERT INTO document_versions (id, company_id, document_id, version, storage_key, sha256)
VALUES ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 1, :'version_key', :'version_hash');
SQL

age-keygen -o "$work_directory/age-identity.txt" >/dev/null
age_recipient="$(age-keygen -y "$work_directory/age-identity.txt")"
openssl genpkey -algorithm ED25519 -out "$work_directory/signing-key.pem"
openssl pkey -in "$work_directory/signing-key.pem" -pubout -out "$work_directory/signing-public-key.pem"
mkdir "$work_directory/backups"
backup_start="$(date +%s%3N)"
RELEASE_SHA="$(git rev-parse HEAD)" SCO_BACKUP_WORK_ROOT=/dev/shm scripts/recovery/create-backup.sh --output-directory "$work_directory/backups" --destination-kind local-drill --age-recipient "$age_recipient" --signing-key "$work_directory/signing-key.pem" | tee "$work_directory/backup.log"
backup_duration="$(( $(date +%s%3N) - backup_start ))"
archive="$(find "$work_directory/backups" -maxdepth 1 -type f -name '*.tar.age' -print -quit)"
envelope="$(find "$work_directory/backups" -maxdepth 1 -type f -name '*.envelope.json' -print -quit)"
signature="$(find "$work_directory/backups" -maxdepth 1 -type f -name '*.envelope.sig' -print -quit)"
[[ -n "$archive" && -n "$envelope" && -n "$signature" ]] || fail_recovery 'DRILL_BACKUP_ARTIFACTS_MISSING'

docker rm -f "$source_database" "$source_storage" >/dev/null
docker volume rm "$source_database_volume" "$source_storage_volume" >/dev/null
! docker inspect "$source_database" "$source_storage" >/dev/null 2>&1 || fail_recovery 'SOURCE_CONTAINERS_NOT_DESTROYED'
! docker volume inspect "$source_database_volume" "$source_storage_volume" >/dev/null 2>&1 || fail_recovery 'SOURCE_VOLUMES_NOT_DESTROYED'
log_recovery info recovery_drill_source_destroyed --arg database_container "$source_database" --arg storage_container "$source_storage"

docker volume create "$target_database_volume" >/dev/null
docker volume create "$target_storage_volume" >/dev/null
start_database "$target_database" "$target_database_volume"
start_storage "$target_storage" "$target_storage_volume"
node apps/api/scripts/recovery/object-store.mjs ensure-bucket --prefix SCO_RESTORE_S3 --enable-versioning true
restore_start="$(date +%s%3N)"
SCO_RESTORE_WORK_ROOT=/dev/shm scripts/recovery/restore-backup.sh --archive "$archive" --envelope "$envelope" --signature "$signature" --signing-public-key "$work_directory/signing-public-key.pem" --age-identity "$work_directory/age-identity.txt" --confirm-database "RESTORE:$database_name" --confirm-target "RESTORE:127.0.0.1:$postgres_port/$database_name" --environment local-drill --report "$work_directory/reconciliation.json" | tee "$work_directory/restore.log"
restore_duration="$(( $(date +%s%3N) - restore_start ))"
if second_restore_output="$(SCO_RESTORE_WORK_ROOT=/dev/shm scripts/recovery/restore-backup.sh --archive "$archive" --envelope "$envelope" --signature "$signature" --signing-public-key "$work_directory/signing-public-key.pem" --age-identity "$work_directory/age-identity.txt" --confirm-database "RESTORE:$database_name" --confirm-target "RESTORE:127.0.0.1:$postgres_port/$database_name" --environment local-drill --report "$work_directory/second-reconciliation.json" 2>&1)"; then
  fail_recovery 'NON_EMPTY_RESTORE_WAS_NOT_REFUSED'
fi
[[ "$second_restore_output" == *'RESTORE_DATABASE_NOT_EMPTY'* ]] || fail_recovery 'NON_EMPTY_RESTORE_FAILED_UNSAFELY'
log_recovery info recovery_failure_path_verified --arg reason 'RESTORE_DATABASE_NOT_EMPTY'

restored_document="$(PGPASSWORD="$owner_password" "$PSQL" -h 127.0.0.1 -p "$postgres_port" -U sco_restore_owner -d "$database_name" -Atc "SELECT filename || ':' || byte_size || ':' || sha256 FROM documents WHERE id='40000000-0000-4000-8000-000000000001'")"
[[ "$restored_document" == "recovery-drill.txt:$document_bytes:$document_hash" ]] || fail_recovery 'RESTORED_DATABASE_DATA_MISMATCH'
jq -e '.issueCount == 0 and .databaseReferences == 2 and .storageObjects == 2' "$work_directory/reconciliation.json" >/dev/null || fail_recovery 'RESTORED_OBJECT_RECONCILIATION_MISMATCH'
log_recovery info recovery_drill_fresh_target_verified --arg database_container "$target_database" --arg storage_container "$target_storage"

export PORT="$api_port"
export API_ORIGIN="http://127.0.0.1:$api_port"
export PARTNER_WEB_ORIGIN='http://127.0.0.1:3102'
export OPERATIONS_WEB_ORIGIN='http://127.0.0.1:3103'
export NODE_ENV='development'
corepack pnpm --filter @sco/api exec tsx src/main.ts > "$work_directory/api.log" 2>&1 &
api_pid="$!"
for _ in {1..60}; do
  if curl --fail --silent "http://127.0.0.1:$api_port/health/live" >/dev/null 2>&1 && curl --fail --silent "http://127.0.0.1:$api_port/health/ready" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then fail_recovery 'RESTORED_API_EXITED'; fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:$api_port/health/live" | jq -e '.status == "ok"' >/dev/null
curl --fail --silent "http://127.0.0.1:$api_port/health/ready" | jq -e '.status == "ok"' >/dev/null
kill "$api_pid"
wait "$api_pid" || true
api_pid=''
log_recovery info recovery_drill_api_ready

export NODE_ENV='test'
corepack pnpm --filter @sco/api exec vitest run test/integration/security-gate.integration.test.ts --no-file-parallelism
corepack pnpm --filter @sco/api exec vitest run test/database/postgres-rls.integration.test.ts test/database/supplier-quote-document-isolation.integration.test.ts --no-file-parallelism
drill_duration="$(( $(date +%s%3N) - drill_start ))"
jq -n --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson backupDurationMs "$backup_duration" --argjson restoreDurationMs "$restore_duration" --argjson totalDurationMs "$drill_duration" '{kind:"sco-local-recovery-drill",schemaVersion:1,completedAt:$completedAt,sourceDestroyed:true,freshTarget:true,apiLiveness:true,apiReadiness:true,securityGate:true,rlsDocumentRegressions:true,databaseVerified:true,objectsVerified:true,backupDurationMs:$backupDurationMs,restoreDurationMs:$restoreDurationMs,totalDurationMs:$totalDurationMs}' | tee "$work_directory/drill-evidence.json"