# Documentation index

Every document in `docs/`, what it covers, and who it is for. **Keep this file
current**: when a feature changes, update its document *and* the row here. When
something new is built, add the document *and* a row here in the same change.

_Last updated: 2026-09-03_

---

## Start here

| File | Topic | What it covers |
|---|---|---|
| [architecture.md](./architecture.md) | How the app is put together | No build step, in-browser Babel, one global scope, the store, why a typo is a runtime error. **Read before touching any `.jsx`.** |
| [multi-tenancy.md](./multi-tenancy.md) | One deployment, many companies | RLS on membership, org-scoped tables, feature flags vs workflow profiles, per-org state that lives on `window`. |
| [workflow-profiles.md](./workflow-profiles.md) | Per-company behaviour | How `standard` and `procurement_only` differ, every switch and what it does, how to add a third company type. |

## The Microlink flow, end to end

| File | Topic | What it covers |
|---|---|---|
| [microlink-procurement-flow.md](./microlink-procurement-flow.md) | The whole flow | Import → SO → vendor PO → in transit → GRN → VG → dispatch → invoice, and the two hard parts. |
| [sheet-import.md](./sheet-import.md) | Customer BOQ → Sales Order | Reading their Excel: Sr. No. hierarchy, merged cells, group banners, the bundle-quantity trap. |
| [item-name-mapping.md](./item-name-mapping.md) | The three-name chain | Customer name → our item → vendor part number. Where each is used, how it is learned, batch matching. |
| [vendor-po-pricing.md](./vendor-po-pricing.md) | Buying and pricing | Assign vendors by group, price history, client price beside vendor price, margin. |
| [receiving-grn.md](./receiving-grn.md) | Goods in | Stores confirms → Purchase accepts, the receive dialog, VG tracking columns, GRN visibility. |
| [dispatch-invoicing.md](./dispatch-invoicing.md) | Goods out and billing | Partial dispatch, delivery challan, invoice on dispatch, invoices in the customer's own item names. |
| [documents.md](./documents.md) | What we print | PO e-Bill, delivery challan, tax invoice — columns, numbering, preview-equals-paper. |
| [po-tax.md](./po-tax.md) | Tax on a purchase order | Several taxes stacked per line (GST + TDS + TCS), in bulk or per PO; why the sign and the base matter. |
| [document-numbering.md](./document-numbering.md) | Every document number | `PO202609001`, `DC…`, `INV…`, `EB…`, the client invoice from their order number, and why numbers cannot collide. |
| [boq-billing.md](./boq-billing.md) | Billing groups | What gets billed together: BOQ 001, 002, … carved from the BOM; a group bills only when all of it is dispatched; the Final sweep. |
| [sales-order-lifecycle.md](./sales-order-lifecycle.md) | Order status | Why status is derived from facts, every transition, what it will never do. |

## Operations

| File | Topic | What it covers |
|---|---|---|
| [testing.md](./testing.md) | The check suite | What each `scripts/uitest/*-check.js` guards and why. **Run before every deploy.** |
| [tenant-subdomains.md](./tenant-subdomains.md) | Subdomains and TLS | Per-tenant hosts, Vercel + Cloudflare provisioning. |
| [COOLIFY_OPC_SUPABASE_SETUP.md](./COOLIFY_OPC_SUPABASE_SETUP.md) | Self-hosted Supabase | The Coolify stack, service ids, what must not be touched. |
| [REMOTE_SERVER_SETUP.md](./REMOTE_SERVER_SETUP.md) | The host | Server access and layout. |

---

## Conventions

- **One document per feature area**, not per code file. A reader wants "how does
  receiving work", not "what is in `screens-godown.jsx`".
- Every document answers three things in order: **what it is**, **how it works**,
  **why it is that way**. The third is the one that saves the next person.
- Record the **traps**. Most of these documents exist because something was
  wrong in a way that was not obvious, and the note about it is worth more than
  the description of the happy path.
- When a rule is enforced by a test, **name the test**. A claim with a check
  behind it is different from a claim without one.
