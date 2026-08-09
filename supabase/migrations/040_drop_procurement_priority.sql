-- Priority was mine, not asked for, and removed on request.
--
-- Dropped rather than hidden. A column with a NOT NULL default that nothing
-- writes and nothing reads still shows up in every schema dump and every
-- generated type, and the next person has to work out whether it matters.
alter table public.procurement_requests drop column if exists priority;
