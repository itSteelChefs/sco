# Stage 004 Batch 4: Backup, Restore, and Disaster Recovery Foundation

## Scope and recovery authorities

SCO recovery combines four independent authorities. PostgreSQL is authoritative for document identity, metadata, authorization, and application state. The private S3-compatible bucket is authoritative for document bytes. Git and immutable image digests are authoritative for application code. The deployment configuration and secret authority are authoritative for environment configuration, database credentials, S3 credentials, session secrets, telemetry credentials, the age identity, and the Ed25519 signing key.

The backup archive contains data only. It never contains database passwords, object-storage credentials, session secrets, SSH keys, telemetry credentials, the age identity, or the signing private key. Recovery is impossible without restoring data, application, configuration, and secrets from their respective authorities.

## Threat model

The recovery design addresses database loss or corruption, host loss, accidental deletion, object-store loss, a lost runtime node, failed deployment or migration, configuration loss, stale or corrupt backups, object/database mismatch, partial restore, unavailable credentials, and complete application-host replacement.

The controls are:

- PostgreSQL 17 custom-format archives produced and restored with PostgreSQL 17 native tools.
- Mandatory age X25519 encryption for every produced recovery archive.
- SHA-256 envelope and component hashes for corruption detection.
- Mandatory Ed25519 envelope signatures for backup-origin authentication.
- Restrictive umask, private temporary directories, and tmpfs plaintext workspace requirements outside local drills.
- Explicit off-host destination declaration and filesystem separation checks.
- Production restore refusal, explicit destination naming, empty-database and empty-bucket checks, and `RESTORE:<database>` confirmation.
- Fresh role provisioning from external credentials, followed by migration, RLS, authorization, and application tests.
- Database/object reconciliation that reports only keyed fingerprints, never private keys, filenames, or content.

No logical backup can protect against every compromise. An attacker controlling the source database can create a logically valid malicious backup; an attacker holding the signing private key can authenticate a forged backup; loss of the age identity makes encrypted backups unrecoverable. Key custody, separation, rotation, access logging, and independently protected copies remain operational requirements.

## PostgreSQL model

`scripts/recovery/create-backup.sh` uses `pg_dump --format=custom --no-owner`. It records server version, source database name, release SHA, applied Prisma migration names, timestamp, format version, archive size, and SHA-256. PostgreSQL 17 clients are required because the current server contract is PostgreSQL 17.

`scripts/recovery/restore-backup.sh` accepts only an explicit database URL plus exact database and host/port/database confirmations. It refuses Production, system databases, and non-empty targets. It verifies the Ed25519 signature, encrypted archive hash, age authentication, tar entry safety, manifest, component hashes, object hashes, and PostgreSQL major version before `pg_restore --exit-on-error --single-transaction --no-owner`.

The restore account becomes object owner. The fixed application roles are not restored with passwords. `apps/api/scripts/provision-runtime-role.mjs` idempotently creates `sco_runtime` and `sco_internal_executor`, sets externally supplied credentials, and enforces `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`. Schema grants, FORCE RLS policies, and SECURITY DEFINER ownership are restored from the database archive and verified by the security suites. Immutable migration `0001` requires the database name `sco_dev`.

## Object-store model and consistency

The object exporter uses standard S3-compatible list, get, put, and bucket-versioning operations. It records current visible object keys, lengths, hashes, versioning status, and content-addressed blob paths. It does not hardcode AWS endpoints or expose object content. Restore requires an empty destination and verifies every uploaded object by downloading and hashing it.

This is not an atomic distributed snapshot. Database writes and object writes may race the two captures. The manifest links one database archive and one object inventory into a named generation, but does not claim transaction-level atomicity across systems. Operational backup windows should quiesce document writes or use provider capabilities that establish a stable generation.

The reconciliation command compares PostgreSQL `documents` and `document_versions` against bytes and the selected inventory. It runs once against the source before a backup can complete and again against the restored target. It detects missing objects, orphan objects, size or checksum mismatch, conflicting references, partial restore, and wrong backup generation. PostgreSQL remains authoritative: reconciliation reports discrepancies and fails; it never silently creates or deletes business records or objects. Off-host backup also requires the operator to declare that document writes are quiesced for the capture window.

The exporter captures current visible versions. Provider versioning and object lock are recommended defenses against accidental deletion, but recovery of historical provider versions is provider-specific and is not represented as portable in format version 1.

## Manifest and encryption

The encrypted tar contains:

```text
manifest.json
database.dump
database-migrations.json
objects/inventory.json
objects/reconciliation.json
objects/blobs/<sha256>
```

`manifest.json` is `kind=sco-recovery-manifest`, `schemaVersion=1`. The outer `sco-recovery-envelope` version 1 records only a backup ID, timestamp, release SHA, encrypted archive filename, byte size, SHA-256, and encryption scheme. A detached Ed25519 signature authenticates the exact envelope. Encryption and signing keys are never archived together with data.

## Recovery objectives

Recovery point objective (RPO) is the maximum acceptable data loss measured backward from an incident. Recovery time objective (RTO) is the desired elapsed time to restore service. They are configurable business objectives, not promises made by this implementation.

Recommended technical starting points, subject to Owner approval and measured capacity, are encrypted daily backups, more frequent backups when the accepted RPO requires them, and at least one immutable off-host copy. The sample timer is daily only as an example. Batch 4 measured the final signed and source-reconciled synthetic local backup at 1.837 seconds, restore at 5.460 seconds, and full drill at 46.691 seconds. These measurements are evidence from a tiny isolated dataset, not a business SLA or capacity projection.

## Retention and scheduling

`retention.mjs` supports configurable daily, weekly, monthly, and minimum-age retention. It verifies every envelope signature and archive hash before planning deletion. Dry-run is the default. Deletion removes the archive, envelope, and signature only after both `--execute true` and `--confirm DELETE:<absolute-directory>`. Unknown, unsigned, or corrupt artifacts fail the operation rather than being deleted.

The systemd unit and timer under `infrastructure/systemd` are examples only. They are not installed or enabled. Production activation requires Owner-approved frequency, retention, mount, key custody, monitoring, and destination. A backup held only on the application host is not disaster recovery; `destination-kind=off-host` requires output under a declared off-host root mounted on a different filesystem from `/`.

## Source and host recovery

Complete host replacement starts from the reviewed Git repository and immutable release SHA. CI workflows reproduce validation and images; the released digest, not a mutable tag, identifies the application. GitHub repository availability, branch protections, CI configuration, package registries, container registry, DNS, and infrastructure provisioning are external recovery dependencies. Batch 4 does not copy GitHub or configure any external backup destination.

## Verified drill

The local drill uses isolated PostgreSQL 17 and Adobe S3Mock 5.2.3. It applies all 81 migrations, provisions roles, seeds synthetic data and two private objects, creates and signs an encrypted backup, destroys source containers and volumes, creates fresh target containers and volumes, restores and reconciles data, starts the API, checks liveness/readiness, runs the 18-test security gate, and runs 11 RLS/document tests. Cleanup removes containers, networks, volumes, archives, identities, signing keys, and reports.
