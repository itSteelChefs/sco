#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

if [[ $# -ne 4 ]]; then
  echo 'Usage: deploy-from-owner-laptop.sh RELEASE_SHA API_IMAGE PARTNER_IMAGE OPERATIONS_IMAGE' >&2
  exit 64
fi

[[ ${GITHUB_ACTIONS:-} != true ]] || { echo 'GitHub Actions must not deploy to the VPS' >&2; exit 78; }
[[ ${DEPLOY_ENABLED:-false} == true ]] || { echo 'Owner deployment is disabled' >&2; exit 78; }
[[ -n ${SSH_AUTH_SOCK:-} && -S ${SSH_AUTH_SOCK} ]] || { echo 'Owner SSH agent is required' >&2; exit 78; }

release_sha=$1
api_image=$2
partner_image=$3
operations_image=$4
required=(DEPLOY_HOST DEPLOY_USER DEPLOY_KNOWN_HOSTS_FILE DEPLOY_PATH DEPLOY_RUNTIME_ENV_FILE DEPLOY_MIGRATION_ENV_FILE DEPLOY_WEB_ENV_FILE GHCR_USERNAME GHCR_TOKEN)
for name in "${required[@]}"; do [[ -n ${!name:-} ]] || { echo "$name is required" >&2; exit 78; }; done

[[ $release_sha =~ ^[0-9a-f]{40}$ ]] || { echo 'A full lowercase commit SHA is required' >&2; exit 64; }
[[ $DEPLOY_HOST =~ ^[A-Za-z0-9._:-]+$ && $DEPLOY_USER =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid SSH target' >&2; exit 64; }
[[ ${DEPLOY_PORT:-22} =~ ^[0-9]{1,5}$ ]] || { echo 'Invalid SSH port' >&2; exit 64; }
[[ $DEPLOY_PATH =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo 'Invalid deployment path' >&2; exit 64; }
[[ ${DEPLOY_NETWORK:-sco} =~ ^[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid Docker network' >&2; exit 64; }
[[ $GHCR_USERNAME =~ ^[A-Za-z0-9-]+$ ]] || { echo 'Invalid GHCR username' >&2; exit 64; }
[[ ${DEPLOY_BIND_ADDRESS:-127.0.0.1} == '127.0.0.1' ]] || { echo 'Staging services must bind to loopback' >&2; exit 78; }
for port in "${API_PORT:-3101}" "${PARTNER_PORT:-3102}" "${OPERATIONS_PORT:-3103}"; do
  [[ $port =~ ^[0-9]{1,5}$ ]] && ((port >= 1 && port <= 65535)) || { echo 'Invalid port' >&2; exit 64; }
done
for image in "$api_image" "$partner_image" "$operations_image"; do
  [[ $image =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || { echo 'Deployment requires immutable GHCR image digests' >&2; exit 64; }
done

for environment_file in "$DEPLOY_RUNTIME_ENV_FILE" "$DEPLOY_MIGRATION_ENV_FILE" "$DEPLOY_WEB_ENV_FILE"; do
  [[ -f $environment_file ]] || { echo "Missing owner environment file: $environment_file" >&2; exit 78; }
done
[[ -f $DEPLOY_KNOWN_HOSTS_FILE ]] || { echo 'Owner known-hosts file is missing' >&2; exit 78; }

grep -qx 'NODE_ENV=staging' "$DEPLOY_RUNTIME_ENV_FILE" || { echo 'Runtime environment does not match deployment environment' >&2; exit 78; }
grep -qx 'SCO_DEPLOY_ENVIRONMENT=staging' "$DEPLOY_RUNTIME_ENV_FILE" || { echo 'Runtime environment marker does not match deployment environment' >&2; exit 78; }
grep -qx 'SCO_DEPLOY_ENVIRONMENT=staging' "$DEPLOY_MIGRATION_ENV_FILE" || { echo 'Migration environment marker does not match deployment environment' >&2; exit 78; }
grep -qx 'SCO_DEPLOY_ENVIRONMENT=staging' "$DEPLOY_WEB_ENV_FILE" || { echo 'Web environment marker does not match deployment environment' >&2; exit 78; }
grep -Eq '^DATABASE_URL=.+$' "$DEPLOY_MIGRATION_ENV_FILE" || { echo 'Migration database URL is required' >&2; exit 78; }
if grep -Eq '^DATABASE_URL=' "$DEPLOY_RUNTIME_ENV_FILE"; then echo 'Runtime environment must not contain the migration database URL' >&2; exit 78; fi
if grep -Eq '^(DATABASE_URL|RUNTIME_DATABASE_URL|SCO_INTERNAL_DATABASE_URL|SESSION_SECRET|SCO_S3_ACCESS_KEY_ID|SCO_S3_SECRET_ACCESS_KEY|SCO_S3_SESSION_TOKEN)=' "$DEPLOY_WEB_ENV_FILE"; then echo 'Web environment contains an API-only credential' >&2; exit 78; fi
grep -qx 'SCO_DOCUMENT_STORAGE=s3' "$DEPLOY_RUNTIME_ENV_FILE" || { echo 'Shared S3-compatible storage is required' >&2; exit 78; }
grep -qx 'SCO_TRUST_PROXY=trusted-peers' "$DEPLOY_RUNTIME_ENV_FILE" || { echo 'Staging requires trusted proxy mode' >&2; exit 78; }
grep -qx 'SCO_TRUSTED_PROXY_PEERS=127.0.0.1' "$DEPLOY_RUNTIME_ENV_FILE" || { echo 'Staging requires the loopback Nginx proxy peer' >&2; exit 78; }
grep -qx 'SCO_RATE_LIMIT_CLIENT_IDENTITY=trusted-proxy' "$DEPLOY_RUNTIME_ENV_FILE" || { echo 'Staging requires trusted-proxy client identity' >&2; exit 78; }
for expected in 'SCO_RATE_LIMIT_MAX=120' 'SCO_RATE_LIMIT_WINDOW_MS=60000' 'SCO_RATE_LIMIT_AUTH_MAX=20' 'SCO_RATE_LIMIT_AUTH_WINDOW_MS=60000' 'SCO_RATE_LIMIT_HEALTH_MAX=120' 'SCO_RATE_LIMIT_HEALTH_WINDOW_MS=60000' 'SCO_RATE_LIMIT_MAX_CLIENTS=10000'; do
  grep -qx "$expected" "$DEPLOY_RUNTIME_ENV_FILE" || { echo "Missing required staging setting: $expected" >&2; exit 78; }
done

ssh_options=(-o BatchMode=yes -o IdentitiesOnly=yes -o "IdentityAgent=$SSH_AUTH_SOCK" -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS_FILE" -p "${DEPLOY_PORT:-22}")
target="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh "${ssh_options[@]}" "$target" "umask 077; mkdir -p '$DEPLOY_PATH'"
scp -q -P "${DEPLOY_PORT:-22}" -o BatchMode=yes -o IdentitiesOnly=yes -o "IdentityAgent=$SSH_AUTH_SOCK" -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS_FILE" \
  scripts/deploy/docker-host-release.sh "$target:$DEPLOY_PATH/docker-host-release.sh"
cat "$DEPLOY_RUNTIME_ENV_FILE" | ssh "${ssh_options[@]}" "$target" "umask 077; cat > '$DEPLOY_PATH/runtime.env.next'; chmod 600 '$DEPLOY_PATH/runtime.env.next'; mv '$DEPLOY_PATH/runtime.env.next' '$DEPLOY_PATH/runtime.env'"
cat "$DEPLOY_MIGRATION_ENV_FILE" | ssh "${ssh_options[@]}" "$target" "umask 077; cat > '$DEPLOY_PATH/migration.env.next'; chmod 600 '$DEPLOY_PATH/migration.env.next'; mv '$DEPLOY_PATH/migration.env.next' '$DEPLOY_PATH/migration.env'"
cat "$DEPLOY_WEB_ENV_FILE" | ssh "${ssh_options[@]}" "$target" "umask 077; cat > '$DEPLOY_PATH/web.env.next'; chmod 600 '$DEPLOY_PATH/web.env.next'; mv '$DEPLOY_PATH/web.env.next' '$DEPLOY_PATH/web.env'"
printf '%s' "$GHCR_TOKEN" | ssh "${ssh_options[@]}" "$target" "docker login ghcr.io --username '$GHCR_USERNAME' --password-stdin >/dev/null"

remote_arguments=("$DEPLOY_PATH" staging "$release_sha" "$api_image" "$partner_image" "$operations_image" "${DEPLOY_NETWORK:-sco}" "${DEPLOY_BIND_ADDRESS:-127.0.0.1}" "${API_PORT:-3101}" "${PARTNER_PORT:-3102}" "${OPERATIONS_PORT:-3103}")
printf -v remote_command '%q ' "$DEPLOY_PATH/docker-host-release.sh" "${remote_arguments[@]}"
ssh "${ssh_options[@]}" "$target" "chmod 700 '$DEPLOY_PATH/docker-host-release.sh'; $remote_command"
ssh "${ssh_options[@]}" "$target" 'docker logout ghcr.io >/dev/null 2>&1 || true'