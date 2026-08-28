#!/usr/bin/env bash
# Flow contract:
# 1. each evidence gate executes with errexit and pipefail even while its log is piped through redaction;
# 2. the first failing command stops that gate and records FAIL;
# 3. disposable Fabric CA databases are removed before a clean local-network reproduction.
# Authorization invariant: a failed privileged mutation can never be converted into a passing gate.
# Persistence invariant: only logs and PASS/FAIL status survive; disposable CA state never contaminates a rerun.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
export EVIDENCE_DIR="${WORK}/evidence" HOME_PLACEHOLDER='${HOME}'
mkdir -p "${EVIDENCE_DIR}/gates" "${EVIDENCE_DIR}/logs"

# shellcheck source=../lib/evidence-gate.sh
[[ -f "${ROOT}/scripts/lib/evidence-gate.sh" ]] || exit 1
source "${ROOT}/scripts/lib/evidence-gate.sh" || exit 1

failing_gate() {
  printf 'before-failure\n'
  false
  printf 'after-failure\n'
}

set +e
run_gate deliberate-failure failing_gate
gate_status=$?
set -e
[[ ${gate_status} -ne 0 ]] || { echo 'A failing evidence gate returned success.' >&2; exit 1; }
grep -qx FAIL "${EVIDENCE_DIR}/gates/deliberate-failure.status"
grep -Fq before-failure "${EVIDENCE_DIR}/logs/deliberate-failure.log"
! grep -Fq after-failure "${EVIDENCE_DIR}/logs/deliberate-failure.log"

RUNNER="${ROOT}/scripts/collect-open-source-production-readiness-evidence.sh"
grep -Fq 'crypto/ca/root/fabric-ca-server.db' "${RUNNER}"
grep -Fq 'crypto/ca/ica/fabric-ca-server.db' "${RUNNER}"
