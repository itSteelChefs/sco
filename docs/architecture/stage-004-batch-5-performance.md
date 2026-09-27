# Stage 004 Batch 5: Performance and Abuse-Resistance Foundation

## Runtime surface and existing signals

The API remains one NestJS/Fastify modular monolith. Fastify proxy trust is explicitly disabled. The API binds to `0.0.0.0` in its container, while the deployment script binds the published host port to loopback for an external host ingress. No trusted proxy CIDRs or proxy-chain contract are currently configured.

`MetricsService` exports bounded HTTP counts, latency histograms, in-flight requests, process CPU/memory, Node event-loop/runtime signals, runtime/internal PostgreSQL pool total/idle/waiting gauges, pool acquisition/idle-client failure counters, readiness dependency state, and storage failure counts. `/health/live` is dependency-free; `/health/ready` checks both required PostgreSQL pools. `/internal/metrics` remains private and is not a readiness dependency. Query-family timings for local benchmarks come from `pg_stat_statements`; raw SQL text is never exported.

Runtime and internal `pg.Pool` instances use defaults of 25 clients each (at most 50 combined per API process) and a 5-second connection/acquisition timeout. `SCO_DATABASE_POOL_MAX` accepts 1..100 clients per pool and `SCO_DATABASE_CONNECTION_TIMEOUT_MS` accepts 1..60000. Waiting counts are instantaneous Prometheus gauges sampled continuously during benchmark runs. Existing endpoints use server-derived membership and transaction-local RLS context. Pagination accepts page size 1..100. The current internal company page filters to the active tenant and returns at most one company row. The catalog products endpoint returns an unpaginated list, but its `sco.internal.manage` permission is not seeded by the accepted migrations; it was not made loadable by inventing RBAC. No document metadata GET endpoint exists; document upload/extraction paths need business fixtures and object storage, so they were not used as benchmark shortcuts.

## Harness and dataset

`performance/k6` contains the authenticated mixed workload and login-abuse profile. k6 1.3.0 is run from the official `grafana/k6` image pinned by digest. The local runner creates a unique temporary PostgreSQL 17 container/volume, API container, network, and k6 container. It applies the existing 81 migrations and existing seed flow, sets database identity to `test`, then adds only benchmark-specific synthetic data. The database is published on an ephemeral loopback port; the API and k6 containers use only their private benchmark network. No external service, account, SaaS, customer data, object data, or real credential is used.

The deterministic dataset contains 250 synthetic Partner companies plus the two seeded companies, one existing seeded test user with 252 active memberships, and 500 active synthetic Product Identity rows in a dedicated synthetic category. It creates only existing-schema records, reuses existing permission codes and fixtures, and does not edit the ordinary development seed or schema. The same seeded user switches among its synthetic tenant memberships during concurrent reads; an unrelated synthetic tenant ID must return 403 with no company projection.

`scripts/performance/run-local-benchmark.sh` rejects non-test deployment markers and the dataset generator independently requires `NODE_ENV=test`, `sco.environment=test`, and loopback `sco_dev`. Raw outputs default to a private `/tmp` directory. Cleanup removes containers, volumes, networks, and ephemeral work directories. Results include k6 summaries, sampled Docker/API/pool/event-loop signals, PostgreSQL connections/lock waiters, query-family aggregates, and environment metadata. Reports do not contain credentials, tokens, client IPs, SQL, or business rows.

Load shapes are smoke (1 VU/5s), light (up to 5 VUs/20s), sustained (up to 15 VUs/30s), burst (up to 40 VUs/15s), stress (10→40 VUs with cooldown), and rate-limit abuse (30 login attempts). The k6 workload mixes liveness/readiness, login/session creation, authenticated Partner reads, tenant-scoped company reads across synthetic tenants, bounded internal page reads, and expected cross-tenant denials. Login is the representative controlled write. Rate-limit abuse sends invalid synthetic login credentials with forged forwarding headers and checks that liveness stays available.

