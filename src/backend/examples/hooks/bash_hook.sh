#!/usr/bin/env bash
set -euo pipefail

EVENT_NAME="${TRANSMAGENT_HOOK_EVENT:-unknown}"
PAYLOAD_JSON="${TRANSMAGENT_HOOK_PAYLOAD:-{}}"
OUTPUT_DIR="${TRANSMAGENT_HOOK_OUTPUT_DIR:-./hook_logs}"

mkdir -p "$OUTPUT_DIR"
LOG_FILE="$OUTPUT_DIR/${EVENT_NAME}.log"

{
  printf '=== %s ===\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'event=%s\n' "$EVENT_NAME"
  printf 'payload=%s\n' "$PAYLOAD_JSON"
} >> "$LOG_FILE"

echo "hook captured: $EVENT_NAME -> $LOG_FILE"
