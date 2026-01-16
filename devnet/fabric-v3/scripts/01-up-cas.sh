#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "${ROOT}"

docker compose --profile ca up -d

echo "CAs are starting..."
echo "Root CA: https://127.0.0.1:7054"
echo "ICA:     https://127.0.0.1:7055"

