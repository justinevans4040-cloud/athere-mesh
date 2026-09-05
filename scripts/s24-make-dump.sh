#!/data/data/com.termux/files/usr/bin/bash
set -e
DUMPDIR="$HOME/s24-mesh-dump"
rm -rf "$DUMPDIR"
mkdir -p "$DUMPDIR/athere-docs"
redis-cli CONFIG SET protected-mode no >/dev/null 2>&1 || true
redis-cli BGSAVE >/dev/null 2>&1 || true
sleep 1
redis-cli DBSIZE > "$DUMPDIR/redis-dbsize.txt" 2>&1 || true
redis-cli INFO keyspace > "$DUMPDIR/redis-keyspace.txt" 2>&1 || true
redis-cli --scan > "$DUMPDIR/redis-keys.txt" 2>/dev/null || true
cp -f "$HOME/dump.rdb" "$DUMPDIR/home-dump.rdb" 2>/dev/null || true
cp -f $HOME/.athere-mesh/* "$DUMPDIR/" 2>/dev/null || true
tar -czf "$DUMPDIR/termux-home.tgz" --exclude=.ollama/models --exclude=.cache --exclude=s24-mesh-dump -C "$HOME" .athere-mesh .ssh .bashrc .bash_history .config AGENT_VISIBLE_PROOF.txt SolarCommand_V3_LIVE.html agent bin downloads dump.rdb ignite odin-worker-s24 odin-worker.log redis-s24.log start-odin-worker.sh storage termux-phone-join.sh wake-offload .odin-lineforge-nfl 2>"$DUMPDIR/tar-stderr.txt" || true
ls -la /storage/emulated/0/Download > "$DUMPDIR/downloads-ls.txt" 2>&1 || true
find /storage/emulated/0/Download -type f -printf '%s\t%p\n' 2>/dev/null | sort -nr > "$DUMPDIR/downloads-inventory.txt" || true
find /storage/emulated/0/Download -maxdepth 1 -type f \( -iname '*athere*' -o -iname '*titan*' -o -iname '*mesh*' \) -size -20M -exec cp -f {} "$DUMPDIR/athere-docs/" \; 2>/dev/null || true
ls -la "$DUMPDIR"
du -sh "$DUMPDIR"/*
echo DUMP_OK