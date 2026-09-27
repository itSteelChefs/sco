#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

k6_image='grafana/k6:1.3.0@sha256:a90b459a3768c46ad1013da53af24189f735d7112273c6ac3212ca8ed0e18656'
bash -n scripts/performance/run-local-benchmark.sh
node --check scripts/performance/collect-runtime.mjs
node --check scripts/performance/seed-performance.mjs
node --check scripts/performance/source-tree-id.mjs
node --check scripts/performance/k6-outcome.mjs
node --check scripts/performance/runtime-metrics.mjs
node --test apps/api/test/performance/*.test.mjs
docker run --rm -v "$ROOT/performance/k6:/scripts:ro" "$k6_image" inspect /scripts/workload.js >/dev/null
docker run --rm -v "$ROOT/performance/k6:/scripts:ro" "$k6_image" inspect /scripts/rate-limit.js >/dev/null
printf 'Performance harness validation passed (k6 1.3.0).\n'