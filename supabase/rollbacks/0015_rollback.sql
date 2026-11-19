-- PressGO: undo 0015 (profile pictures). Run as the database owner, in the Supabase SQL editor.
-- If the new web app is already published, put the OLD web app back first (revert the merge), otherwise people get errors.
-- Order matters: two of the storage policies call pressgo._emp_from_path(), so the policies must go before that function.
-- Pictures people already uploaded are NOT touched here (Supabase does not allow deleting storage rows from SQL):
-- afterwards, in the dashboard, open Storage > avatars, empty the bucket, then delete the bucket.
begin;
drop policy if exists "pressgo avatars read" on storage.objects;
drop policy if exists "pressgo avatars add" on storage.objects;
drop policy if exists "pressgo avatars tidy" on storage.objects;
drop function if exists pressgo.set_avatar(text, text, bigint);
drop function if exists pressgo.remove_avatar();
drop function if exists pressgo._emp_from_path(text);
drop table if exists pressgo.employee_avatars;
commit;
