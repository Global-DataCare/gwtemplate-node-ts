#!/usr/bin/env bash
set -euo pipefail

HOST_PORT="${HOST_PORT:-8080}"
ENV_FILE="${ENV_FILE:-./.env.local}"
CONTAINER_NAME="${CONTAINER_NAME:-gwtemplate}"
IMAGE_NAME="${IMAGE_NAME:-gwtemplate}"
FORCE_RECREATE="${FORCE_RECREATE:-false}"

confirm_or_force() {
  local message="$1"
  if [[ "$FORCE_RECREATE" == "true" ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    echo "Aborting: $message Set FORCE_RECREATE=true for non-interactive runs."
    return 1
  fi

  read -p "$message (y/n): " -n 1 -r
  echo ""
  [[ $REPLY =~ ^[Yy]$ ]]
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE"
  exit 1
fi

EXISTING_CONTAINER_ID="$(docker ps -aq -f name=^/${CONTAINER_NAME}$)"
RUNNING_CONTAINER_ID="$(docker ps -q -f name=^/${CONTAINER_NAME}$)"

if [ -n "$RUNNING_CONTAINER_ID" ]; then
  confirm_or_force "Container '${CONTAINER_NAME}' is running. Stop and remove it?" || exit 1
  docker stop "$CONTAINER_NAME"
  docker rm "$CONTAINER_NAME"
elif [ -n "$EXISTING_CONTAINER_ID" ]; then
  confirm_or_force "Container '${CONTAINER_NAME}' exists (stopped). Remove it?" || exit 1
  docker rm "$CONTAINER_NAME"
fi

docker run -d --env-file "$ENV_FILE" -p "${HOST_PORT}:3000" --name "$CONTAINER_NAME" "$IMAGE_NAME"
echo "Container '${CONTAINER_NAME}' listening on http://localhost:${HOST_PORT}"