API and PostgreSQL benchmark containers are capped at 0.75 CPU and 1 GiB each; k6 is capped at 0.25 CPU and 512 MiB. These constraints protect the host and make measurements specific to this container budget. Every profile requires swap below 95% before provisioning, build, and API startup. Stress additionally requires swap at or below 50%. All profiles monitor continuously and stop if available memory falls below 1 GiB, swap reaches 95%, either service container is OOM-killed, or PostgreSQL becomes unhealthy. k6 aborts stress if p95 exceeds 800 ms for 5 seconds or HTTP errors exceed 5% for 2 seconds. Those are local test-safety guardrails, not product SLOs.

## Measured evidence

Environment: x86_64 Ubuntu 22.04; 2 logical CPUs; 8,322,359,296 bytes RAM; Node 20.20.2; PostgreSQL 17.11; Docker; one API, one PostgreSQL, one k6 generator; dataset as above. The host already had 4,294,963,200 bytes swap configured and was near full before stress testing. Results below are local point measurements, not confidence intervals or customer commitments.

| Profile | HTTP requests | RPS | p50 | p95 | p99 | max | errors | 429 | 5xx | Checks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Smoke, 1 VU/5s | 343 | 67.23 | 7.49 ms | 95.70 ms | not captured in initial smoke | 242.24 ms | 0% | 0 | 0 | 343/343 |
| Light before query filter, 5 VUs/20s | 1,582 | 79.08 | 25.20 ms | 156.82 ms | 478.25 ms | 647.85 ms | 0% | 0 | 0 | 2,058/2,058 |
| Light after query filter, 5 VUs/20s | 1,692 | 84.57 | 21.42 ms | 156.85 ms | 539.67 ms | 805.28 ms | 0% | 0 | 0 | 2,199/2,199 |
| Sustained, 15 VUs/30s | 1,417 | 47.07 | 214.41 ms | 681.91 ms | 1.17 s | 1.50 s | 0% | 0 | 0 | 1,841/1,841 |
| Burst, 40 VUs/15s | 221 | 13.93 | 1.02 s | 11.20 s | 13.69 s | 14.86 s | 0% | 0 | 0 | 297/297 |
| Stress, 10..40 VUs | Not run | - | - | - | - | - | - | - | - | Refused by host safety guard: swap was 99.94% used with about 2.4 MiB free |

The light before/after runs use the same 5-VU profile and dataset. The membership-context query changed from 336,672 rows over 1,336 calls (mean 0.810 ms, max 11.970 ms) to 1,349 rows over 1,431 calls (mean 0.050 ms, max 2.631 ms), approximately 94% lower mean execution time and about 99.6% fewer rows returned. Overall p95 did not materially improve and p99 varied upward; this workload includes password verification and shared-host noise, so no overall-latency improvement is claimed from that comparison.

At 15 VUs, runtime pool total reached 10, idle fell to 0, waiting peaked at 4, internal pool waiting stayed at 0, event-loop max lag was 156 ms, PostgreSQL lock waiters were 0, and PostgreSQL CPU peaked at 27.9% in the constrained container. At 40 VUs, runtime pool waiting peaked at 21, API CPU peaked at 117% as reported by Docker stats, event-loop max lag reached 212 ms, PostgreSQL CPU peaked at 16.85%, and lock waiters remained 0. Host swap-out increased about 32 MiB during the short burst. The first observed degradation is therefore API-side CPU/connection-pool queueing under this 0.75-CPU API cap, not PostgreSQL lock contention. Increasing pool size without evidence would move contention, not remove the measured bottleneck.

The membership-context query optimization adds `m.companyId = requestedCompanyId` when the caller supplies the already-authorized tenant selection; requests without a selected tenant retain the full membership query to preserve zero/one/multiple membership semantics. Existing authorization, tenant resolution, transaction-local context, RBAC, and RLS remain active. Pool max/timeout bounds are separate operational resource controls.

