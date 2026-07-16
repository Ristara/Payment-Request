-- ============================================================================
-- Some vendors aren't GST-registered (small suppliers, individuals with only
-- a PAN, etc.). Make GSTIN nullable. The existing `unique (gstin)` constraint
-- still holds — Postgres treats NULLs as distinct by default, so we can have
-- many unregistered vendors without collision.
-- ============================================================================

alter table vendors alter column gstin drop not null;
