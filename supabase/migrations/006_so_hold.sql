-- OP Central — 006: SO on-hold fields (Op 6/7 of the Virtual Godown spec).
-- Additive only. on_hold is a flag layered on top of the workflow status:
-- a held SO keeps its status + VG, pauses advancement, and stays eligible to lend.
-- (hold_reason already exists from migration 002.)

alter table public.sales_orders
  add column if not exists on_hold       boolean not null default false,
  add column if not exists hold_notes    text,
  add column if not exists on_hold_since timestamptz;
