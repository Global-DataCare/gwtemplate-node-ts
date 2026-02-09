#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ORDERER_ADDRESS:-}" || -z "${ARTIFACTS_DIR:-}" ]]; then
  echo "Missing ORDERER_ADDRESS or ARTIFACTS_DIR. Source 00-env.local.sh first."
  exit 1
fi

CHANNEL_NAME="${1:-}"
if [[ -z "${CHANNEL_NAME}" ]]; then
  echo "Usage: 21-join-channel.sh <channel-name>"
  exit 1
fi

peer channel fetch 0 "${ARTIFACTS_DIR}/channel-artifacts/${CHANNEL_NAME}.block" \
  -o "${ORDERER_ADDRESS}" \
  -c "${CHANNEL_NAME}" \
  --tls \
  --cafile "${ORDERER_TLS_CA}"

peer channel join -b "${ARTIFACTS_DIR}/channel-artifacts/${CHANNEL_NAME}.block"
