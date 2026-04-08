#!/bin/sh
set -eu

IDENTITY_B64="${OPENCLAW_GATEWAY_DEVICE_IDENTITY_B64:-}"
IDENTITY_PATH="${OPENCLAW_GATEWAY_DEVICE_IDENTITY_PATH:-$HOME/.openclaw/identity/device.json}"

if [ -n "$IDENTITY_B64" ]; then
  IDENTITY_DIR=$(dirname "$IDENTITY_PATH")
  mkdir -p "$IDENTITY_DIR"
  printf '%s' "$IDENTITY_B64" | base64 -d > "$IDENTITY_PATH"
  chmod 600 "$IDENTITY_PATH" || true
fi

exec "$@"
