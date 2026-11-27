#!/usr/bin/env bash
# Local test database: a full Pulse database on your own computer with dummy
# data, so changes can be tried without touching the live database.
#
#   pnpm db:local          start it (first run downloads Docker images), apply
#                          every migration, load dummy data, write .env.localdb
#   pnpm db:local reset    wipe it and do all of that again
#   pnpm db:local stop     stop it (data is kept until the next reset)
#   pnpm dev:local         run the app against it (http://localhost:3000)
#
# Needs Docker Desktop running. Never points at the live database: the seed
# refuses any URL that is not localhost.

set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:-start}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

if [ "$cmd" = "stop" ]; then
  supabase stop
  exit 0
fi

if [ "$cmd" = "reset" ]; then
  # Stopping without a backup deletes the local data volume: a clean start.
  echo "Wiping the local database..."
  supabase stop --no-backup >/dev/null 2>&1 || true
fi

# Skip services Pulse does not need locally.
supabase start -x edge-runtime,logflare,vector,imgproxy,studio >/dev/null

# Apply migrations in file order. The CLI's own runner is off (see
# supabase/config.toml) because 076 and 077 are each used by two files.
applied=$(psql "$DB_URL" -tAc "select to_regclass('public.local_migrations') is not null")
if [ "$applied" != "t" ]; then
  psql "$DB_URL" -q -c "create table public.local_migrations (name text primary key, applied_at timestamptz default now())"
fi
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  done_already=$(psql "$DB_URL" -tAc "select 1 from public.local_migrations where name = '$name'")
  [ "$done_already" = "1" ] && continue
  if ! psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>/tmp/pulse-local-migration.err; then
    echo "Migration failed: $name"
    cat /tmp/pulse-local-migration.err
    exit 1
  fi
  psql "$DB_URL" -q -c "insert into public.local_migrations (name) values ('$name')"
  # Later migrations backfill data for the gruve and sippy workspaces, which
  # exist in production; create them as soon as the tenants table does.
  psql "$DB_URL" -q -c "do \$\$ begin if to_regclass('public.tenants') is not null then execute 'insert into public.tenants (slug, name) values (''gruve'', ''Gruve (test)''), (''sippy'', ''Sippy (test)'') on conflict (slug) do nothing'; end if; end \$\$;"
  echo "applied $name"
done

# Point the app at the local database (keys come from the running stack).
supabase status -o env 2>/dev/null | awk -F= '
  $1=="API_URL" {gsub(/"/,"",$2); print "NEXT_PUBLIC_SUPABASE_URL=" $2}
  $1=="ANON_KEY" {gsub(/"/,"",$2); print "NEXT_PUBLIC_SUPABASE_ANON_KEY=" $2}
  $1=="SERVICE_ROLE_KEY" {gsub(/"/,"",$2); print "SUPABASE_SERVICE_ROLE_KEY=" $2}
' > .env.localdb

node --env-file=.env.localdb scripts/seed-local.mjs

echo ""
echo "Local test database is ready. Run: pnpm dev:local"
echo "Log in with test@pulse.local / pulse-local-1"
