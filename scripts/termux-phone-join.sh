#!/data/data/com.termux/files/usr/bin/bash
# Termux join helper — run ON the phone after `pkg install redis`.
# Publishes a phone-scoped ping key to Lenovo mesh Redis when env is set,
# otherwise starts a local Redis on 6379 for Lenovo to probe.
set -euo pipefail

PHONE_ID="${ATHERE_PHONE_ID:-$(getprop ro.product.model 2>/dev/null || echo termux)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -n "${ATHERE_MESH_REDIS_HOST:-}" ]]; then
  echo "Mesh Redis host set — install redis-cli and SET athere:phone:${PHONE_ID}:last-seen"
  redis-cli -h "$ATHERE_MESH_REDIS_HOST" -p "${ATHERE_MESH_REDIS_PORT:-6380}" \
    ${ATHERE_MESH_REDIS_PASSWORD:+-a "$ATHERE_MESH_REDIS_PASSWORD"} \
    SET "athere:phone:${PHONE_ID}:last-seen" "$STAMP" EX 3600
  echo "published athere:phone:${PHONE_ID}:last-seen=$STAMP"
  exit 0
fi

echo "No ATHERE_MESH_REDIS_HOST — starting local redis-server on 6379"
mkdir -p "$HOME/.athere-mesh"
redis-server --daemonize yes --port 6379 --bind 0.0.0.0 --dir "$HOME/.athere-mesh" \
  --pidfile "$HOME/.athere-mesh/redis.pid" --logfile "$HOME/.athere-mesh/redis.log"
echo "local redis up; from Lenovo: node scripts/smoke-phone-tailscale.js"
