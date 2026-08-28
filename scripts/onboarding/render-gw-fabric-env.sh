#!/usr/bin/env bash
set -euo pipefail

for variable in HOST_CLIENT_MSP_DIR HOST_MSP_ID HOST_PEER_ENDPOINT HOST_PEER_TLS_CA GW_FABRIC_ENV_OUTPUT; do
  [[ -n "${!variable:-}" ]] || { echo "Missing ${variable}" >&2; exit 1; }
done
[[ "${HOST_PEER_ENDPOINT}" == *:* ]] || { echo 'HOST_PEER_ENDPOINT must include host and port' >&2; exit 1; }
cert="${HOST_CLIENT_MSP_DIR}/signcerts/cert.pem"
key="$(find "${HOST_CLIENT_MSP_DIR}/keystore" -maxdepth 1 -type f -print -quit)"
[[ -s "${cert}" && -s "${key}" && -s "${HOST_PEER_TLS_CA}" ]] || {
  echo 'Missing GW client certificate, private key or peer TLS CA' >&2
  exit 1
}
one_line_pem() { perl -0pe 's/\n/\\n/g' "$1"; }
umask 077
cat > "${GW_FABRIC_ENV_OUTPUT}" <<EOF
LEDGER_MSP_ID=${HOST_MSP_ID}
LEDGER_FABRIC_MSP_ID=${HOST_MSP_ID}
HLF_MSP_ID_HOST1=${HOST_MSP_ID}
HLF_CONNECTION_PEER=${HOST_PEER_ENDPOINT}
HLF_CONNECTION_PEM=$(one_line_pem "${HOST_PEER_TLS_CA}")
HLF_CERTIFICATE=$(one_line_pem "${cert}")
HLF_PRIVATE_KEY=$(one_line_pem "${key}")
EOF
chmod 600 "${GW_FABRIC_ENV_OUTPUT}"
echo "Private GW Fabric environment written to ${GW_FABRIC_ENV_OUTPUT}" >&2
