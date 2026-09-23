# SCO Backup, Recovery, and Future Production Deployment

This document records the Stage 002 design requirements only. No production deployment, DNS, Nginx, firewall, or external service change is performed by Stage 002.

## Backup and recovery requirements

- PostgreSQL backups must support encrypted logical backups and, when production scale requires it, point-in-time recovery (WAL archiving).
- Backups must be stored off-host with restricted access, key rotation, retention tiers, checksum verification, and documented deletion windows.
- Recovery drills must restore into an isolated environment, apply migrations in order, verify RLS/runtime-role behavior, and run tenant-isolation smoke tests.
- The owner must set target RPO/RTO values before production launch; backup frequency and retention are derived from those targets.
- Credentials and encryption keys must come from a secret manager or protected environment, never from migrations, images, or Git.

## Future deployment requirements

- Build an immutable image from a reviewed lockfile and publish a digest; promote the same artifact through development, staging, and production.
- Require a successful backup and migration compatibility check before schema changes. Migrations must run as an explicit release step, never implicitly on application startup.
- Use health checks, staged rollout, rollback to the previous image, and an owner-approved change window. DNS/Nginx changes remain a separate approved operation.

These requirements are intentionally deferred from execution. They do not represent a production readiness claim.
