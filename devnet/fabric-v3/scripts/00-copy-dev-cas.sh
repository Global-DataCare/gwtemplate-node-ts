#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SRC_ROOT_CA="${ROOT}/../../artifacts/fabric-ca-server-root"
SRC_ICA="${ROOT}/../../artifacts/fabric-ca-server-ica"

DST_ROOT_CA="${ROOT}/crypto/ca/root"
DST_ICA="${ROOT}/crypto/ca/ica"

mkdir -p "${DST_ROOT_CA}" "${DST_ICA}"

if [[ ! -f "${SRC_ROOT_CA}/ca-key.pem" || ! -f "${SRC_ROOT_CA}/ca-cert.pem" ]]; then
  echo "Missing source Root CA material in ${SRC_ROOT_CA}"
  echo "Tip: run gwtemplate-node-ts/src/__tests__/setup/seedDevCAs.test.ts to generate it."
  exit 1
fi

if [[ ! -f "${SRC_ICA}/ca-key.pem" || ! -f "${SRC_ICA}/ca-cert.pem" || ! -f "${SRC_ICA}/ca-chain.pem" ]]; then
  echo "Missing source ICA material in ${SRC_ICA}"
  echo "Tip: run gwtemplate-node-ts/src/__tests__/setup/seedDevCAs.test.ts to generate it."
  exit 1
fi

cp -f "${SRC_ROOT_CA}/ca-key.pem" "${DST_ROOT_CA}/ca-key.pem"
cp -f "${SRC_ROOT_CA}/ca-cert.pem" "${DST_ROOT_CA}/ca-cert.pem"

cp -f "${SRC_ICA}/ca-key.pem" "${DST_ICA}/ca-key.pem"
cp -f "${SRC_ICA}/ca-cert.pem" "${DST_ICA}/ca-cert.pem"
cp -f "${SRC_ICA}/ca-chain.pem" "${DST_ICA}/ca-chain.pem"

echo "Copied deterministic dev CAs into:"
echo "- ${DST_ROOT_CA}"
echo "- ${DST_ICA}"

