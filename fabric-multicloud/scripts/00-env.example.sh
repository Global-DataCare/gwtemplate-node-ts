#!/usr/bin/env bash
set -euo pipefail

# Copy to 00-env.local.sh and adjust for each environment/cluster.

export FABRIC_CFG_PATH="$(pwd)/fabric-multicloud/configtx"
export ARTIFACTS_DIR="$(pwd)/artifacts/test"
export CHANNELS_MAP="$(pwd)/fabric-multicloud/channels.map"

# Orderer (UNID)
export ORDERER_ADDRESS="orderer.unid.example:7050"
export ORDERER_TLS_CA="${ARTIFACTS_DIR}/pki-host/UNIDMSP/orderer/tls/ca.crt"
export ORDERER_ADMIN_TLS_CERT="${ARTIFACTS_DIR}/pki-host/UNIDMSP/orderer/tls/client.crt"
export ORDERER_ADMIN_TLS_KEY="${ARTIFACTS_DIR}/pki-host/UNIDMSP/orderer/tls/client.key"

# Org MSP (example: UNID)
export CORE_PEER_LOCALMSPID="UNIDMSP"
export CORE_PEER_ADDRESS="peer0.unid.example:7051"
export CORE_PEER_MSPCONFIGPATH="${ARTIFACTS_DIR}/pki-host/UNIDMSP/admin/msp"
export CORE_PEER_TLS_ROOTCERT_FILE="${ARTIFACTS_DIR}/pki-host/UNIDMSP/peer0/tls/ca.crt"
