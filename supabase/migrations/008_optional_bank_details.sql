-- ============================================================================
-- Bank details become optional at vendor-creation time. Vendors can be added
-- with just name / GSTIN / PAN and the bank fields filled in later (typically
-- when Accounts sits down to verify + approve the vendor). Payment processing
-- is what actually needs bank details, and that's enforced at request time.
-- ============================================================================

alter table vendors alter column bank_account_number drop not null;
alter table vendors alter column bank_ifsc drop not null;

-- PAN stays required — nearly every registered entity/individual has one, and
-- it's the reliable identifier when GSTIN is missing.
