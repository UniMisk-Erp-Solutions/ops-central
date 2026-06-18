-- OP Central — 010: vendor quote shortlist on a sourcing inquiry. Additive only.
-- quote_vendors: ordered list of vendor ids Purchase added to this inquiry with
-- their own quoted prices (custom vendors are first created as real vendors, so
-- their id is a normal vendor id). When non-empty, the per-item comparison uses
-- ONLY these vendors at the prices captured in `prices`; otherwise it falls back
-- to the estimated comparison across all vendors.
alter table public.sourcings
  add column if not exists quote_vendors jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
