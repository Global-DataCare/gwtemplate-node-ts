#!/bin/sh
set -eu

: "${CHAINCODE_ID:?CHAINCODE_ID is required}"
: "${CHAINCODE_SERVER_ADDRESS:=0.0.0.0:9999}"

exec ./node_modules/.bin/fabric-chaincode-node server \
  --chaincode-address="$CHAINCODE_SERVER_ADDRESS" \
  --chaincode-id="$CHAINCODE_ID"
