-- Drop the supply-composition and cost-centre fields — no longer collected
-- on the Raise form. payment_requests is empty today so this is safe.

alter table payment_requests
  drop constraint if exists check_mix_percentages;

alter table payment_requests
  drop column if exists supply_composition,
  drop column if exists material_percentage,
  drop column if exists service_percentage,
  drop column if exists cost_centre;

drop type if exists supply_composition;
