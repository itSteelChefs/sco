#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

# shellcheck source=scripts/recovery/recovery-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-lib.sh"
cd "$RECOVERY_ROOT"

for command_name in age age-keygen jq sha256sum tar; do require_command "$command_name"; done
work_directory="$(mktemp -d /tmp/sco-recovery-failures.XXXXXX)"
cleanup() { rm -rf "$work_directory"; }
trap cleanup EXIT INT TERM

expect_failure() {
  local expected="$1"
  shift
  local output
  if output="$({ "$@"; } 2>&1)"; then fail_recovery "EXPECTED_FAILURE_NOT_OBSERVED:$expected"; fi
  [[ "$output" == *"$expected"* ]] || fail_recovery "WRONG_FAILURE_REASON:$expected"
  log_recovery info recovery_failure_path_verified --arg reason "$expected"
}

touch "$work_directory/placeholder"
age-keygen -o "$work_directory/identity-one.txt" >/dev/null
age-keygen -o "$work_directory/identity-two.txt" >/dev/null
recipient="$(age-keygen -y "$work_directory/identity-one.txt")"
tar -C "$work_directory" -cf - placeholder | age --encrypt --recipient "$recipient" --output "$work_directory/test.tar.age"
archive_hash="$(sha256sum "$work_directory/test.tar.age" | awk '{print $1}')"
jq -n --arg archive 'test.tar.age' --arg sha256 "$archive_hash" '{kind:"sco-recovery-envelope",schemaVersion:1,backupId:"sco-20260926T200000Z-012345abcdef",createdAt:"2026-09-26T20:00:00Z",encryption:"age-x25519",archive:$archive,sha256:$sha256,bytes:1}' > "$work_directory/test.envelope.json"
openssl genpkey -algorithm ED25519 -out "$work_directory/signing-key.pem"
openssl pkey -in "$work_directory/signing-key.pem" -pubout -out "$work_directory/signing-public-key.pem"
openssl genpkey -algorithm ED25519 -out "$work_directory/wrong-signing-key.pem"
openssl pkey -in "$work_directory/wrong-signing-key.pem" -pubout -out "$work_directory/wrong-signing-public-key.pem"
openssl pkeyutl -sign -rawin -inkey "$work_directory/signing-key.pem" -in "$work_directory/test.envelope.json" -out "$work_directory/test.envelope.sig"

common_environment=(env SCO_RESTORE_DATABASE_URL='postgresql://local:local@127.0.0.1:1/sco_dev' SCO_RESTORE_S3_BUCKET='test' SCO_RESTORE_S3_REGION='us-east-1' RUNTIME_DATABASE_PASSWORD='local' SCO_INTERNAL_DATABASE_PASSWORD='local')
restore_arguments=(--envelope "$work_directory/test.envelope.json" --signature "$work_directory/test.envelope.sig" --signing-public-key "$work_directory/signing-public-key.pem" --age-identity "$work_directory/identity-one.txt" --confirm-database RESTORE:sco_dev --confirm-target RESTORE:127.0.0.1:1/sco_dev)
expect_failure 'ARCHIVE_ENVELOPE_KEYS_CONFIRMATIONS_AND_ENVIRONMENT_REQUIRED' "${common_environment[@]}" scripts/recovery/restore-backup.sh --archive "$work_directory/missing.tar.age" "${restore_arguments[@]}" --environment local-drill
expect_failure 'PRODUCTION_RESTORE_REFUSED' "${common_environment[@]}" scripts/recovery/restore-backup.sh --archive "$work_directory/test.tar.age" "${restore_arguments[@]}" --environment production
expect_failure 'RECOVERY_ENVELOPE_SIGNATURE_FAILED' "${common_environment[@]}" scripts/recovery/restore-backup.sh --archive "$work_directory/test.tar.age" --envelope "$work_directory/test.envelope.json" --signature "$work_directory/test.envelope.sig" --signing-public-key "$work_directory/wrong-signing-public-key.pem" --age-identity "$work_directory/identity-one.txt" --confirm-database RESTORE:sco_dev --confirm-target RESTORE:127.0.0.1:1/sco_dev --environment local-drill
printf 'corruption' >> "$work_directory/test.tar.age"
expect_failure 'ENCRYPTED_ARCHIVE_CHECKSUM_FAILED' "${common_environment[@]}" scripts/recovery/restore-backup.sh --archive "$work_directory/test.tar.age" "${restore_arguments[@]}" --environment local-drill
truncate -s -10 "$work_directory/test.tar.age"
tar -C "$work_directory" -cf - placeholder | age --encrypt --recipient "$recipient" --output "$work_directory/test.tar.age"
archive_hash="$(sha256sum "$work_directory/test.tar.age" | awk '{print $1}')"
jq --arg sha256 "$archive_hash" '.sha256=$sha256' "$work_directory/test.envelope.json" > "$work_directory/envelope.tmp"
mv "$work_directory/envelope.tmp" "$work_directory/test.envelope.json"
openssl pkeyutl -sign -rawin -inkey "$work_directory/signing-key.pem" -in "$work_directory/test.envelope.json" -out "$work_directory/test.envelope.sig"
expect_failure 'no identity matched any of the recipients' "${common_environment[@]}" scripts/recovery/restore-backup.sh --archive "$work_directory/test.tar.age" --envelope "$work_directory/test.envelope.json" --signature "$work_directory/test.envelope.sig" --signing-public-key "$work_directory/signing-public-key.pem" --age-identity "$work_directory/identity-two.txt" --confirm-database RESTORE:sco_dev --confirm-target RESTORE:127.0.0.1:1/sco_dev --environment local-drill
expect_failure 'SCO_MISSING_BUCKET_REQUIRED' env -u SCO_MISSING_BUCKET node apps/api/scripts/recovery/object-store.mjs ensure-bucket --prefix SCO_MISSING --enable-versioning false
expect_failure 'object_recovery_failed' env SCO_UNAVAILABLE_BUCKET=test SCO_UNAVAILABLE_REGION=us-east-1 SCO_UNAVAILABLE_ENDPOINT=http://127.0.0.1:1 SCO_UNAVAILABLE_FORCE_PATH_STYLE=true SCO_UNAVAILABLE_ACCESS_KEY_ID=local SCO_UNAVAILABLE_SECRET_ACCESS_KEY=local node apps/api/scripts/recovery/object-store.mjs ensure-bucket --prefix SCO_UNAVAILABLE --enable-versioning false