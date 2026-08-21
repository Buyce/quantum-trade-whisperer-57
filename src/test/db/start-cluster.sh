#!/usr/bin/env bash
# Boots a throwaway PostgreSQL cluster for the database regression suite and
# prints `PGHOST=<socketdir> PGPORT=<port>` on success.
#
# Nothing here touches the production Lovable Cloud database: the cluster lives
# under a temp dir, listens on a unix socket only (`listen_addresses=''`), and is
# torn down by `stop-cluster.sh`.
set -euo pipefail

DIR="${PTRADES_PG_DIR:-/tmp/ptrades-testpg}"
PORT="${PTRADES_PG_PORT:-55432}"

command -v initdb >/dev/null 2>&1 || { echo "initdb not found" >&2; exit 3; }

# Vitest runs each database test FILE in its own worker, so two workers can enter
# this script at the same moment. Without a lock the second one would `rm -rf` the
# data directory the first is still initialising.
#
# A `flock` fd is NOT usable here: the postgres daemon we start inherits it and
# would hold the lock for its whole lifetime. Use a mkdir spinlock instead, and
# always release it on exit.
LOCK="${DIR}.lock"
for _ in $(seq 1 600); do
  if mkdir "$LOCK" 2>/dev/null; then
    trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
    break
  fi
  if [ -S "$DIR/.s.PGSQL.$PORT" ]; then
    echo "PGHOST=$DIR PGPORT=$PORT"
    exit 0
  fi
  sleep 0.5
done

if [ -S "$DIR/.s.PGSQL.$PORT" ]; then
  echo "PGHOST=$DIR PGPORT=$PORT"
  exit 0
fi



rm -rf "$DIR"
mkdir -p "$DIR"
chmod 777 "$DIR"

boot() {
  initdb -D "$DIR/pg" -U postgres --auth=trust >"$DIR/initdb.log" 2>&1
  pg_ctl -D "$DIR/pg" \
    -o "-p $PORT -k $DIR -c listen_addresses= -c fsync=off -c full_page_writes=off" \
    -l "$DIR/pg.log" start >>"$DIR/initdb.log" 2>&1
}

if [ "$(id -u)" = "0" ]; then
  # initdb refuses to run as root; a user namespace maps us to an unprivileged
  # uid without needing useradd/su (absent in this image).
  command -v unshare >/dev/null 2>&1 || { echo "running as root and unshare is unavailable" >&2; exit 4; }
  export DIR PORT
  unshare -U --map-user=1000 --map-group=1000 bash -c "$(declare -f boot); boot"
else
  boot
fi

for _ in $(seq 1 30); do
  if [ -S "$DIR/.s.PGSQL.$PORT" ]; then
    echo "PGHOST=$DIR PGPORT=$PORT"
    exit 0
  fi
  sleep 0.5
done

echo "cluster did not come up; see $DIR/pg.log" >&2
exit 5
