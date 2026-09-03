# OP Central — working agreement

## Before editing any `.jsx`

Read [docs/architecture.md](./docs/architecture.md). There is **no build step**:
Babel runs in the browser, every file shares one global scope, and a mistake is
a runtime error that whites out the page rather than a build failure.

## Documentation is part of the change

`docs/` is how the team understands this system. Keep it true:

- **Changing a feature** → update its document in `docs/` in the same change.
- **Building something new** → add a document for it, and a row in
  [docs/INDEX.md](./docs/INDEX.md).
- **Removing something** → delete or amend the document, and the index row.
- [docs/INDEX.md](./docs/INDEX.md) lists every document with its topic and a
  description. It must never be stale — a teammate reads it first.

Each document answers three things in order: **what it is**, **how it works**,
**why it is that way**. Record the traps; most of these documents exist because
something was wrong in a way that was not obvious.

## Before deploying

```bash
for t in render boot import alloc pricing receive receipt-engine dispatch-invoice status numbering; do
  node scripts/uitest/$t-check.js frontend
done
```

All must pass. See [docs/testing.md](./docs/testing.md) — including how to write
a new check, and why it must be made to fail first.

## Rules that have been learned the hard way

- **One definition per question.** When two screens answer "how much does this
  order need" differently, one is wrong. Use the shared helpers in `utils.jsx`.
- **Never hard-code company behaviour.** Read the workflow setting; absent must
  mean "behave as before". See [docs/workflow-profiles.md](./docs/workflow-profiles.md).
- **A failed write must never look like a success.** Sync failures raise a
  banner, not a `console.error`.
- **Documents are stamped, not looked up.** An invoice already sent must not
  change because a mapping was edited afterwards.
- **Show where a number came from.** An auto-filled price or vendor says
  `from VPO/0002`. A guess presented as fact is worse than a blank.
- **Per-organization state on `window` has no RLS.** Clear it when the user or
  organization changes.
- **Document numbers are built in `utils.jsx`**, derived from what exists rather
  than from a count, and handed out one at a time. See
  [docs/document-numbering.md](./docs/document-numbering.md).

## Scope

Strictly this project. Do not touch other Coolify projects or services —
**especially not pesowise** — or any other DNS or tunnel.
