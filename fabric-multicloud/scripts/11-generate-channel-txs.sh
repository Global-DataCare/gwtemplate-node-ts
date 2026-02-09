#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${FABRIC_CFG_PATH:-}" || -z "${ARTIFACTS_DIR:-}" || -z "${CHANNELS_MAP:-}" ]]; then
  echo "Missing FABRIC_CFG_PATH, ARTIFACTS_DIR, or CHANNELS_MAP. Source 00-env.local.sh first."
  exit 1
fi

mkdir -p "${ARTIFACTS_DIR}/channel-artifacts"

while IFS='=' read -r channel profile; do
  [[ -z "${channel}" || "${channel}" =~ ^# ]] && continue
  configtxgen \
    -profile "${profile}" \
    -outputCreateChannelTx "${ARTIFACTS_DIR}/channel-artifacts/${channel}.tx" \
    -channelID "${channel}"

  configtxgen \
    -profile "${profile}" \
    -outputBlock "${ARTIFACTS_DIR}/channel-artifacts/${channel}.block" \
    -channelID "${channel}"
done < "${CHANNELS_MAP}"
