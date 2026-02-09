#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${FABRIC_CFG_PATH:-}" || -z "${ORDERER_ADDRESS:-}" || -z "${CORE_PEER_LOCALMSPID:-}" || -z "${CHANNELS_MAP:-}" ]]; then
  echo "Missing FABRIC_CFG_PATH, ORDERER_ADDRESS, CORE_PEER_LOCALMSPID, or CHANNELS_MAP. Source 00-env.local.sh first."
  exit 1
fi

CHANNEL_NAME="${1:-}"
if [[ -z "${CHANNEL_NAME}" ]]; then
  echo "Usage: 22-set-anchor-peers.sh <channel-name>"
  exit 1
fi

CHANNEL_PROFILE="$(grep -E "^${CHANNEL_NAME}=" "${CHANNELS_MAP}" | head -n1 | cut -d '=' -f2)"
if [[ -z "${CHANNEL_PROFILE}" ]]; then
  echo "Could not resolve channel profile for ${CHANNEL_NAME} from ${CHANNELS_MAP}"
  exit 1
fi

configtxgen \
  -profile "${CHANNEL_PROFILE}" \
  -outputAnchorPeersUpdate "/tmp/${CORE_PEER_LOCALMSPID}-${CHANNEL_NAME}-anchors.tx" \
  -channelID "${CHANNEL_NAME}" \
  -asOrg "${CORE_PEER_LOCALMSPID}"

peer channel update \
  -o "${ORDERER_ADDRESS}" \
  -c "${CHANNEL_NAME}" \
  -f "/tmp/${CORE_PEER_LOCALMSPID}-${CHANNEL_NAME}-anchors.tx" \
  --tls \
  --cafile "${ORDERER_TLS_CA}"
