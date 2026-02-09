#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${FABRIC_CFG_PATH:-}" || -z "${ARTIFACTS_DIR:-}" ]]; then
  echo "Missing FABRIC_CFG_PATH or ARTIFACTS_DIR. Source 00-env.local.sh first."
  exit 1
fi

mkdir -p "${ARTIFACTS_DIR}/channel-artifacts"

configtxgen \
  -profile GDCOrdererGenesis \
  -channelID system-channel \
  -outputBlock "${ARTIFACTS_DIR}/channel-artifacts/genesis.block"
