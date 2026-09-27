# Performance Testing Runbook

## Safety

Run only from a local/test checkout against the disposable benchmark containers. The harness refuses non-test deployment markers; the dataset generator additionally verifies loopback `sco_dev` and database identity `test`. Never point load scripts at Staging, Production, real customer data, or shared object storage. The API and PostgreSQL containers are resource-capped; every profile requires swap below 95% before setup/build/start. Stress additionally requires swap use at or below 50%. During load all profiles stop if memory falls below 1 GiB or swap reaches 95%.

The test login password, session secret, database password, and metrics token are randomly generated per run. They are passed only through protected local process/container environments, never command-line values or output reports. The synthetic data and raw k6 summaries are disposable. No object store is configured.

## Prerequisites

- Linux x86_64 or an equivalent Docker-supported host
- Docker with Compose/plugin support and at least 2 CPUs
- Node 20 and repository Corepack/pnpm dependencies installed
- k6 1.3.0 fetched from the pinned official image by the validation/runner scripts
- Swap below 95%; stress additionally requires swap use at or below 50%

Validate the scripts without creating benchmark databases:

```bash
corepack pnpm performance:validate
corepack pnpm --filter @sco/api exec vitest run test/integration/rate-limit.integration.test.ts --no-file-parallelism
corepack pnpm --filter @sco/api exec vitest run test/integration/database-pool.integration.test.ts --no-file-parallelism
```

Run one progressive profile at a time:

```bash
scripts/performance/run-local-benchmark.sh smoke
scripts/performance/run-local-benchmark.sh light
scripts/performance/run-local-benchmark.sh sustained
scripts/performance/run-local-benchmark.sh burst
scripts/performance/run-local-benchmark.sh stress
scripts/performance/run-local-benchmark.sh rate-limit
```

By default raw artifacts are written below a unique private `/tmp/sco-b5-...-results` path, not the repository. To select a destination, set `SCO_PERFORMANCE_OUTPUT_DIRECTORY` to a private local directory. `SCO_PERFORMANCE_REBUILD_IMAGE=false` reuses the current local API verification image; the default rebuilds from the current worktree. Record the environment file and k6 summary alongside any accepted sanitized result; remove raw artifacts after extracting approved metrics.

The runner emits one JSON dataset description, one environment/runtime summary, one k6 summary, and a CSV of top normalized query families. Query families are reduced to labels; SQL text, parameters, client IPs, cookies, documents, and commercial fields are not included. The collector scrapes `/internal/metrics` every second and samples Docker CPU/memory plus PostgreSQL connection/lock counts, pool acquisition failures, Node event-loop percentiles, open descriptors, and active handles/resources. Pool waiting is an instantaneous gauge; short-lived spikes between samples may be missed.

## Stop and cleanup

Stop escalation immediately if the host safety guard refuses stress, swap-in/out rises continuously, available memory approaches 1 GiB, swap reaches 95%, PostgreSQL becomes unhealthy, API 5xx or p95 guardrails trigger, or the machine becomes unstable. Do not override the guard to complete a profile. The runner's trap removes its API/PostgreSQL/k6 containers, private network, database volume, and temporary decrypted setup directory. Verify cleanup with:

```bash
docker ps -a --format '{{.Names}}' | rg '^sco-b5-' || true
docker network ls --format '{{.Name}}' | rg '^sco-b5-' || true
docker volume ls --format '{{.Name}}' | rg '^sco-b5-' || true
```

The current baseline and the stress refusal caused by nearly exhausted host swap are recorded in `docs/architecture/stage-004-batch-5-performance.md`. Do not describe these single-host measurements as capacity guarantees or contractual SLAs.