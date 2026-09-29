#!/usr/bin/env bash
# Store the Papermark machine key for the IR Agent without echoing it, without
# putting it on a command line (visible in `ps`) and without shell history.
# Usage: integrations/ir-agent/store-token.sh [target]   (run in an interactive terminal)
set -euo pipefail
umask 077

target="${1:-$HOME/.config/jett-ir-agent/papermark.token}"
dir="$(dirname "$target")"

[[ -t 0 ]] || { echo "must be run from an interactive terminal" >&2; exit 1; }
mkdir -p -m 700 "$dir"
chmod 700 "$dir"

IFS= read -rs -p "Papermark IR Agent key (input hidden): " key
echo
[[ -n "$key" ]] || { echo "empty key, nothing written" >&2; exit 1; }
[[ "$key" != *[[:space:]]* ]] || { echo "key contains whitespace, nothing written" >&2; exit 1; }

tmp="$(mktemp "$dir/.papermark.token.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
printf '%s' "$key" > "$tmp"
unset key
chmod 600 "$tmp"
mv -f "$tmp" "$target"
trap - EXIT

echo "stored: $target ($(stat -c '%a' "$target"), $(wc -c < "$target") bytes)"
