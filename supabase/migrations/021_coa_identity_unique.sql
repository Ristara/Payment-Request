-- Two rows with the same (coa, category, subcategory) are indistinguishable
-- everywhere (pickers, reports, anchor resolution) — block them at the DB so
-- concurrent anchor minting in createThread can't race in duplicates.
-- Verified no existing duplicates before adding.
create unique index if not exists uq_coa_identity
  on coa_accounts (coa, category, subcategory);
