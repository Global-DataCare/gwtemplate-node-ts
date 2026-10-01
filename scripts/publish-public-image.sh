#!/usr/bin/env bash
# Promote one already-tested local linux/amd64 image to a public OCI registry.
set -euo pipefail

SOURCE_IMAGE="${SOURCE_IMAGE:-}"
PUBLIC_IMAGE_REPOSITORY="${PUBLIC_IMAGE_REPOSITORY:-}"
PUBLIC_IMAGE_TAG="${PUBLIC_IMAGE_TAG:-}"

if [[ -z "${SOURCE_IMAGE}" || -z "${PUBLIC_IMAGE_REPOSITORY}" || -z "${PUBLIC_IMAGE_TAG}" ]]; then
  echo 'ERROR: SOURCE_IMAGE, PUBLIC_IMAGE_REPOSITORY and PUBLIC_IMAGE_TAG are required.' >&2
  exit 1
fi
if [[ "${SOURCE_IMAGE}" != *@sha256:* ]]; then
  echo 'ERROR: SOURCE_IMAGE must be pinned by registry digest.' >&2
  exit 1
fi
if [[ ! "${PUBLIC_IMAGE_TAG}" =~ ^[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{7,40}$ ]]; then
  echo 'ERROR: PUBLIC_IMAGE_TAG must be an immutable <version>-<git-sha> tag.' >&2
  exit 1
fi
if [[ "${PUBLIC_IMAGE_REPOSITORY}" == *@* || "${PUBLIC_IMAGE_REPOSITORY}" == *:* ]]; then
  echo 'ERROR: PUBLIC_IMAGE_REPOSITORY must not contain a tag or digest.' >&2
  exit 1
fi

docker image inspect "${SOURCE_IMAGE}" >/dev/null
platform="$(docker image inspect --format '{{.Architecture}}/{{.Os}}' "${SOURCE_IMAGE}")"
if [[ "${platform}" != 'amd64/linux' ]]; then
  echo "ERROR: expected an amd64/linux release image, got '${platform}'." >&2
  exit 1
fi

public_tag="${PUBLIC_IMAGE_REPOSITORY}:${PUBLIC_IMAGE_TAG}"
docker tag "${SOURCE_IMAGE}" "${public_tag}"
docker push "${public_tag}"

public_digest="$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "${public_tag}" \
  | awk -v repo="${PUBLIC_IMAGE_REPOSITORY}@" 'index($0, repo) == 1 { print; exit }')"
if [[ -z "${public_digest}" ]]; then
  echo "ERROR: public registry digest was not resolved for ${public_tag}." >&2
  exit 1
fi

echo "PUBLIC_IMAGE=${public_digest}"
