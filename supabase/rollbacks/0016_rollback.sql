-- PressGO: undo 0016 (personal look). Run as the database owner, in the Supabase SQL editor.
-- If the new web app is already published, put the OLD web app back first (revert the merge), otherwise people get errors.
-- Everybody's saved appearance / accent colour is deleted with the table (they simply return to the defaults).
begin;
drop function if exists pressgo.set_preferences(text, text);
drop table if exists pressgo.employee_preferences;
commit;
