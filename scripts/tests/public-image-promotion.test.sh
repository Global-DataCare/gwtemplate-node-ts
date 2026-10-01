#!/usr/bin/env bash
# Flow contract: publish only an already-tested local image under one immutable public tag and report its registry digest.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/publish-public-image.sh"

test -x "${SCRIPT}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

cat > "${tmp_dir}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${DOCKER_CALLS}"
case "$1" in
  image)
    if [[ "$*" == *'{{.Architecture}}/{{.Os}}'* ]]; then
      printf 'amd64/linux\n'
    else
      printf 'sha256:local-image-id\n'
    fi
    ;;
  push)
    printf 'published\n'
    ;;
  inspect)
    printf 'ghcr.io/example/gw-core@sha256:public-digest\n'
    ;;
esac
EOF
chmod +x "${tmp_dir}/docker"

export DOCKER_CALLS="${tmp_dir}/calls.log"
PATH="${tmp_dir}:${PATH}" \
SOURCE_IMAGE='registry.example/gw-core@sha256:source-digest' \
PUBLIC_IMAGE_REPOSITORY='ghcr.io/example/gw-core' \
PUBLIC_IMAGE_TAG='1.25.30-195899d' \
  "${SCRIPT}" > "${tmp_dir}/output.log"

grep -Fq 'image inspect registry.example/gw-core@sha256:source-digest' "${DOCKER_CALLS}"
grep -Fq 'tag registry.example/gw-core@sha256:source-digest ghcr.io/example/gw-core:1.25.30-195899d' "${DOCKER_CALLS}"
grep -Fq 'push ghcr.io/example/gw-core:1.25.30-195899d' "${DOCKER_CALLS}"
grep -Fq 'PUBLIC_IMAGE=ghcr.io/example/gw-core@sha256:public-digest' "${tmp_dir}/output.log"

if PATH="${tmp_dir}:${PATH}" \
  SOURCE_IMAGE='registry.example/gw-core@sha256:source-digest' \
  PUBLIC_IMAGE_REPOSITORY='ghcr.io/example/gw-core' \
  PUBLIC_IMAGE_TAG='latest' \
  "${SCRIPT}" >/dev/null 2>&1; then
  echo 'ERROR: mutable public tag was accepted' >&2
  exit 1
fi

echo 'Public image promotion contract passed.'
