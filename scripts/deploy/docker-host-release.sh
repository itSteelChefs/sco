#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 11 ]]; then
  echo 'Usage: docker-host-release.sh DEPLOY_PATH ENVIRONMENT RELEASE_SHA API_IMAGE PARTNER_IMAGE OPERATIONS_IMAGE NETWORK BIND_ADDRESS API_PORT PARTNER_PORT OPERATIONS_PORT' >&2
  exit 64
fi

deploy_path=$1
deployment_environment=$2
release_sha=$3
api_image=$4
partner_image=$5
operations_image=$6
network=$7
bind_address=$8
api_port=$9
partner_port=${10}
operations_port=${11}

[[ $deploy_path =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo 'Invalid deployment path' >&2; exit 64; }
[[ $deployment_environment == staging ]] || { echo 'Only staging deployment is authorized' >&2; exit 64; }
[[ $release_sha =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 64; }
[[ $network =~ ^[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid Docker network' >&2; exit 64; }
[[ $bind_address =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo 'Bind address must be IPv4' >&2; exit 64; }
IFS=. read -r -a bind_octets <<<"$bind_address"
for octet in "${bind_octets[@]}"; do ((10#$octet <= 255)) || { echo 'Invalid IPv4 bind address' >&2; exit 64; }; done
[[ $bind_address == '127.0.0.1' ]] || { echo 'Staging services must bind to loopback' >&2; exit 64; }
for port in "$api_port" "$partner_port" "$operations_port"; do
  [[ $port =~ ^[0-9]{1,5}$ ]] && ((port >= 1 && port <= 65535)) || { echo 'Invalid port' >&2; exit 64; }
done
for image in "$api_image" "$partner_image" "$operations_image"; do
  [[ $image =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || { echo 'Deployment requires immutable GHCR image digests' >&2; exit 64; }
done

runtime_env="$deploy_path/runtime.env"
migration_env="$deploy_path/migration.env"
web_env="$deploy_path/web.env"
[[ -f $runtime_env && -f $migration_env && -f $web_env ]] || { echo 'Deployment environment files are missing' >&2; exit 78; }
for environment_file in "$runtime_env" "$migration_env" "$web_env"; do
  [[ $(stat -c '%a' "$environment_file") == 600 ]] || { echo 'Deployment environment files must use mode 0600' >&2; exit 78; }
done

docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
docker pull "$api_image" >/dev/null
docker pull "$partner_image" >/dev/null
docker pull "$operations_image" >/dev/null

docker run --rm --network "$network" --env-file "$migration_env" "$api_image" \
  apps/api/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

prepared_services=()
started_services=()
rollback_all() {
  set +e
  for service in "${started_services[@]}"; do
    docker rm -f "$service" >/dev/null 2>&1 || true
  done
  for service in "${prepared_services[@]}"; do
    docker rename "${service}-rollback" "$service" >/dev/null 2>&1 || true
    docker start "$service" >/dev/null 2>&1 || true
  done
}
trap rollback_all ERR INT TERM

for service in sco-api sco-partner-web sco-operations-web; do
  docker rm -f "${service}-rollback" >/dev/null 2>&1 || true
  if docker container inspect "$service" >/dev/null 2>&1; then
    docker stop --timeout 30 "$service" >/dev/null
    docker rename "$service" "${service}-rollback"
    prepared_services+=("$service")
  fi
done

docker run -d --restart unless-stopped --name sco-api --network "$network" \
  --memory 768m --memory-reservation 512m --cpus 0.75 --pids-limit 256 \
  --env-file "$runtime_env" -e "SCO_RELEASE_SHA=$release_sha" -e 'SCO_SERVICE_NAME=sco-api' -e "SENTRY_RELEASE=$release_sha" -e "SENTRY_ENVIRONMENT=$deployment_environment" -p "${bind_address}:${api_port}:3101" \
  --label "com.sco.release.sha=$release_sha" --label "com.sco.image.digest=$api_image" "$api_image" >/dev/null
started_services+=(sco-api)
docker run -d --restart unless-stopped --name sco-partner-web --network "$network" \
  --memory 384m --memory-reservation 256m --cpus 0.35 --pids-limit 128 \
  --env-file "$web_env" -e "SCO_RELEASE_SHA=$release_sha" -e 'SCO_SERVICE_NAME=sco-partner-web' -e "SENTRY_RELEASE=$release_sha" -e "SENTRY_ENVIRONMENT=$deployment_environment" -p "${bind_address}:${partner_port}:3102" \
  --label "com.sco.release.sha=$release_sha" --label "com.sco.image.digest=$partner_image" "$partner_image" >/dev/null
started_services+=(sco-partner-web)
docker run -d --restart unless-stopped --name sco-operations-web --network "$network" \
  --memory 384m --memory-reservation 256m --cpus 0.35 --pids-limit 128 \
  --env-file "$web_env" -e "SCO_RELEASE_SHA=$release_sha" -e 'SCO_SERVICE_NAME=sco-operations-web' -e "SENTRY_RELEASE=$release_sha" -e "SENTRY_ENVIRONMENT=$deployment_environment" -p "${bind_address}:${operations_port}:3103" \
  --label "com.sco.release.sha=$release_sha" --label "com.sco.image.digest=$operations_image" "$operations_image" >/dev/null
started_services+=(sco-operations-web)

wait_for_http() {
  local url=$1
  for _ in {1..30}; do
    if curl --fail --silent --show-error --max-time 3 "$url" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

wait_for_http "http://${bind_address}:${api_port}/health/live"
wait_for_http "http://${bind_address}:${api_port}/health/ready"
wait_for_http "http://${bind_address}:${partner_port}/"
wait_for_http "http://${bind_address}:${operations_port}/"

trap - ERR INT TERM
for service in sco-api sco-partner-web sco-operations-web; do docker rm -f "${service}-rollback" >/dev/null 2>&1 || true; done
echo "Release $release_sha is ready on this Docker host."