-- The procurement role, alone in its own migration.
--
-- ALTER TYPE ... ADD VALUE cannot be USED in the transaction that adds it, and
-- scripts/run-sql.mjs sends each file as a single implicit transaction. Put
-- this alongside the policies that reference 'procurement' and the whole file
-- fails on "unsafe use of new value of enum type".
alter type user_role add value if not exists 'procurement';
