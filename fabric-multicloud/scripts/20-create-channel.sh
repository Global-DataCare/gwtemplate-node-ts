#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ARTIFACTS_DIR:-}" || -z "${ORDERER_ADDRESS:-}" ]]; then
  echo "Missing ARTIFACTS_DIR or ORDERER_ADDRESS. Source 00-env.local.sh first."
  exit 1
fi

CHANNEL_NAME="${1:-}"
if [[ -z "${CHANNEL_NAME}" ]]; then
  echo "Usage: 20-create-channel.sh <channel-name>"
  exit 1
fi

CHANNEL_BLOCK="${ARTIFACTS_DIR}/channel-artifacts/${CHANNEL_NAME}.block"
if [[ ! -f "${CHANNEL_BLOCK}" ]]; then
  echo "Missing channel block: ${CHANNEL_BLOCK}"
  exit 1
fi

osnadmin channel join \
  --channelID "${CHANNEL_NAME}" \
  --config-block "${CHANNEL_BLOCK}" \
  --orderer-address "${ORDERER_ADDRESS}" \
  --ca-file "${ORDERER_TLS_CA}" \
  --client-cert "${ORDERER_ADMIN_TLS_CERT}" \
  --client-key "${ORDERER_ADMIN_TLS_KEY}"
