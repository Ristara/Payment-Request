-- Cut the picker down to the four the business actually uses right now:
-- professional fees, rent, commission and contract.
--
-- Turned OFF, not deleted. The rates and the notes on the others were
-- researched and verified; deleting them means someone retypes all of that
-- from memory in six months, which is how a wrong rate gets in. Off keeps
-- them out of the Accounts dropdown and one click away on the admin page.
--
-- Contract stays as TWO rows. It is one section, but the rate depends on what
-- the vendor is — 1% for a proprietor or HUF, 2% for a company or firm — so a
-- single "contract" row would be wrong for half the vendor base whichever
-- number it carried. The fork has to be visible at the moment of choosing.

update public.tds_sections
   set is_active = false,
       updated_at = now()
 where code not in (
   '194J(b)',            -- professional fees
   '194I(b)',            -- rent of premises
   '194H',               -- commission or brokerage
   '194C (proprietor)',  -- contract, individual/HUF vendor
   '194C (company/firm)' -- contract, company/firm vendor
 );
