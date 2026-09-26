# Stage 004 Batch 1 - Production Runtime Foundation

## Scope

Batch 1 makes the current applications container-ready and verifies that API instances can be replaced or run in parallel without relying on process memory, sticky sessions, or a local document disk. It does not change Stage 003 business semantics, database schema, RLS, or authorization.

## Statelessness Audit

| Surface | Classification | Result |
| --- | --- | --- |
| Session state | Safe | Opaque session identifiers are hashed and stored in PostgreSQL. |
| Business state and concurrency | Safe | PostgreSQL is authoritative; database transactions, constraints, and advisory transaction locks govern shared state. |
| Database pools | Instance-local but non-critical | Each process owns pools only; Nest lifecycle shutdown closes them. |
| In-memory caches, queues, timers, and cron ownership | Safe | None are implemented in the current API runtime. |
| Document bytes | Repaired horizontal-scaling risk | Development/test uses local disk. Staging/production requires private S3-compatible object storage and fails closed without it. |

Document authorization remains in PostgreSQL and application services. Object storage receives only an already-authorized private object operation; it has no public ACL, no authorization role, and no exposed storage key or pre-signed URL contract.

## Runtime Configuration

Required API variables:

- `DATABASE_URL`: migration/admin and seed connection.
- `RUNTIME_DATABASE_URL`: `sco_runtime` application connection.
- `SCO_INTERNAL_DATABASE_URL`: `sco_internal_executor` internal connection.
- `SESSION_SECRET`: session/authentication secret.
- `NODE_ENV`: `development`, `test`, `staging`, or `production`.
- `SCO_DOCUMENT_STORAGE`: `local` only for development/test, or `s3`.

When `SCO_DOCUMENT_STORAGE=s3`, these are required at startup:

- `SCO_S3_BUCKET`
- `SCO_S3_REGION`
- `SCO_S3_ACCESS_KEY_ID`
- `SCO_S3_SECRET_ACCESS_KEY`

Optional S3-compatible settings are `SCO_S3_ENDPOINT`, `SCO_S3_FORCE_PATH_STYLE`, and `SCO_S3_SESSION_TOKEN`. `PORT` is optional and defaults to `3101`. The current web applications do not consume public runtime environment variables.

## Health and Shutdown

- `GET /health/live` proves the process is alive.
- `GET /health/ready` returns `200` only when both runtime and internal PostgreSQL connections succeed; it otherwise returns `503` with `NOT_READY` and no connection details.
- Nest shutdown hooks handle `SIGTERM` and `SIGINT`, close the HTTP server, and invoke database pool shutdown.

## Containers

Build from the repository root:

```sh
docker build -f apps/api/Dockerfile -t sco-api:local .
docker build -f apps/partner-web/Dockerfile -t sco-partner-web:local .
docker build -f apps/operations-web/Dockerfile -t sco-operations-web:local .
```

All images use multi-stage builds and non-root runtime users. The root `.dockerignore` excludes source secrets, Git metadata, node modules, build outputs, logs, and local development document storage. API images compile TypeScript and retain only production dependencies. Next images use standalone output.

For a staging-like API check, use a fresh local database, apply migrations `0001` through `0081`, seed it, supply the required S3 configuration, and bind only local test ports. A second API instance can use the same database with a different local port. Never use a Production database, bucket, credentials, or endpoint for these checks.

## Metrics-Driven Scaling Decisions

Future infrastructure decisions require collected evidence rather than arbitrary traffic thresholds. Measure request throughput; p50, p95, and p99 latency; error rate; CPU and memory; PostgreSQL pool saturation; slow-query latency; database CPU and I/O; repeated-read cacheability; background backlog if queues exist; deployment frequency; and fault-isolation need.

- Redis or caching requires repeated expensive reads or latency/database pressure that cannot be addressed in PostgreSQL first.
- A queue or message broker requires measured synchronous blocking, retries, burst handling, or failure-isolation pressure.
- A search engine requires evidence that PostgreSQL search cannot meet catalog latency or feature needs.
- A microservice extraction requires independent scaling, deployment, fault isolation, ownership, or materially distinct workload evidence.
- Kubernetes requires operational evidence from replica count, deployment complexity, and lifecycle management that simpler container deployment cannot safely handle.

Redis, Kafka, RabbitMQ, Elasticsearch, OpenSearch, microservices, Kubernetes, load balancing, and autoscaling remain deferred. Batch 1 adds none of them.
