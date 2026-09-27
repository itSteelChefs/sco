# Backup, Restore, and Disaster Recovery Runbook

## Safety rules

- Never run recovery tooling against Production from an unreviewed shell session. The script refuses `--environment production`; Production recovery requires a separately approved change procedure.
- Never put credentials or private keys in Git, backup filenames, manifests, command arguments, logs, or archives. Supply database and S3 credentials through protected environment files and keys through protected files.
- Never restore over a populated database or bucket. Restore into clean infrastructure, reconcile, validate, and switch traffic only after approval.
- Never treat an on-host copy as disaster recovery. Confirm the encrypted archive, envelope, and signature reached an independent destination.
- Never claim that PostgreSQL and object storage were captured atomically. Quiesce document writes for the backup window or explicitly accept and reconcile the consistency window.

## Declare and contain

1. Declare the incident, timestamp it, identify affected systems, and assign an incident lead and operator.
2. Stop unsafe writes or isolate the failed component. Preserve logs, release SHA, database state, object-store state, and failed migration output.
3. Keep traffic closed. Do not delete the failed source until evidence and the restore decision are recorded.
4. Determine whether the incident is DB-only, object-only, host-wide, deployment-related, migration-related, credential-related, or a partial restore.

## Select a recovery generation

1. Enumerate off-host recovery envelopes without copying keys into the application host.
2. Select a generation by incident time, recorded release SHA, migration state, freshness, and known integrity status.
3. Obtain the age identity and Ed25519 public verification key from the secrets/key authority through its audited break-glass process.
4. Verify that the archive, envelope, and detached signature share the same backup ID. Do not mix generations.
5. Record the selected generation and the expected RPO gap. This is an observed gap, not an SLA statement.

## Restore database and objects

Provision a clean PostgreSQL 17 database named `sco_dev`, a clean private S3-compatible bucket, and fresh credentials. The restore account must be able to create schema objects and roles. Runtime credentials remain external.

Set protected environment values without shell tracing:

```bash
export SCO_RESTORE_DATABASE_URL='postgresql://RESTORE_OWNER@NEW_DATABASE_HOST/sco_dev'
export RUNTIME_DATABASE_PASSWORD='FROM_SECRET_AUTHORITY'
export SCO_INTERNAL_DATABASE_PASSWORD='FROM_SECRET_AUTHORITY'
export SCO_RESTORE_S3_BUCKET='NEW_PRIVATE_BUCKET'
export SCO_RESTORE_S3_REGION='PROVIDER_REGION'
export SCO_RESTORE_S3_ENDPOINT='https://s3-compatible-provider.example'
export SCO_RESTORE_S3_FORCE_PATH_STYLE='false'
export SCO_RESTORE_S3_ACCESS_KEY_ID='FROM_SECRET_AUTHORITY'
export SCO_RESTORE_S3_SECRET_ACCESS_KEY='FROM_SECRET_AUTHORITY'
```

Run restore from the reviewed release checkout. Staging is the highest environment accepted by this general-purpose script:

```bash
scripts/recovery/restore-backup.sh \
	--archive /secure/input/sco-TIMESTAMP-ID.tar.age \
	--envelope /secure/input/sco-TIMESTAMP-ID.envelope.json \
	--signature /secure/input/sco-TIMESTAMP-ID.envelope.sig \
	--signing-public-key /secure/key/backup-signing-public-key.pem \
	--age-identity /secure/key/backup-age-identity.txt \
	--confirm-database RESTORE:sco_dev \
	--confirm-target RESTORE:NEW_DATABASE_HOST:5432/sco_dev \
	--environment staging \
	--report /secure/output/reconciliation.json
```

The command stops on a bad signature, hash, identity, archive entry, component, PostgreSQL version, non-empty destination, migration state, object byte, or reconciliation result. Retain its structured output with the incident record, excluding environment files and keys.

## Configure and start application

1. Restore runtime, internal executor, object-storage, session, metrics, Sentry, SSH/deployment, and registry credentials from their own authorities.
2. Select the immutable image digest whose release SHA matches the recovery decision. Do not rebuild merely to change environment configuration.
3. Validate environment separation: migration credentials go only to the migration job; runtime credentials go only to the API; browser applications receive no private credentials.
4. Keep inbound traffic closed and start the API against the restored database and bucket.
5. Require successful `GET /health/live` and `GET /health/ready`.

