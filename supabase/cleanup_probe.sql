-- Remove ONLY the throwaway auth probe user created during the GoTrue check.
-- (auth.identities cascades on auth.users delete.) No app data is touched.
delete from auth.users where email = 'probe-del@example.com';
