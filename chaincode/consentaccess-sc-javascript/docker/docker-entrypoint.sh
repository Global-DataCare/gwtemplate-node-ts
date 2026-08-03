#!/usr/bin/env bash
#
# SPDX-License-Identifier: Apache-2.0
#
set -euo pipefail
: ${CORE_PEER_TLS_ENABLED:="false"}
: ${DEBUG:="false"}

chaincode_node="./node_modules/.bin/fabric-chaincode-node"

if [ "${DEBUG,,}" = "true" ]; then
  export NODE_OPTIONS="--inspect=0.0.0.0:9229"
fi

if [[ ! -v CHAINCODE_SERVER_ADDRESS ]]; then
  exec "${chaincode_node}" start --peer.address "${CORE_PEER_ADDRESS}"
elif [ "${CORE_PEER_TLS_ENABLED,,}" = "true" ]; then
  exec "${chaincode_node}" server \
    --chaincode-address="${CHAINCODE_SERVER_ADDRESS}" \
    --chaincode-id="${CHAINCODE_ID}" \
    --chaincode-tls-key-file=/hyperledger/privatekey.pem \
    --chaincode-tls-client-cacert-file=/hyperledger/rootcert.pem \
    --chaincode-tls-cert-file=/hyperledger/cert.pem
else
  exec "${chaincode_node}" server \
    --chaincode-address="${CHAINCODE_SERVER_ADDRESS}" \
    --chaincode-id="${CHAINCODE_ID}"
fi