## Security and business verification

Run before reopening traffic:

```bash
corepack pnpm --filter @sco/api exec prisma migrate status --schema prisma/schema.prisma
corepack pnpm --filter @sco/api exec vitest run test/integration/security-gate.integration.test.ts --no-file-parallelism
corepack pnpm --filter @sco/api exec vitest run test/database/postgres-rls.integration.test.ts test/database/supplier-quote-document-isolation.integration.test.ts --no-file-parallelism
```

Confirm all expected migrations are applied; runtime and internal roles are non-owner, non-superuser, and `NOBYPASSRLS`; FORCE RLS and SECURITY DEFINER ownership remain correct; document bytes match metadata; reconciliation has zero issues; and designated business owners validate representative current records. Reopen traffic only after technical and business approval.

## Scenario decisions

**Database-only loss:** preserve the bucket, restore PostgreSQL into a new database, and reconcile against the existing bucket. Investigate objects newer than the selected database generation before classifying them as orphans.

**Object-store-only loss:** preserve PostgreSQL, restore object bytes into a new private bucket, and reconcile. Do not delete database references to make the report green.

**Complete host loss:** provision a new host from infrastructure authority, recover source and immutable image identity, restore configuration and secrets separately, restore database and objects, validate, then change traffic under a separate authorization.

For the dedicated Staging host, keep ingress closed until loopback-only application ports, the Batch 6-B Nginx edge contract, the Operations management-plane allow/deny policy, private database/object-storage reachability, and the immutable release digest are all verified. Staging recovery must use only Staging database, bucket, credentials, and backup generations; never restore Production data into Staging.

**Failed deployment:** keep data unchanged when possible and roll back to the previous immutable image digest. Restore data only if evidence shows data damage.

**Failed migration:** stop writes, retain migration output and current state, and follow the migration-specific rollback/forward-fix decision. Never reapply a backup over a live database as an automatic rollback.

**Partial restore:** keep traffic closed, discard the incomplete clean target, create another clean target, and rerun the verified generation. Do not continue into a partially populated destination.

**Credential loss:** recover or rotate credentials through the secret authority. Backups intentionally cannot recover credentials. Re-provision roles, revoke lost credentials, and verify access logs.

**Backup corruption or signature failure:** quarantine the set, do not decrypt or restore it, investigate destination integrity, and select another signed generation. If no valid generation exists, escalate the achievable RPO before action.

## Backup operation

Create a backup only to a reviewed independent mount. The plaintext working directory must be tmpfs outside local drills:

```bash
export SCO_BACKUP_DATABASE_URL='postgresql://BACKUP_ROLE@DATABASE_HOST/sco_dev'
export SCO_BACKUP_S3_BUCKET='PRIVATE_SOURCE_BUCKET'
export SCO_BACKUP_S3_REGION='PROVIDER_REGION'
export SCO_BACKUP_OFF_HOST_ROOT='/mnt/sco-backups'
export SCO_BACKUP_WORK_ROOT='/run/sco-backup'
export SCO_BACKUP_DOCUMENT_WRITES_QUIESCED='true'

scripts/recovery/create-backup.sh \
	--output-directory /mnt/sco-backups \
	--destination-kind off-host \
	--age-recipient 'age1PUBLIC_RECIPIENT' \
	--signing-key /secure/key/backup-signing-key.pem
```

Monitor the structured `backup_completed` event and independently copy or replicate the signed encrypted set according to provider policy. Verify restores on schedule; successful creation alone is not proof of recoverability.

## Retention and schedules

Preview retention before deletion:

```bash
node apps/api/scripts/recovery/retention.mjs --directory /mnt/sco-backups --signing-public-key /secure/key/backup-signing-public-key.pem --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --minimum-age-days 2 --execute false
```

Apply only after review by adding `--execute true --confirm DELETE:/mnt/sco-backups`. Counts shown here are recommended starting values, not contractual policy. The example systemd service/timer under `infrastructure/systemd` is disabled source material; do not install or enable it without Owner-approved objectives, destination, monitoring, and key custody.

## Local drill

Run the same evidence path without external accounts:

```bash
corepack pnpm recovery:test
corepack pnpm recovery:drill
```

The drill uses only synthetic data and temporary local resources. It destroys the source database and object volumes before creating targets. Its final JSON records measured durations and verification outcomes. All temporary resources and keys are removed by the cleanup trap.
