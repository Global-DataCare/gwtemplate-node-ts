# Deployment Guide: Google Cloud Run

This guide provides instructions for deploying the application to Google Cloud Run using the provided automation script.

## Overview

This project includes an automated script (`cloud_deploy.sh`) to build and deploy the application as a containerized service on Google Cloud Run. This is ideal for creating staging, testing, or production environments.

The process is designed to be simple and repeatable, relying on a local `.env` file for configuration.

## Prerequisites

1.  **Google Cloud SDK (`gcloud`)**: Ensure you have the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed and properly authenticated with a user account that has permissions to manage Cloud Run, Artifact Registry, and the associated services.
    ```bash
    # Log in with your user account
    gcloud auth login

    # Set up Application Default Credentials for local libraries
    gcloud auth application-default login
    ```

2.  **Docker**: The script uses Docker to build the container image. Make sure Docker is installed and the Docker daemon is running on your local machine.

## Configuration Steps

1.  **Create your `.env` file**: The deployment script reads its configuration from a `.env` file in the project root. If you don't have one, create it by copying the template:
    ```bash
    cp env.example .env
    ```

2.  **Edit `.env` for Deployment**: Open the `.env` file and fill in the required values under the `GCP Deployment Configuration` and `GCP Project & Credentials` sections:
    *   `FIRESTORE_PROJECT_ID`: Your target Google Cloud Project ID.
    *   `DEPLOY_REGION`: The GCP region for the service (e.g., `europe-southwest1`).
    *   `DEPLOY_SERVICE_NAME`: The public name for your Cloud Run service (e.g., `gwtemplate-staging`).
    *   `ARTIFACT_REGISTRY_NAME`: The name for the repository in Artifact Registry where the image will be stored (e.g., `gwtemplate-images`).

    **Note:** For a deployed environment, you might need to adjust other variables like `NODE_ENV` (e.g., to `development` or `production`) and ensure your `GOOGLE_APPLICATION_CREDENTIALS` are set up for the target environment, though Cloud Run typically uses the service account's identity.

## Execution

1.  **Make the script executable**: You only need to perform this step once.
    ```bash
    chmod +x cloud_deploy.sh
    ```

2.  **Run the deployment script**:
    ```bash
    ./cloud_deploy.sh
    ```

### What the Script Does

The script will perform the following steps automatically:
1.  **Validates Configuration**: Checks that all required variables are present in your `.env` file.
2.  **Configures `gcloud`**: Sets the active project to the one specified in `FIRESTORE_PROJECT_ID`.
3.  **Enables APIs**: Activates the Cloud Run and Artifact Registry APIs if they are not already enabled.
4.  **Creates Artifact Registry Repo**: Checks for the existence of the specified repository and creates it automatically if it's missing.
5.  **Builds Docker Image**: Builds the application's Docker image, tagging it correctly for Artifact Registry. It will pass the `NPM_TOKEN` from your `.env` as a build argument if it exists.
6.  **Pushes Image**: Pushes the newly built image to your private Artifact Registry.
7.  **Deploys to Cloud Run**: Deploys the specified image version to Google Cloud Run, making it a live service.

Upon successful completion, the script will print the public **Service URL** of your newly deployed application.