The last successful sustained/burst measurements occurred before the 5-second pool acquisition timeout and its failure counter were added. A post-timeout load repeat was not run: the host safety guard found swap 99.94% used with about 2.4 MiB free, so escalation stopped. The earlier burst metrics characterize the pre-timeout behavior; a representative post-timeout stress measurement remains a verification gap and must be run only on a host with safe memory/swap headroom.

## Rate-limit model and client identity

The process-local fixed-window limiter uses Fastify's socket peer address (`request.ip`) with `trustProxy: false`. `X-Forwarded-For` and related headers cannot select or rotate buckets. Application traffic, `/api/v1/auth/login`, and `/health/ready` have separate policies. Every login attempt, successful or not, consumes the authentication budget. Only dependency-free `/health/live` is exempt. A 429 returns `{ "error": { "code": "TOO_MANY_REQUESTS" } }` plus `Retry-After`; bounded Prometheus counters include policy, method, and route policy only. Rejected requests are not individually logged, preventing attacker-controlled log amplification.

Development defaults are 120 application requests/minute, 20 authentication requests/minute, and 120 readiness probes/minute per observed peer. Test code sets deterministic low values (2/second application, 1/second authentication, 2/second readiness); the local abuse harness sets 10/minute for application/auth and a separate high readiness allowance. Only dependency-free liveness is exempt. Client state is capped at 10,000 peers by default and at 100,000 maximum. When the map is full and no expired entry can be removed, new identities fail closed with 429 until a window expires.

Staging and Production require explicit application/auth/readiness limits and windows plus `SCO_RATE_LIMIT_CLIENT_IDENTITY=direct-peer`. The service refuses `SCO_TRUST_PROXY` values other than `false`; it does not trust proxy headers. This direct-peer assertion is valid only when the API socket peer is actually the client. If a reverse proxy/NAT collapses all users to one peer, the limiter would share one bucket; operators must not set the assertion in that topology. Rate limiting must remain explicitly disabled until the Owner approves a concrete trusted-proxy CIDR/chain and infrastructure can guarantee that untrusted clients cannot connect directly. This proxy boundary is an Owner Decision; no trusted proxy model is silently inferred.

The limiter is process-local, not global across replicas. Each API instance has its own windows; per-instance counters are not distributed enforcement. Consider centralized coordination only after multiple active API instances are deployed and measured cross-instance tests show aggregate accepted traffic exceeds the explicitly configured per-client policy. Redis is not introduced by this Batch.

## Engineering guardrails and scaling triggers

These are internal investigation triggers only, not contractual SLAs and not Production-specific limits:

- Investigate API CPU or pool sizing when CPU remains above 70% of its container budget for 5 minutes or runtime pool waiting stays above zero in more than 5% of samples during a representative sustained run.
- Investigate route/query behavior when p95 exceeds 500 ms for 5 minutes at the approved workload mix, or p99/max trend upward while throughput falls.
- Investigate PostgreSQL sizing/query plans only when database CPU/I/O, connection use, lock waits, or query-family duration rise with the same workload. Add read replicas only when measured read pressure remains after query/index optimization and the accepted consistency model permits them.
- Increase host capacity when API and database containers remain at their approved CPU/memory budgets and host available memory or CPU contention is the first limit.
- Consider a second API instance only after single-instance capacity and ingress/client identity are measured. Re-test cross-instance rate-limit behavior before claiming a shared budget.
- Consider a centralized limiter only when multiple active instances measurably bypass a required aggregate abuse budget and the Owner approves the shared-store security/availability boundary.
- Consider a job queue only when an existing asynchronous operation has measured queue depth or synchronous request duration that cannot be bounded by local optimization. Consider service extraction only for demonstrated fault-isolation or independent scaling needs.
- Tune object storage only after a measured S3 latency/error bottleneck. No object traffic was part of this Batch benchmark.

Future contractual SLA, Production rate limits, trusted proxy ranges, read-replica consistency, and shared rate-limit storage require Owner approval. Batch 6 and later stages have not started.