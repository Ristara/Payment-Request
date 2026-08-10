-- The real FY 2026-27 list, replacing the seven placeholder rows.
--
-- Researched rather than recalled: 4 independent web sweeps plus 22
-- adversarial per-section verifications. Two findings that memory would have
-- got wrong:
--
-- 1. The Income-tax Act 2025 repealed the 1961 Act on 1 April 2026. The whole
--    194-series is now consolidated into s.392 (salary), s.393 (all other TDS)
--    and s.394 (TCS). "194C" is no longer a statutory section — it is the
--    informal name for a row of the s.393(1) Table. Quarterly returns for
--    FY 2026-27 want the new citation and 4-digit payment codes.
--
--    So both are stored. `code` stays the familiar 194-series label, because
--    that is what Accounts, the CA and every rate chart still say and what
--    people will search the dropdown for. `statutory_ref` carries the citation
--    the return actually needs.
--
-- 2. Contractor TDS is 1% or 2% depending on what the VENDOR is, not what the
--    expense is — 1% for a proprietor or HUF, 2% for a company, firm or LLP.
--    Verification was explicit that it "must not be seeded as a scalar": one
--    number would over-deduct by double on most small Bengaluru vendors or
--    under-deduct on the big fit-out contractors. It is two pickable rows
--    instead, which puts the fork in front of whoever is choosing.
--
-- Deliberately NOT seeded: the no-PAN override. It is 20% in general but 5%
-- where the payment is for goods or e-commerce — which is this company's most
-- common payment type — so a flat 20% row would quietly over-deduct. It is a
-- condition on the vendor, not a section to pick.

alter table public.tds_sections
  add column if not exists statutory_ref text,
  add column if not exists guidance text;

-- Only clears rows nobody has deducted under. If a section has been used it
-- stays, whatever this migration would rather do.
delete from public.tds_sections t
 where not exists (
   select 1 from public.request_installments i where i.tds_section_id = t.id
 );

insert into public.tds_sections (code, name, rate, statutory_ref, guidance) values
  ('194C (proprietor)', 'Contractors — individual, HUF or proprietor', 1,
   's.393(1) Table Sl. No. 6(i)',
   'For a proprietor, individual or HUF contractor — the 4th letter of their PAN is P or H. Civil work, fit-out, repairs, AMC labour, transport, housekeeping and manpower supply. Due once one bill crosses ₹30,000 or the year''s total for that vendor crosses ₹1,00,000.'),

  ('194C (company/firm)', 'Contractors — company, firm, LLP or trust', 2,
   's.393(1) Table Sl. No. 6(i)',
   'Same work as above but the contractor is a company, partnership, LLP, AOP or trust — 4th letter of PAN is C, F, A or T. Same ₹30,000 single-bill / ₹1,00,000 annual test.'),

  ('194J(b)', 'Professional fees — CA, architect, lawyer, consultant', 10,
   's.393(1) Table Sl. No. 6(iii)',
   '₹50,000 a year per vendor (raised from ₹30,000 in April 2025). On a fit-out, split the bills: the architect''s design fee is 10% here, the contractor''s work bill is 194C.'),

  ('194J(a)', 'Technical service fees — not a profession', 2,
   's.393(1) Table Sl. No. 6(iii)',
   'Technical services that are not professional services, and call-centre work. Same ₹50,000 limit. If you are unsure between this and 194J(b), pick 194J(b) at 10% — over-deducting is refundable to the vendor, under-deducting costs interest and penalty.'),

  ('194I(b)', 'Rent — outlet premises, land or building', 10,
   's.393(1) Table Sl. No. 2(ii)(b)',
   '10% whoever the landlord is, individual or company — the rate follows the asset, not the payee. Due once rent crosses ₹50,000 for any single month; the old ₹2,40,000-a-year test was dropped in April 2025. Maintenance billed separately is usually 194C, not rent.'),

  ('194I(a)', 'Rent — equipment, plant or machinery', 2,
   's.393(1) Table Sl. No. 2(ii)(a)',
   'Chillers, DG sets, cold rooms, kitchen equipment on hire. Same ₹50,000-for-any-one-month test as premises rent.'),

  ('194H', 'Commission or brokerage', 2,
   's.393(1) Table Sl. No. 1(ii)',
   'Property brokerage on a new outlet, agent and booking commission. ₹20,000 a year. If you remember 5%, that was cut to 2% in October 2024. Not for professional fees, and not for what Swiggy or Zomato charge you.'),

  ('194Q', 'Purchase of goods over ₹50 lakh from one seller', 0.1,
   's.393(1) Table Sl. No. 8(ii)',
   'Only after you have paid a single seller more than ₹50 lakh in the year, and only on the amount above ₹50 lakh.'),

  ('194A', 'Interest on a loan from someone other than a bank', 10,
   's.393(1) Table Sl. No. 5(iii)',
   'Interest paid to a non-bank lender. ₹5,000 a year. Bank interest is not deducted by you.'),

  ('194R', 'Gifts, free goods or incentives given to a vendor', 10,
   's.393(1) Table Sl. No. 8(iv)',
   'Benefits given in kind rather than cash — free stock, sponsored trips, incentives to a distributor or vendor. ₹20,000 a year.'),

  ('194J (director)', 'Director sitting fees not paid through payroll', 10,
   's.393(1) Table Sl. No. 6(iii)(c)',
   'Sitting fees, commission or any director payment not run as salary. No threshold — deduct from the first rupee.'),

  ('194-IA', 'Buying property or land for a new outlet', 1,
   's.393(1) Table Sl. No. 3(i)',
   'Purchase of immovable property of ₹50 lakh or more. Deduct on the whole consideration, not just the part above ₹50 lakh.');
