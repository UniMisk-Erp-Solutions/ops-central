# Phase 2: Reliability and security hardening handoff

**Repository:** `UniMisk-Erp-Solutions/ops-central`
**Branch:** `nikunj/phase2-hardening-20261012`
**Implementation commit reviewed:** `93461e2` (`fix: harden Ops Central data handling`)
**Handoff date:** 2026-10-13

## Summary

Phase 2 made a limited hardening pass in the shared frontend store and the
vendor quote Edge Function. It improves large-table reads, tenant cache
recovery, reporting of failed writes, pool error reconciliation, and quote-link
handling. It is not a complete implementation of the broader Phase 2 plan.

The full evidence and outstanding-risk record remains in
[the architecture/security/DevOps audit](./architecture-security-devops-audit.md).
The workflow context for SO-based vendor quotes is in
[Float RFQ for an SO](./so-float-rfq.md).

## Problems addressed and code changes

| Problem area | Actual change | Files / functions | Remaining limit |
|---|---|---|---|
| Incomplete initial data loading | Reads tenant tables in 500-row PostgREST ranges and treats a failed page as a failed load, routed through the existing sync-error path. | `frontend/src/store.jsx`: `__selectAllRows`, initial data effect | Offset pagination may shift while rows change. Large live tables were not tested. |
| Stale cross-organization cache recovery | The table load waits for the server-resolved active organization. Recovery accepts cached rows only when both user ID and org ID match. | `frontend/src/store.jsx`: initial data effect and `__cached` checks | No runtime org-switch test was possible; RLS remains the database boundary. |
| Network/write errors hidden in sync | Upsert/delete exceptions are reported through the existing sync-error callback. `__syncTables()` returns its promises and Retry waits for them. | `frontend/src/store.jsx`: `__syncTable`, `__syncTables`, `retrySync` | Existing `mutate()` callers still update optimistically; this does not make all screen saves await database acknowledgement or roll back. |
| Pool write reports success after failure | Pool update/delete responses are checked. On partial failure, the store reports the error and reloads the RLS-scoped pool; local state is updated optimistically only after all writes succeed. | `frontend/src/store.jsx`: `consumeFromPool` | A group of pool writes is not transactional; concurrent allocations can still race, and all callers do not yet abort downstream actions based on `{ok:false}`. |
| Weak/replayable quote links and invalid quote data | New/refloated links use 32 cryptographically random bytes and a 30-day expiry. Quote load/submit reject expired links; submit validates requested item IDs and non-negative finite prices. | `supabase/functions/main/index.ts`: `/float-rfq`, `/quote-load`, `/quote-submit` | Existing links without expiry remain valid for compatibility. Expiry is stored in the existing JSON vendor object; no migration was made. |
| Quote endpoint false-success and simple duplicate retry | RFQ and Sourcing PATCH response statuses are checked. A quote already marked submitted reuses its stored values and can reconcile Sourcing; its original submitted timestamp is preserved. | `supabase/functions/main/index.ts`: `/quote-submit` | RFQ and Sourcing remain separate writes; concurrent requests may race, and there is no transaction or persistent idempotency key. |

## Workflow, roles, tenancy, and architecture

No role names, permission definitions, organization workflows, statuses,
navigation, database schema, migration, table policy, or business transition
was changed in the implementation commit. The application remains a static
React frontend using Supabase Auth, PostgREST/RPC, PostgreSQL/RLS, and Supabase
Edge Functions. Existing UI role and workflow gates remain in place.

The table load is bound to the active organization returned by the existing
context RPC, while database reads and writes continue to rely on the existing
tenant RLS. Quote expiration applies to newly created or re-floated links;
legacy links without `expires_at` were left usable so already-sent requests
were not invalidated unexpectedly.

## Verification

- `git diff --check` passed for the Phase 2 implementation changes.
- All 22 repository UI check scripts were attempted. They exited before test
  execution because their local dependencies (`@babel/standalone`, React,
  ReactDOM, and/or jsdom) were missing. Dependencies were not installed.
- Edge Function type checking did not run because Deno was unavailable.
- No browser workflow, Network panel inspection, disposable Supabase test,
  database row/ID verification, failure-injection test, or two-organization
  authorization test was performed.
- No SSH, Supabase database, Coolify service, or production environment was
  accessed; no migration or deployment was run.

## Outstanding work

