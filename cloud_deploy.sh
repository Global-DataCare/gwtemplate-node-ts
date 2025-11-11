#!/bin/bash
# A script to build and deploy the gwtemplate to Google Cloud Run.

set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration Loading ---

# Check if .env file exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Please create it from env.example and configure it."
  exit 1
fi

# Load environment variables from .env file securely
set -a # automatically export all variables
source .env
set +a # stop automatically exporting


# --- Variable Validation ---

# Check for required deployment variables
if [ -z "$FIRESTORE_PROJECT_ID" ] || [ -z "$DEPLOY_REGION" ] || [ -z "$DEPLOY_SERVICE_NAME" ] || [ -z "$ARTIFACT_REGISTRY_NAME" ]; then
  echo "ERROR: One or more required variables are not set in your .env file."
  echo "Please ensure FIRESTORE_PROJECT_ID, DEPLOY_REGION, DEPLOY_SERVICE_NAME, and ARTIFACT_REGISTRY_NAME are defined."
  exit 1
fi

# --- GCP and Docker Configuration ---

# The Google Artifact Registry repository name.
REPO_NAME="$ARTIFACT_REGISTRY_NAME"

# The full image path in Artifact Registry.
IMAGE_PATH="${DEPLOY_REGION}-docker.pkg.dev/${FIRESTORE_PROJECT_ID}/${REPO_NAME}/${DEPLOY_SERVICE_NAME}:latest"

# --- Script ---

echo "--- 🚀 Starting GCP Deployment ---"

# --- Pre-flight Checks ---
echo "⚙️  Checking prerequisites..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ ERROR: Docker is not running."
  echo "Please start the Docker daemon and try again."
  exit 1
fi
echo "✅ Docker is running."

# Check for TypeScript errors
echo "⚙️  Checking for TypeScript errors..."
if ! npx tsc --noEmit; then
  echo "❌ ERROR: TypeScript compilation failed. Please fix the errors above before deploying."
  exit 1
fi
echo "✅ No TypeScript errors found."

# Configure gcloud to use the specified project
echo "⚙️  Configuring gcloud for project: $FIRESTORE_PROJECT_ID"
gcloud config set project "$FIRESTORE_PROJECT_ID"

# Enable required Google Cloud services
echo "⚙️  Enabling required services (run, artifactregistry)..."
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# Create a repository in Artifact Registry if it doesn't exist
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$DEPLOY_REGION" &> /dev/null; then
  echo "⚙️  Creating Artifact Registry repository: $REPO_NAME in $DEPLOY_REGION"
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$DEPLOY_REGION" \
    --description="Docker repository for $DEPLOY_SERVICE_NAME"
else
  echo "✅ Artifact Registry repository '$REPO_NAME' already exists."
fi

# Authenticate Docker with Artifact Registry
echo "⚙️  Configuring Docker to authenticate with GCP..."
gcloud auth configure-docker "${DEPLOY_REGION}-docker.pkg.dev"

# Build the Docker image, passing NPM_TOKEN if it exists
echo "⚙️  Building the Docker image: $IMAGE_PATH"
if [ -n "$NPM_TOKEN" ]; then
  echo "(NPM_TOKEN found, passing it as a build argument)"
  docker build --build-arg NPM_TOKEN="$NPM_TOKEN" -t "$IMAGE_PATH" .
else
  echo "(NPM_TOKEN not found, building without it)"
  docker build -t "$IMAGE_PATH" .
fi

# Push the Docker image to Artifact Registry
echo "⚙️  Pushing the image to Artifact Registry..."
docker push "$IMAGE_PATH"

# --- Environment Variable Preparation ---
echo "⚙️  Preparing runtime environment variables for Cloud Run..."

# Define the temporary file for environment variables
TEMP_ENV_FILE="temp_env.yaml"

# Ensure the temporary file is cleaned up on exit, even if the script fails
trap 'rm -f "$TEMP_ENV_FILE"' EXIT

# Create a clean temporary file
> "$TEMP_ENV_FILE"

# List of runtime variables from .env to pass to the Cloud Run instance.
# CRITICAL: For production, sensitive values should be moved to Google Secret Manager.
RUNTIME_VARS=(
  "NODE_ENV" "HOST_INTERNAL_NAME" "HOST_INTERNAL_PORT"
  "HOST_PUBLIC_URL" "HOST_DEPLOY_URL"
  "DEV_SEED" "SECTORS_ALLOWED"
  "ORG_HOST_LEGAL_NAME" "ORG_HOST_JURISDICTION" "ORG_HOST_ID_TYPE" "ORG_HOST_ID_VALUE"
  "ORG_HOST_ADMIN_EMAIL" "ORG_HOST_ADMIN_UID" "ORG_HOST_ADMIN_ROLE" "ORG_HOST_TERMS_URL"
  "KEK_SECRET" "QUEUE_PROVIDER" "DB_PROVIDER" "STORAGE_PROVIDER" "FIRESTORE_PROJECT_ID"
  "GCS_BUCKET_NAME" "FIREBASE_API_KEY"
)

# Write the variables to the YAML file
for VAR_NAME in "${RUNTIME_VARS[@]}"; do
  # Using indirect expansion to get the value of the variable whose name is VAR_NAME
  VAR_VALUE="${!VAR_NAME}"
  
  if [ -n "$VAR_VALUE" ]; then
    # Write in YAML format: KEY: "VALUE"
    # The quotes around VAR_VALUE are crucial for handling special characters correctly.
    echo "$VAR_NAME: \"$VAR_VALUE\"" >> "$TEMP_ENV_FILE"
  fi
done

# Deploy the image to Cloud Run
echo "⚙️  Deploying to Cloud Run service: $DEPLOY_SERVICE_NAME in $DEPLOY_REGION"
gcloud run deploy "$DEPLOY_SERVICE_NAME" \
  --image="$IMAGE_PATH" \
  --platform="managed" \
  --region="$DEPLOY_REGION" \
  --port="3000" \
  --env-vars-file="$TEMP_ENV_FILE" \
  --allow-unauthenticated # WARNING: This makes the service publicly accessible.

echo "--- ✅ Deployment Successful ---"
SERVICE_URL=$(gcloud run services describe "$DEPLOY_SERVICE_NAME" --platform="managed" --region="$DEPLOY_REGION" --format='value(status.url)')
echo "Service Name: $DEPLOY_SERVICE_NAME"
echo "Service URL: $SERVICE_URL"
echo "-----------------------------------"