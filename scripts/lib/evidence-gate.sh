#!/usr/bin/env bash

# Runs one evidence function in an errexit-enabled subshell while preserving a
# redacted log and an explicit PASS/FAIL status in the parent process.
run_gate() (
  local gate_id="$1"
  shift
  local log_file="${EVIDENCE_DIR}/logs/${gate_id}.log"
  local status
  echo "[evidence] ${gate_id}"
  set +e
  (
    set -euo pipefail
    "$@"
  ) 2>&1 \
    | perl -pe 's/\Q$ENV{HOME}\E/$ENV{HOME_PLACEHOLDER}/g' \
    | sed -E \
      -e 's/^Password: .+$/Password: [REDACTED]/' \
      -e 's#(https?://[^:/[:space:]]+):[^@/[:space:]]+@#\1:[REDACTED]@#g' \
    | tee "${log_file}"
  status="${PIPESTATUS[0]}"
  set -e
  if [[ ${status} -ne 0 ]]; then
    printf 'FAIL\n' > "${EVIDENCE_DIR}/gates/${gate_id}.status"
    echo "[evidence] FAIL ${gate_id}; see ${log_file}" >&2
    return "${status}"
  fi
  printf 'PASS\n' > "${EVIDENCE_DIR}/gates/${gate_id}.status"
  echo "[evidence] PASS ${gate_id}"
)
