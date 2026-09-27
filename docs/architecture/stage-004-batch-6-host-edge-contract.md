# Stage 004 Batch 6-B: Staging Host and Edge Trust Contract

## Scope

This contract defines repository-side requirements for a future dedicated Staging VPS. It does not provision a host, modify DNS, issue certificates, deploy software, open firewall ports, or connect Production resources. Batch 6-C owns host onboarding.

Production deployment is disabled. The release workflow contains only the Staging deployment path, and both deployment scripts refuse every environment other than `staging`.

## Public and private boundaries

The only public HTTPS hostnames are `staging.sco.sa` and `operations.staging.sco.sa` on port 443. No API hostname exists. Each host proxies `/api/` to the API and its remaining paths to its matching web application.

API, Partner, and Operations containers publish only to `127.0.0.1:3101`, `127.0.0.1:3102`, and `127.0.0.1:3103`. PostgreSQL, `/internal/metrics`, `/health/live`, `/health/ready`, Docker, and object storage are private. Nginx does not proxy `/internal/` or `/health/` through either public hostname.

The Operations hostname is not unrestricted public access. The template requires `/etc/nginx/sco/operations-management-access.conf`; host onboarding must populate it with the approved VPN or private-management allow/deny policy. A missing file makes Nginx configuration validation fail closed.

## Nginx and client identity

[staging-edge.conf.template](../../infrastructure/nginx/staging-edge.conf.template) is version 1 of the required Nginx contract. Batch 6-C renders its certificate placeholders into root-readable host-local paths, supplies the Operations access include, runs `nginx -t`, and reloads only after approval.

Nginx sets `X-Forwarded-For` to `$remote_addr`; it does not append a request-provided chain. It clears `X-Real-IP` and `Forwarded`. The API retains `trustProxy: false` and does not use those framework-derived headers. Instead, the rate limiter accepts the one forwarded IP only if the immediate API socket peer exactly matches `SCO_TRUSTED_PROXY_PEERS`.

Staging requires `SCO_TRUST_PROXY=trusted-peers`, `SCO_TRUSTED_PROXY_PEERS=127.0.0.1`, and `SCO_RATE_LIMIT_CLIENT_IDENTITY=trusted-proxy`. Invalid proxy mode, empty/malformed/duplicate peer addresses, a client-identity mismatch, a forwarded chain, an invalid forwarded value, or an untrusted immediate peer fails closed to the direct peer identity. Direct mode remains the default for development and test.

## Staging rate limits

The deployment transport validates exactly these Staging-only values:

| Policy | Value |
| --- | --- |
| application | 120 requests / 60 seconds / client IP |
| authentication | 20 attempts / 60 seconds / client IP |
| readiness | 120 checks / 60 seconds / monitoring peer |
| buckets | 10,000 |

The limiter is process-local. This contract covers one API instance and introduces neither Redis nor distributed coordination. Production values are not defaults and are not authorized by this Batch.

## Secrets, images, and recovery

Migration payloads alone contain `DATABASE_URL`. API runtime payloads contain only `RUNTIME_DATABASE_URL`, `SCO_INTERNAL_DATABASE_URL`, session, S3, rate-limit, and telemetry configuration. Web payloads cannot contain database, S3, or session secrets. Host payload files must be mode `0600`.

Staging uses distinct private PostgreSQL, S3, and credentials; Production data and credentials are prohibited. Releases require a successful CI run for a full SHA on `main`, publish private GHCR images with provenance/SBOM, and deploy only immutable `@sha256:` references. The host never rebuilds images. Recovery uses Staging-only data and follows the private recovery path before ingress is reopened.

## Verification

Run `corepack pnpm ci:staging-edge` to assert the static edge and deployment contract; it also runs `nginx -t` against a temporary rendered configuration when Nginx is installed. Focused API tests prove direct peers, trusted peers, malformed configuration, spoofed headers, forwarded chains, and separate client buckets. Existing observability tests prove metrics authorization and telemetry redaction.

Before any host is enabled, Batch 6-C must prove external port filtering, direct-origin denial, unknown-host denial, Operations management access, certificate issuance/renewal, private metrics access, host secret permissions, Staging-only database/object-storage identities, and immutable digest deployment. Batch 6-C is not authorized by this document.