1. Add server-side authorization for current organization-specific roles and
   actions without removing valid per-organization capabilities. Repair the
   global-admin user-deletion path and the membership-only operational write
   policies identified in the audit; protect service-role RFQ floating with
   caller and tenant validation.
2. Add transactional RPCs or equivalent safe compensation for request/SO
   conversion, GRN and stock, dispatch, invoices, payments, transfers, and
   RFQ/Sourcing writes. Add durable idempotency and concurrency/version checks
   for retries and concurrent edits.
3. Make high-value saves await committed responses and reconcile/rollback
   failures; validate quantity, stock, price, balance, and related-record
   invariants on the server as well as in the UI.
4. Add and execute regression tests for tenant isolation, roles, duplicate
   submissions, network failures, stale cache, concurrent updates, and the
   end-to-end business workflow in a disposable environment.
5. Verify deployed migration/policy state, Edge version, HTTPS/CORS, Coolify
   service health, backups, and an isolated restore. None of these runtime
   checks was done in this phase.

## Migration and deployment requirements

No migration is required for the committed code: `expires_at` is stored inside
the existing RFQ vendor JSON data. The Edge Function code must be deployed to
an authorized non-production/test environment before its quote-link changes
can be exercised. Deployment was not performed here. Verify legacy quote-link
handling and rollback behavior in staging before any production rollout.

## Follow-up: organization-scoped user administration

The Phase 2 branch now includes the additive migration
`supabase/migrations/040_org_scoped_user_admin.sql`. It addresses the user
administration authorization gap found in the audit without changing screens,
role names, navigation defaults, or workflow statuses:

- `opc_create_user` requires effective Settings access in the active
  organization, and stamps the new membership into that organization instead
  of the caller's default organization.
- `opc_delete_user` lets a tenant administrator deactivate only a target
  membership in the active organization. A tenant removal no longer deletes a
  shared auth login/profile. Platform master admins retain the global delete
  path.
- `opc_org_users` remains the active-user roster used by the app-wide role
  switcher, with an active-org membership guard. A separate
  `opc_org_managed_users` roster lets Settings show inactive memberships for
  reactivation without adding them to the role switcher. The existing Users
  toggle calls `opc_set_org_user_active`; direct writes to the shared
  `public.users` profile are limited to platform master admins.
- `opc_can_manage_org_users` resolves the caller's profile role against the
  active organization's configured navigation override. An explicit `nav`
  array takes precedence; absent an override, only the built-in `Org Admin`
  role includes Settings, matching `permissions.jsx`.

Affected code is `frontend/src/store.jsx` (wait for the scoped membership RPCs
before changing local state), `frontend/src/screens-config.jsx` (load the
separate managed roster, report failed toggle writes, and clarify organization
removal), plus the migration above.

The role compatibility constraint remains: `public.users.role` is one global
value per login, while membership role and organization permission overrides
are separate. This migration does not create per-organization app roles. A
future staged migration should add an organization-scoped app-role assignment,
backfill each current user's role to every active membership, compare each
organization's effective `can`/`nav` values against current behavior, and only
then move reads and writes behind that assignment. Do not reinterpret
`organization_memberships.role` (`admin`/`member`) as the app role.

### Follow-up verification and remaining scope

- Added `supabase/tests/040_org_scoped_user_admin.test.sql`, a transactional
  pgTAP test for active-org Settings authorization, cross-org removal denial,
  active-org assignment on create, preservation of the other tenant's
  membership, denial for an unlinked global Org Admin profile, and refusal of
  direct tenant writes to global user profiles. It also checks that inactive
  organization memberships remain visible in Settings but outside the
  active-user switcher roster.
- The migration and database test were not executed in this environment:
  Supabase CLI and `psql` are unavailable, Docker is installed but its local
  daemon is not running, and this checkout has no `supabase/config.toml` for a
  local CLI project. The test has not been validated by a database parser.
  Run it against a disposable local Supabase project after setting up its
  config and applying migrations locally; never point the test runner at the
  hosted database.
- High-impact workflows (client-request conversion, RFQ/Sourcing, GRN/stock,
  dispatch/invoice, payment and transfer) still lack atomic transactions and
  comprehensive retry/concurrency protection. Operational table policies also
  remain membership-based in several areas, so this is not a complete
  server-side authorization pass.
- App role and global account-active values remain on the shared profile;
  platform master admins still control those values. Per-organization app-role
  assignments require the staged migration described above and remain
  outstanding.
- No migration was applied, and no database, Edge Function, frontend runtime,
  or hosted service was accessed for live verification.
