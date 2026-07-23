-- Outlets get a lifecycle stage: an "upcoming" store still being built vs
-- an "operational" one already trading. The Raise form asks the submitter
-- which kind of payment this is (New Store Opening / Existing Outlet) and
-- filters the outlet dropdown accordingly.

do $$ begin
  create type outlet_stage as enum ('upcoming', 'operational');
exception when duplicate_object then null; end $$;

alter table outlets
  add column if not exists stage outlet_stage not null default 'operational';
