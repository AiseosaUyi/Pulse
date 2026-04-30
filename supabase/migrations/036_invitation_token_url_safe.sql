-- 036: switch invitation tokens to URL-safe base64url so they survive being
-- placed in URL path segments without %-encoding. Standard base64 emits `+`
-- and `/` which require percent-encoding; some routing layers don't decode
-- those reliably in dynamic path segments, so the `/invite/<token>` page
-- could 404 with "Invitation not found" even though the row existed.
--
-- New tokens use translate(...) to map +/  -> -_ and strip = padding.
-- Existing pending invites are left untouched; the page handles both forms
-- defensively. Already-accepted invites are unaffected.

alter table invitations
  alter column token set default translate(
    encode(gen_random_bytes(24), 'base64'),
    '+/=',
    '-_'
  );
