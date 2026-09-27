#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

# shellcheck source=scripts/recovery/recovery-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/recovery-lib.sh"
cd "$RECOVERY_ROOT"

work_directory="$(mktemp -d /tmp/sco-recovery-environment.XXXXXX)"
cleanup() { rm -rf "$work_directory"; }
trap cleanup EXIT INT TERM

cat > "$work_directory/psql" <<'SCRIPT'
#!/usr/bin/env bash
if [[ "$*" == *'pg_db_role_setting'* ]]; then
  printf '%s\n' "${SCO_TEST_ACTUAL_ENVIRONMENT:-}"
else
  printf '%s\n' "${SCO_TEST_EFFECTIVE_ENVIRONMENT:-${SCO_TEST_ACTUAL_ENVIRONMENT:-}}"
fi
SCRIPT
chmod 0700 "$work_directory/psql"

expect_allowed() {
  local expected="$1"
  local actual="$2"
  local output
  output="$(PSQL="$work_directory/psql" SCO_TEST_ACTUAL_ENVIRONMENT="$actual" bash -c 'source scripts/recovery/recovery-lib.sh; assert_restore_environment "$1"' _ "$expected")"
  [[ "$output" == "$actual" ]] || fail_recovery "ENVIRONMENT_IDENTITY_NOT_ALLOWED:$expected:$actual"
  log_recovery info recovery_environment_identity_verified --arg expected "$expected" --arg actual "$actual" --arg outcome allowed
}

expect_refused() {
  local expected="$1"
  local actual="$2"
  local reason="$3"
  local output
  if output="$(PSQL="$work_directory/psql" SCO_TEST_ACTUAL_ENVIRONMENT="$actual" bash -c 'source scripts/recovery/recovery-lib.sh; assert_restore_environment "$1"' _ "$expected" 2>&1)"; then
    fail_recovery "ENVIRONMENT_IDENTITY_NOT_REFUSED:$expected:$actual"
  fi
  [[ "$output" == *"$reason"* ]] || fail_recovery "ENVIRONMENT_IDENTITY_WRONG_REASON:$expected:$actual"
  log_recovery info recovery_environment_identity_verified --arg expected "$expected" --arg actual "${actual:-missing}" --arg outcome refused --arg reason "$reason"
}

expect_allowed staging staging
expect_refused staging production PRODUCTION_RESTORE_REFUSED
expect_refused staging development RESTORE_TARGET_ENVIRONMENT_MISMATCH
expect_refused staging '' RESTORE_TARGET_ENVIRONMENT_INVALID
expect_refused staging invalid RESTORE_TARGET_ENVIRONMENT_INVALID
expect_refused production production PRODUCTION_RESTORE_REFUSED
expect_refused development staging RESTORE_TARGET_ENVIRONMENT_MISMATCH

output="$(PSQL="$work_directory/psql" SCO_TEST_ACTUAL_ENVIRONMENT=staging SCO_TEST_EFFECTIVE_ENVIRONMENT=development bash -c 'source scripts/recovery/recovery-lib.sh; assert_restore_environment staging' 2>&1 || true)"
[[ "$output" == *'RESTORE_TARGET_ENVIRONMENT_OVERRIDE_REFUSED'* ]] || fail_recovery 'ENVIRONMENT_IDENTITY_OVERRIDE_NOT_REFUSED'
log_recovery info recovery_environment_identity_verified --arg expected staging --arg actual staging --arg outcome refused --arg reason RESTORE_TARGET_ENVIRONMENT_OVERRIDE_REFUSED