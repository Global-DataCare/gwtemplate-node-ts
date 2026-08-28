#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Deterministic local CA bridge
#
# This script copies the repository's disposable deterministic CA fixtures
# into the local Docker devnet.
#
# Important:
# - this is the only supported source for the local deterministic Root/ICA pair
# - the local devnet must not keep old sqlite CA databases across retries
# - stale CA DB state causes identities, affiliations and OUs from older runs to
#   leak into new bootstraps and eventually breaks peer/orderer validation
#
# For that reason the script also removes:
# - `fabric-ca-server.db`
# - generated TLS server certs that must be reissued with the current SAN rules
# -----------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

REPO_ROOT="$(cd "${ROOT}/../../.." && pwd)"
SRC_ROOT_CA="${REPO_ROOT}/fabric-ca-server-root"
SRC_ICA="${REPO_ROOT}/fabric-ca-server-ica"

DST_ROOT_CA="${ROOT}/crypto/ca/root"
DST_ICA="${ROOT}/crypto/ca/ica"

mkdir -p "${DST_ROOT_CA}" "${DST_ICA}"

if [[ ! -f "${SRC_ROOT_CA}/ca-key.pem" || ! -f "${SRC_ROOT_CA}/ca-cert.pem" ]]; then
  echo "Missing source Root CA material in ${SRC_ROOT_CA}"
  echo "Tip: use the dataspace-ca bridge for a fresh disposable local trust chain."
  exit 1
fi

if [[ ! -f "${SRC_ICA}/ca-key.pem" || ! -f "${SRC_ICA}/ca-cert.pem" || ! -f "${SRC_ICA}/ca-chain.pem" ]]; then
  echo "Missing source ICA material in ${SRC_ICA}"
  echo "Tip: use the dataspace-ca bridge for a fresh disposable local trust chain."
  exit 1
fi

cp -f "${SRC_ROOT_CA}/ca-key.pem" "${DST_ROOT_CA}/ca-key.pem"
cp -f "${SRC_ROOT_CA}/ca-cert.pem" "${DST_ROOT_CA}/ca-cert.pem"
rm -f "${DST_ROOT_CA}/tls-cert.pem"
rm -f "${DST_ROOT_CA}/fabric-ca-server.db"

cp -f "${SRC_ICA}/ca-key.pem" "${DST_ICA}/ca-key.pem"
cp -f "${SRC_ICA}/ca-cert.pem" "${DST_ICA}/ca-cert.pem"
cp -f "${SRC_ICA}/ca-chain.pem" "${DST_ICA}/ca-chain.pem"
cat "${DST_ICA}/ca-cert.pem" "${DST_ICA}/ca-chain.pem" > "${DST_ICA}/ca-tls-bundle.pem"
rm -f "${DST_ICA}/tls-cert.pem"
rm -f "${DST_ICA}/fabric-ca-server.db"

echo "Copied deterministic dev CAs into:"
echo "- ${DST_ROOT_CA}"
echo "- ${DST_ICA}"
