#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ORDERER_ADDRESS:-}" || -z "${CORE_PEER_LOCALMSPID:-}" ]]; then
  echo "Missing ORDERER_ADDRESS or CORE_PEER_LOCALMSPID. Source 00-env.local.sh first."
  exit 1
fi

CC_NAME="${CC_NAME:-}"
CC_VERSION="${CC_VERSION:-1.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"
CC_LABEL="${CC_LABEL:-${CC_NAME}_${CC_VERSION}}"
CC_PATH="${CC_PATH:-}"
CC_LANG="${CC_LANG:-golang}"
CHANNEL_NAME="${CHANNEL_NAME:-}"

if [[ -z "${CC_NAME}" || -z "${CC_PATH}" || -z "${CHANNEL_NAME}" ]]; then
  echo "Missing CC_NAME, CC_PATH, or CHANNEL_NAME."
  exit 1
fi

peer lifecycle chaincode package "${CC_LABEL}.tgz" --path "${CC_PATH}" --lang "${CC_LANG}" --label "${CC_LABEL}"
peer lifecycle chaincode install "${CC_LABEL}.tgz"

PACKAGE_ID="$(peer lifecycle chaincode queryinstalled | grep "${CC_LABEL}" | awk -F 'Package ID: ' '{print $2}' | awk -F ',' '{print $1}')"
if [[ -z "${PACKAGE_ID}" ]]; then
  echo "Failed to resolve package ID for ${CC_LABEL}"
  exit 1
fi

peer lifecycle chaincode approveformyorg \
  -o "${ORDERER_ADDRESS}" \
  --tls --cafile "${ORDERER_TLS_CA}" \
  --channelID "${CHANNEL_NAME}" \
  --name "${CC_NAME}" \
  --version "${CC_VERSION}" \
  --package-id "${PACKAGE_ID}" \
  --sequence "${CC_SEQUENCE}"

peer lifecycle chaincode commit \
  -o "${ORDERER_ADDRESS}" \
  --tls --cafile "${ORDERER_TLS_CA}" \
  --channelID "${CHANNEL_NAME}" \
  --name "${CC_NAME}" \
  --version "${CC_VERSION}" \
  --sequence "${CC_SEQUENCE}"
