-- The per-section note for Accounts is not wanted, so the column goes rather
-- than sitting there holding text nothing renders.
--
-- Nothing important is lost with it: the one thing that note really carried
-- was the 1% vs 2% contractor fork, and that is already spelled out in the
-- section names themselves ("individual, HUF or proprietor" against
-- "company, firm, LLP or trust").
alter table public.tds_sections drop column if exists guidance;
