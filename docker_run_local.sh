#!/bin/bash
set -e

# -d: Run the container in detached mode (in the background)
# --env-file ./.env.local: Load environment variables from the local env file
# -p 8080:3000: Map port 8080 on the host to port 3000 in the container
# --name gwtemplate: Give the running container a convenient name
EXISTING_CONTAINER_ID="$(docker ps -aq -f name=^/gwtemplate$)"
RUNNING_CONTAINER_ID="$(docker ps -q -f name=^/gwtemplate$)"

if [ -n "$RUNNING_CONTAINER_ID" ]; then
  read -p "Container 'gwtemplate' is running. Stop and remove it? (y/n): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting."
    exit 1
  fi
  docker stop gwtemplate
  docker rm gwtemplate
elif [ -n "$EXISTING_CONTAINER_ID" ]; then
  read -p "Container 'gwtemplate' exists (stopped). Remove it? (y/n): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting."
    exit 1
  fi
  docker rm gwtemplate
fi

docker run -d --env-file ./.env.local -p 8080:3000 --name gwtemplate gwtemplate
