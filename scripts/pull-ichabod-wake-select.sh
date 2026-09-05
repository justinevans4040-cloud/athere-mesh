#!/usr/bin/env bash
# Selective pull FROM Ichabod TO Lenovo — paths listed as args.
# Never use this to copy entire WAKE/forgefront-vault/archive.
# Example:
#   bash scripts/pull-ichabod-wake-select.sh /mnt/storage/WAKE/some/doc.md
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo "usage: $0 <remote-absolute-path> [more paths...]"
  echo "dest: evidence/wake-forgefront-selective/"
  exit 1
fi
DEST="$(cd "$(dirname "$0")/.." && pwd)/evidence/wake-forgefront-selective"
mkdir -p "$DEST"
HOST="${ATHERE_ICHABOD_SSH:-the_founder@100.77.131.28}"
for p in "$@"; do
  base=$(basename "$p")
  scp -o BatchMode=yes -o ConnectTimeout=60 "$HOST:$p" "$DEST/$base"
  echo "pulled $p -> $DEST/$base"
done
