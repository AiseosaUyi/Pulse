-- Password reset OTP flow.
-- One row per reset attempt. State progresses:
--   1. created with otp_hash + expires_at (~10 min)
--   2. on OTP verify success: otp_hash NULL, reset_token set, expires_at extended (~15 min)
--   3. on password reset: used_at set, reset_token NULL

create table if not exists password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  otp_hash text,
  reset_token text unique,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_pwreset_email
  on password_reset_otps (lower(email))
  where used_at is null;

create index if not exists idx_pwreset_token
  on password_reset_otps (reset_token)
  where used_at is null and reset_token is not null;

-- Service-role only; no direct user access.
alter table password_reset_otps enable row level security;
