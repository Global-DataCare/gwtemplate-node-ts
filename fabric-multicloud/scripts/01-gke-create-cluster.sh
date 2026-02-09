#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GCP_PROJECT_ID:-}" || -z "${GCP_REGION:-}" || -z "${GKE_CLUSTER:-}" ]]; then
  echo "Missing GCP_PROJECT_ID, GCP_REGION, or GKE_CLUSTER. Source private-deploy.config first."
  exit 1
fi

gcloud config set project "${GCP_PROJECT_ID}"

gcloud services enable container.googleapis.com

gcloud container clusters create "${GKE_CLUSTER}" \
  --region "${GCP_REGION}" \
  --num-nodes "3" \
  --machine-type "e2-standard-4" \
  --enable-ip-alias

gcloud container clusters get-credentials "${GKE_CLUSTER}" --region "${GCP_REGION}"
