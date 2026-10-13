# Phase 1: Read-only architecture and request-flow audit

**Repository:** `UniMisk-Erp-Solutions/ops-central`
**Audit date:** 2026-10-12
**Audit branch:** `nikunj/phase1-audit-20261012`

## Purpose and scope

Phase 1 established a source-based baseline for the Ops Central architecture,
multi-organization boundaries, business request flow, security, reliability,
and DevOps. It was an inspection and documentation phase: it did not change
application behavior, permissions, schema, migrations, services, or production
data.

The audit followed the repository's existing documentation convention and
recorded its full evidence, diagrams, module inventory, findings, and proposed
implementation order in
[the architecture/security/DevOps audit](./architecture-security-devops-audit.md).
This handoff summarizes that document; it intentionally does not reproduce it.

## Architecture and request flow examined

The audit traced the static React frontend, with JSX compiled in-browser by
Babel, through Supabase Auth and the browser Supabase client. Most business
reads and writes use PostgREST; selected operations use PostgreSQL RPCs and a
Supabase Edge Function. PostgreSQL tables, organization membership, and RLS
form the data layer. The audit also reviewed Supabase Storage, the small Node
development/status backend, static hosting configuration, Edge configuration,
migrations, and deployment documentation.

It mapped active-organization and membership context, UI roles and
organization-specific settings, tenant stamping and RLS, localStorage recovery,
and a complete Client Request path: browser form and store → `client_requests`
and notification writes → Purchase matching/conversion → Sales Order and
linked Sourcing records. The broader business path was mapped as Request /
Sourcing → Sales Order → Vendor PO → GRN → stock → dispatch → invoice → payment.
The audit also inventoried the app's operational and administration modules.

## Key source-confirmed findings

- Operational RLS policies generally enforce organization membership but not
  the app's per-role action permissions. UI capability checks can therefore be
  bypassed by direct authenticated table requests.
- The legacy `opc_delete_user` security-definer RPC relies on a global admin
  check and does not constrain the target to the caller's organization.
- Service-role RFQ and quote Edge routes do not validate a tenant Purchase
  caller. Quote submission did not check database PATCH responses, and its
  JSON read/modify/write could lose concurrent changes.
- General store mutations were optimistic and asynchronous; some multi-table
  conversions and stock/billing transitions lacked a database transaction.
- The initial table loader had no pagination; document-number generation lacked
  database uniqueness; the cache recovery path checked user identity but not
  the active organization.
- The `site-updates` Storage bucket was configured public in the migrations
  reviewed. Business references also lacked comprehensive same-organization
  foreign keys.

These statements describe checked-in source and migrations, not confirmed live
exploitation or deployed configuration.

## What remains unverified

The full audit records the evidence and limits. In summary, deployed schema and
migration status, live RLS policies, runtime Edge version, actual tenant/role
behavior, network and TLS settings, Coolify configuration, logs, backups, and
restore capability were not established. The narrow SSH availability check
recorded in the audit found the documented database service directory and
container unavailable at that time; it did not query the database or inspect
other services. Live verification requires an authorized disposable or staging
environment and authenticated test users.

## What Phase 1 documented—and did not implement

The linked audit contains the current architecture and sequence diagrams,
organization/role analysis, module table, client/server responsibility table,
security findings, confirmed and suspected bug/risk registers, verification
limits, and a phased remediation plan. `docs/INDEX.md` was updated to make it
discoverable.

Phase 1 made no application or server fixes, no role or permission changes, no
schema or migration changes, and no deployment or database writes. The findings
were recommendations for separately reviewed implementation work, not fixes
made by the audit.
