#!/usr/bin/env bash
set -euo pipefail

drop_in_dir=/etc/systemd/system/ollama.service.d
drop_in_file="$drop_in_dir/99-loopback.conf"

command -v systemctl >/dev/null || { echo "systemctl is required" >&2; exit 2; }
command -v ss >/dev/null || { echo "ss is required" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }

sudo -v
sudo install -d -m 0755 "$drop_in_dir"
printf '%s\n' '[Service]' 'Environment="OLLAMA_HOST=127.0.0.1:11434"' \
  | sudo tee "$drop_in_file" >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart ollama

environment=$(systemctl show ollama --property=Environment --value)
case " $environment " in
  *" OLLAMA_HOST=127.0.0.1:11434 "*) ;;
  *) echo "Ollama loopback environment is not effective" >&2; exit 3 ;;
esac

listeners=$(ss -H -ltn 'sport = :11434')
test -n "$listeners" || { echo "Ollama is not listening on port 11434" >&2; exit 4; }
if printf '%s\n' "$listeners" | awk '{print $4}' | grep -vxF '127.0.0.1:11434' >/dev/null; then
  echo "Ollama has a non-loopback listener" >&2
  printf '%s\n' "$listeners" >&2
  exit 5
fi

curl --fail --silent --show-error --max-time 5 \
  http://127.0.0.1:11434/api/tags >/dev/null
printf '%s\n' 'OLLAMA_LOOPBACK_HARDENING_VERIFIED'
