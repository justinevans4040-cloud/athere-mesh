#!/usr/bin/env bash
# Stage athere-mesh sources on Ichabod for the standing remote-executor worker.
# Invoked over SSH after files are uploaded under /tmp/athere-mesh-stage.
set -eu
STAGE_SRC="${1:-/tmp/athere-mesh-stage}"
DEST="${HOME}/athere-mesh"
mkdir -p "$DEST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude workspace \
    --exclude evidence \
    "$STAGE_SRC/" "$DEST/"
else
  find "$DEST" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
  cp -a "$STAGE_SRC"/. "$DEST/"
fi
if [[ ! -f "$DEST/package.json" ]]; then
  printf '%s\n' '{"name":"athere-mesh","private":true,"type":"module"}' > "$DEST/package.json"
fi
mkdir -p "$HOME/.config/athere-mesh-worker"
if [[ ! -f "$HOME/.config/athere-mesh-worker/worker.env" ]]; then
  install -m 600 "$DEST/deploy/systemd/athere-mesh-remote-executor.env.example" \
    "$HOME/.config/athere-mesh-worker/worker.env" 2>/dev/null || true
  if [[ ! -f "$HOME/.config/athere-mesh-worker/worker.env" ]]; then
    cat > "$HOME/.config/athere-mesh-worker/worker.env" <<'EOF'
ATHERE_MESH_REDIS_HOST=127.0.0.1
ATHERE_MESH_REDIS_PORT=6380
ATHERE_MESH_REDIS_PASSWORD_FILE=/home/the_founder/.config/athere-mesh-redis/mesh-redis.pass
ATHERE_MESH_REDIS_SEED_ID=8a1e2c26-0769-405e-9a8f-85b4c2c9f1f1@ichabodcrane
ATHERE_MESH_WORK_NAMESPACE=athere:mesh:work
ATHERE_MESH_WORKER_ID=worker-ichabodcrane
ATHERE_MESH_WORKER_CLAIM_MS=5000
EOF
    chmod 600 "$HOME/.config/athere-mesh-worker/worker.env"
  fi
fi
UNIT_SRC="${2:-$DEST/deploy/systemd/athere-mesh-remote-executor.service}"
install -m 644 "$UNIT_SRC" \
  "$HOME/.config/systemd/user/athere-mesh-remote-executor.service"
systemctl --user daemon-reload
systemctl --user enable athere-mesh-remote-executor.service
systemctl --user restart athere-mesh-remote-executor.service
sleep 2
echo "ACTIVE=$(systemctl --user is-active athere-mesh-remote-executor.service)"
systemctl --user show athere-mesh-remote-executor.service -p ActiveState -p SubState -p MainPID -p NRestarts -p FragmentPath
journalctl --user -u athere-mesh-remote-executor.service -n 20 --no-pager || true
echo "staged=$DEST"
