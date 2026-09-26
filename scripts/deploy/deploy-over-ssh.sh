#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

if [[ $# -ne 4 ]]; then
  echo 'Usage: deploy-over-ssh.sh RELEASE_SHA API_IMAGE PARTNER_IMAGE OPERATIONS_IMAGE' >&2
  exit 64
fi

release_sha=$1
api_image=$2
partner_image=$3
operations_image=$4
required=(DEPLOY_ENVIRONMENT DEPLOY_HOST DEPLOY_USER DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS DEPLOY_PATH DEPLOY_RUNTIME_ENV DEPLOY_MIGRATION_ENV DEPLOY_WEB_ENV GHCR_USERNAME GHCR_TOKEN)
for name in "${required[@]}"; do [[ -n ${!name:-} ]] || { echo "$name is required" >&2; exit 78; }; done

[[ $DEPLOY_ENVIRONMENT == staging || $DEPLOY_ENVIRONMENT == production ]] || { echo 'Invalid deployment environment' >&2; exit 64; }
grep -qx "NODE_ENV=$DEPLOY_ENVIRONMENT" <<<"$DEPLOY_RUNTIME_ENV" || { echo 'Runtime environment does not match deployment environment' >&2; exit 78; }
grep -qx "SCO_DEPLOY_ENVIRONMENT=$DEPLOY_ENVIRONMENT" <<<"$DEPLOY_RUNTIME_ENV" || { echo 'Runtime environment marker does not match deployment environment' >&2; exit 78; }
grep -qx "SCO_DEPLOY_ENVIRONMENT=$DEPLOY_ENVIRONMENT" <<<"$DEPLOY_MIGRATION_ENV" || { echo 'Migration environment marker does not match deployment environment' >&2; exit 78; }
grep -qx "SCO_DEPLOY_ENVIRONMENT=$DEPLOY_ENVIRONMENT" <<<"$DEPLOY_WEB_ENV" || { echo 'Web environment marker does not match deployment environment' >&2; exit 78; }
grep -Eq '^DATABASE_URL=.+$' <<<"$DEPLOY_MIGRATION_ENV" || { echo 'Migration database URL is required' >&2; exit 78; }
if grep -Eq '^DATABASE_URL=' <<<"$DEPLOY_RUNTIME_ENV"; then echo 'Runtime environment must not contain the migration database URL' >&2; exit 78; fi
if grep -Eq '^(DATABASE_URL|RUNTIME_DATABASE_URL|SCO_INTERNAL_DATABASE_URL|SESSION_SECRET|SCO_S3_ACCESS_KEY_ID|SCO_S3_SECRET_ACCESS_KEY|SCO_S3_SESSION_TOKEN)=' <<<"$DEPLOY_WEB_ENV"; then echo 'Web environment contains an API-only credential' >&2; exit 78; fi
grep -qx 'SCO_DOCUMENT_STORAGE=s3' <<<"$DEPLOY_RUNTIME_ENV" || { echo 'Shared S3-compatible storage is required' >&2; exit 78; }
[[ $DEPLOY_HOST =~ ^[A-Za-z0-9._:-]+$ && $DEPLOY_USER =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid SSH target' >&2; exit 64; }
[[ $GHCR_USERNAME =~ ^[A-Za-z0-9-]+$ ]] || { echo 'Invalid GHCR username' >&2; exit 64; }
[[ ${DEPLOY_PORT:-22} =~ ^[0-9]{1,5}$ ]] || { echo 'Invalid SSH port' >&2; exit 64; }
[[ $DEPLOY_PATH =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo 'Invalid deployment path' >&2; exit 64; }

key_file=$(mktemp)
known_hosts=$(mktemp)
trap 'rm -f "$key_file" "$known_hosts"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" >"$key_file"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$known_hosts"
chmod 600 "$key_file" "$known_hosts"

ssh_options=(-i "$key_file" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" -p "${DEPLOY_PORT:-22}")
target="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh "${ssh_options[@]}" "$target" "umask 077; mkdir -p '$DEPLOY_PATH'"
scp -q -P "${DEPLOY_PORT:-22}" -i "$key_file" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" \
  scripts/deploy/docker-host-release.sh "$target:$DEPLOY_PATH/docker-host-release.sh"
printf '%s' "$DEPLOY_RUNTIME_ENV" | ssh "${ssh_options[@]}" "$target" "umask 077; cat > '$DEPLOY_PATH/runtime.env.next'; chmod 600 '$DEPLOY_PATH/runtime.env.next'; mv '$DEPLOY_PATH/runtime.env.next' '$DEPLOY_PATH/runtime.env'"
printf '%s' "$DEPLOY_MIGRATION_ENV" | ssh "${ssh_options[@]}" "$target" "umask 077; cat > '$DEPLOY_PATH/migration.env.next'; chmod 600 '$DEPLOY_PATH/migration.env.next'; mv '$DEPLOY_PATH/migration.env.next' '$DEPLOY_PATH/migration.env'"
printf '%s' "$DEPLOY_WEB_ENV" | ssh "${ssh_options[@]}" "$target" "umask 077; cat > '$DEPLOY_PATH/web.env.next'; chmod 600 '$DEPLOY_PATH/web.env.next'; mv '$DEPLOY_PATH/web.env.next' '$DEPLOY_PATH/web.env'"
printf '%s' "$GHCR_TOKEN" | ssh "${ssh_options[@]}" "$target" "docker login ghcr.io --username '$GHCR_USERNAME' --password-stdin >/dev/null"

remote_arguments=("$DEPLOY_PATH" "$DEPLOY_ENVIRONMENT" "$release_sha" "$api_image" "$partner_image" "$operations_image" "${DEPLOY_NETWORK:-sco}" "${DEPLOY_BIND_ADDRESS:-127.0.0.1}" "${API_PORT:-3101}" "${PARTNER_PORT:-3102}" "${OPERATIONS_PORT:-3103}")
printf -v remote_command '%q ' "$DEPLOY_PATH/docker-host-release.sh" "${remote_arguments[@]}"
ssh "${ssh_options[@]}" "$target" "chmod 700 '$DEPLOY_PATH/docker-host-release.sh'; $remote_command"
ssh "${ssh_options[@]}" "$target" 'docker logout ghcr.io >/dev/null 2>&1 || true'