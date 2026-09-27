#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

profile="${1:-smoke}"
case "$profile" in smoke|light|sustained|burst|stress|rate-limit) ;; *) echo "Unknown profile: $profile" >&2; exit 64 ;; esac
[[ "${SCO_DEPLOY_ENVIRONMENT:-test}" == 'test' ]] || { echo 'Local benchmarks require SCO_DEPLOY_ENVIRONMENT=test' >&2; exit 64; }

assert_provisioning_headroom() {
  local swap_total_kb swap_free_kb
  swap_total_kb="$(awk '/SwapTotal/{print $2}' /proc/meminfo)"
  swap_free_kb="$(awk '/SwapFree/{print $2}' /proc/meminfo)"
  if (( swap_total_kb > 0 && (swap_total_kb - swap_free_kb) * 100 >= swap_total_kb * 95 )); then
    echo 'Benchmark refused before provisioning: swap below 95% is required' >&2
    return 1
  fi
  if [[ "$profile" == 'stress' ]] && (( swap_total_kb > 0 && (swap_total_kb - swap_free_kb) * 100 > swap_total_kb * 50 )); then
    echo 'Stress profile refused before provisioning: swap use must be at or below 50%' >&2
    return 1
  fi
}

assert_provisioning_headroom

postgres_image='postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
k6_image='grafana/k6:1.3.0@sha256:a90b459a3768c46ad1013da53af24189f735d7112273c6ac3212ca8ed0e18656'
resource_id="sco-b5-$profile-$$"
network="$resource_id"
volume="$resource_id-postgres"
postgres_container="$resource_id-postgres"
api_container="$resource_id-api"
load_container="$resource_id-k6"
git_revision="$(git rev-parse HEAD)"
source_tree_id="$(node scripts/performance/source-tree-id.mjs)"
api_image="sco-api:b5-performance-$source_tree_id"
work_directory="$(mktemp -d "/tmp/$resource_id.XXXXXX")"
output_directory="${SCO_PERFORMANCE_OUTPUT_DIRECTORY:-/tmp/$resource_id-results}"
[[ ! -e "$output_directory" || -z "$(find "$output_directory" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'Performance output directory must be empty' >&2; exit 1; }
mkdir -p "$output_directory"
chmod 0700 "$output_directory"
password="$(openssl rand -hex 24)"
metrics_token="$(openssl rand -hex 32)"
collector_pid=''

cleanup() {
  if [[ -n "$collector_pid" ]]; then kill -TERM "$collector_pid" 2>/dev/null || true; wait "$collector_pid" 2>/dev/null || true; fi
  docker rm -f "$load_container" "$api_container" "$postgres_container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$work_directory"
}
trap cleanup EXIT INT TERM

printf 'benchmark_stage=provision profile=%s\n' "$profile"
assert_provisioning_headroom
docker network create "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker run -d --name "$postgres_container" --cpus=0.75 --memory=1g --network "$network" -p 127.0.0.1::5432 \
  --health-cmd='psql -U sco_dev -d sco_dev -Atc "SELECT 1" >/dev/null' --health-interval=1s --health-timeout=2s --health-retries=60 \
  -e POSTGRES_DB=sco_dev -e POSTGRES_USER=sco_dev -e POSTGRES_PASSWORD="$password" \
  -v "$volume:/var/lib/postgresql/data" "$postgres_image" \
  -c shared_preload_libraries=pg_stat_statements >/dev/null

for attempt in $(seq 1 60); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$postgres_container")"
  [[ "$health" == 'healthy' ]] && break
  if [[ "$attempt" == '60' ]]; then
    docker inspect --format '{{json .State.Health.Log}}' "$postgres_container" >&2 || true
    docker logs "$postgres_container" >&2 || true
    echo 'PostgreSQL did not become ready' >&2
    exit 1
  fi
  node -e 'setTimeout(() => process.exit(0), 1000)'
done
postgres_port="$(docker port "$postgres_container" 5432/tcp | sed 's/.*://')"
owner_url="postgresql://sco_dev:$password@127.0.0.1:$postgres_port/sco_dev"
runtime_url="postgresql://sco_runtime:$password@127.0.0.1:$postgres_port/sco_dev"
internal_url="postgresql://sco_internal_executor:$password@127.0.0.1:$postgres_port/sco_dev"

docker exec "$postgres_container" psql -U sco_dev -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE sco_dev SET sco.environment='test'" >/dev/null
printf 'benchmark_stage=dataset\n'
NODE_ENV=test DATABASE_URL="$owner_url" RUNTIME_DATABASE_URL="$runtime_url" SCO_INTERNAL_DATABASE_URL="$internal_url" \
  RUNTIME_DATABASE_PASSWORD="$password" SCO_INTERNAL_DATABASE_PASSWORD="$password" SESSION_SECRET="$metrics_token" SCO_DOCUMENT_STORAGE=local SCO_SEED_PASSWORD="$password" \
  node scripts/ci/prepare-test-database.mjs >"$work_directory/database-setup.log"
NODE_ENV=test SCO_PERFORMANCE_DATASET=isolated-local DATABASE_URL="$owner_url" node scripts/performance/seed-performance.mjs >"$output_directory/dataset.json"
docker exec "$postgres_container" psql -U sco_dev -d sco_dev -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements' >/dev/null

if [[ "${SCO_PERFORMANCE_REBUILD_IMAGE:-true}" == 'true' ]]; then
  assert_provisioning_headroom
  printf 'benchmark_stage=build\n'
  docker build --file apps/api/Dockerfile --label "com.sco.performance.source-tree=$source_tree_id" --label "org.opencontainers.image.revision=$git_revision" --tag "$api_image" . >"$work_directory/api-build.log"
fi
image_source_tree="$(docker image inspect --format '{{ index .Config.Labels "com.sco.performance.source-tree" }}' "$api_image" 2>/dev/null || true)"
[[ "$image_source_tree" == "$source_tree_id" ]] || { echo 'API image source-tree fingerprint does not match the current worktree' >&2; exit 1; }
api_image_digest="$(docker image inspect --format '{{.Id}}' "$api_image")"
api_image_revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$api_image")"
[[ "$api_image_revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'API image revision label is missing or invalid' >&2; exit 1; }

application_limit=1000000
authentication_limit=100000
if [[ "$profile" == 'rate-limit' ]]; then application_limit=10; authentication_limit=10; fi
assert_provisioning_headroom
docker run -d --name "$api_container" --cpus=0.75 --memory=1g --network "$network" -p 127.0.0.1::3101 \
  -e NODE_ENV=development -e PORT=3101 -e SCO_DEPLOY_ENVIRONMENT=test -e SCO_RELEASE_SHA="$git_revision" \
  -e RUNTIME_DATABASE_URL="postgresql://sco_runtime:$password@$postgres_container:5432/sco_dev" \
  -e SCO_INTERNAL_DATABASE_URL="postgresql://sco_internal_executor:$password@$postgres_container:5432/sco_dev" \
  -e SESSION_SECRET="$metrics_token" -e SCO_DOCUMENT_STORAGE=local -e SCO_METRICS_TOKEN="$metrics_token" \
  -e SCO_RATE_LIMIT_MAX="$application_limit" -e SCO_RATE_LIMIT_WINDOW_MS=60000 \
  -e SCO_RATE_LIMIT_AUTH_MAX="$authentication_limit" -e SCO_RATE_LIMIT_AUTH_WINDOW_MS=60000 \
  -e SCO_RATE_LIMIT_HEALTH_MAX=100000 -e SCO_RATE_LIMIT_HEALTH_WINDOW_MS=60000 \
  "$api_image" >/dev/null
printf 'benchmark_stage=api_ready\n'
api_port="$(docker port "$api_container" 3101/tcp | sed 's/.*://')"
if ! curl --fail --silent --retry 30 --retry-delay 1 --retry-connrefused --retry-all-errors "http://127.0.0.1:$api_port/health/ready" >/dev/null; then
  docker logs "$api_container" >"$output_directory/api-startup.log" 2>&1 || true
  echo "API readiness failed; sanitized runtime log retained at $output_directory/api-startup.log" >&2
  exit 1
fi

runtime_progress_path="$output_directory/runtime-progress.json"
SCO_METRICS_TOKEN="$metrics_token" node scripts/performance/collect-runtime.mjs "$output_directory/runtime.json" "$runtime_progress_path" "http://127.0.0.1:$api_port" "$api_container" "$postgres_container" sco_dev &
collector_pid=$!
export SCO_LOAD_PASSWORD="$password"
script='workload.js'
[[ "$profile" == 'rate-limit' ]] && script='rate-limit.js'
printf 'benchmark_stage=k6\n'
stress_stop='none'
k6_status=0
docker run --detach --name "$load_container" --cpus=0.25 --memory=512m --user "$(id -u):$(id -g)" --network "$network" -v "$ROOT/performance/k6:/scripts:ro" -v "$output_directory:/results" \
  -e SCO_LOAD_PASSWORD -e SCO_LOAD_BASE_URL="http://$api_container:3101" -e SCO_LOAD_PROFILE="$profile" \
  "$k6_image" run --summary-export /results/k6-summary.json "/scripts/$script" >/dev/null
host_safety_stop='none'
while [[ "$(docker inspect --format '{{.State.Running}}' "$load_container")" == 'true' ]]; do
  available_memory_kb="$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
  swap_total_kb="$(awk '/SwapTotal/{print $2}' /proc/meminfo)"
  swap_free_kb="$(awk '/SwapFree/{print $2}' /proc/meminfo)"
  api_oom="$(docker inspect --format '{{.State.OOMKilled}}' "$api_container")"
  postgres_oom="$(docker inspect --format '{{.State.OOMKilled}}' "$postgres_container")"
  postgres_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "$postgres_container")"
  if (( available_memory_kb < 1048576 || (swap_total_kb > 0 && (swap_total_kb - swap_free_kb) * 100 >= swap_total_kb * 95) )) || [[ "$api_oom" == 'true' || "$postgres_oom" == 'true' || "$postgres_health" == 'unhealthy' ]]; then
    host_safety_stop='host_or_database_safety_guard'
    docker stop --time 5 "$load_container" >/dev/null || true
    break
  fi
  node -e 'setTimeout(() => process.exit(0), 1000)'
done
k6_status="$(docker wait "$load_container")"
docker logs "$load_container"
docker rm "$load_container" >/dev/null
if [[ "$host_safety_stop" != 'none' ]]; then
  stress_stop="$host_safety_stop"
  printf 'stress_stop=%s\n' "$stress_stop"
fi
if (( k6_status != 0 )); then
  if [[ "$profile" == 'stress' && -s "$output_directory/k6-summary.json" && "$host_safety_stop" != 'none' ]]; then
    stress_stop="$host_safety_stop"
    printf 'stress_stop=%s\n' "$stress_stop"
  elif [[ "$profile" == 'stress' && "$k6_status" == '99' && -s "$output_directory/k6-summary.json" ]]; then
    stress_stop="$(node --input-type=module -e 'import fs from "node:fs"; import { classifyK6Outcome } from "./scripts/performance/k6-outcome.mjs"; console.log(classifyK6Outcome(99, JSON.parse(fs.readFileSync(process.argv[1], "utf8")), "stress").stop)' "$output_directory/k6-summary.json")"
    printf 'stress_stop=%s\n' "$stress_stop"
  else
    exit "$k6_status"
  fi
fi

node --input-type=module -e '
import { readFileSync } from "node:fs";
import { waitForRuntimeSamples } from "./scripts/performance/runtime-metrics.mjs";
const progressPath = process.argv[1];
const completed = await waitForRuntimeSamples(() => {
  try { return JSON.parse(readFileSync(progressPath, "utf8")); } catch { return undefined; }
});
if (!completed) console.log("runtime_sample_grace=expired");
' "$runtime_progress_path"
kill -TERM "$collector_pid" 2>/dev/null || true
collector_status=0
wait "$collector_pid" || collector_status=$?
collector_pid=''
(( collector_status == 0 )) || { echo 'Runtime metrics collector failed' >&2; exit 1; }
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { assertCompleteRuntimeCollection } from "./scripts/performance/runtime-metrics.mjs";
assertCompleteRuntimeCollection(JSON.parse(readFileSync(process.argv[1], "utf8")));
' "$output_directory/runtime.json"
docker exec "$postgres_container" psql -U sco_dev -d sco_dev -At -F ',' -c "SELECT CASE WHEN query LIKE '%FROM \"CompanyMembership\" m%' THEN 'membership_context' WHEN query LIKE '%UPDATE \"Session\" SET \"lastSeenAt\"%' THEN 'session_touch' WHEN query LIKE '%FROM \"Session\" s JOIN \"User\"%' THEN 'session_resolve' WHEN query LIKE '%FROM \"Company\" WHERE id = %' THEN 'tenant_company_page' ELSE 'other' END,calls,round(mean_exec_time::numeric,3),round(max_exec_time::numeric,3),rows FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10" >"$output_directory/query-families.csv"
node -e "const fs=require('fs'); fs.writeFileSync(process.argv[1], JSON.stringify({kind:'sco-performance-environment',profile:process.argv[2],capturedAt:new Date().toISOString(),cpuCount:Number(process.argv[3]),memoryBytes:Number(process.argv[4]),availableMemoryBytes:Number(process.argv[5]),swapTotalBytes:Number(process.argv[6]),swapFreeBytes:Number(process.argv[7]),node:process.version,postgres:process.argv[8],docker:process.argv[9],k6:'1.3.0',apiInstances:1,resourceCaps:{apiCpu:0.75,apiMemoryBytes:1073741824,postgresCpu:0.75,postgresMemoryBytes:1073741824,k6Cpu:0.25,k6MemoryBytes:536870912},stressStop:process.argv[10],dataset:{companies:252,memberships:252,activeProducts:500}},null,2)+'\\n')" \
  "$output_directory/environment.json" "$profile" "$(nproc)" "$(awk '/MemTotal/{print $2*1024}' /proc/meminfo)" "$(awk '/MemAvailable/{print $2*1024}' /proc/meminfo)" "$(awk '/SwapTotal/{print $2*1024}' /proc/meminfo)" "$(awk '/SwapFree/{print $2*1024}' /proc/meminfo)" "$(docker exec "$postgres_container" psql -U sco_dev -d sco_dev -Atc 'SHOW server_version')" "$(docker version --format '{{.Server.Version}}')" "$stress_stop"
node -e "const fs=require('fs'),path=process.argv[1],data=JSON.parse(fs.readFileSync(path));Object.assign(data,{gitRevision:process.argv[2],sourceTreeId:process.argv[3],imageDigest:process.argv[4],imageRevision:process.argv[5],worktreeDirty:process.argv[6]==='true'});fs.writeFileSync(path,JSON.stringify(data,null,2)+'\\n')" \
  "$output_directory/environment.json" "$git_revision" "$source_tree_id" "$api_image_digest" "$api_image_revision" "$(git diff --quiet HEAD && [[ -z "$(git ls-files --others --exclude-standard)" ]] && echo false || echo true)"
printf 'Benchmark artifacts: %s\n' "$output_directory"
[[ "$host_safety_stop" == 'none' ]] || exit 75