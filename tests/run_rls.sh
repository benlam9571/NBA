#!/usr/bin/env bash
# Only starts an isolated disposable PostgreSQL container; never connects to a project database.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
container="nba-rls-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')"
created=0
cleanup() {
  if [ "$created" = 1 ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
docker run --rm -d --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
created=1
ready=0
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then echo 'Isolated PostgreSQL did not become ready' >&2; exit 1; fi
docker cp "$root/supabase/migrations/202611100001_private_snapshots.sql" "$container:/tmp/nba-migration.sql" >/dev/null
docker cp "$root/tests/rls.sql" "$container:/tmp/nba-rls.sql" >/dev/null
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/nba-rls.sql
