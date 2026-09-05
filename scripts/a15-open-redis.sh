#!/data/data/com.termux/files/usr/bin/bash
# A15: open Redis to the mesh (run this file in Termux — do not retype the redis-server line)
set -e
redis-cli shutdown >/dev/null 2>&1 || true
redis-server --daemonize yes --port 6379 --bind 0.0.0.0 --protected-mode no
echo PING | redis-cli
echo "A15 Redis open for mesh. Leave Termux running."
