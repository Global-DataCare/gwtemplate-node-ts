# Deployment Guide: Google Cloud Run

This guide provides instructions for deploying the application to Google Cloud Run using the provided automation script.

## Overview

This project includes an automated script (`cloud_deploy.sh`) to build and deploy the application as a containerized service on Google Cloud Run. This is ideal for creating separate `staging` and `production` environments.

The process is designed to be secure and repeatable, relying on environment-specific configuration files that are kept out of version control.

## Prerequisites

1.  **Google Cloud SDK (`gcloud`)**: Ensure you have the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed and authenticated with a user that has permissions for Cloud Run, Artifact Registry, and associated services.
    ```bash
    gcloud auth login
    gcloud auth application-default login
    ```

2.  **Docker**: The script uses Docker to build the container image. Make sure Docker is installed and the daemon is running.

## Configuration Steps

The deployment script uses environment-specific `.env` files. You must create one for each environment you intend to deploy. **These files should never be committed to version control.**

### 1. Create Staging Configuration

Copy the example file to create the staging configuration:
```bash
cp .env.deploy.staging.example .env.deploy.staging
```
Now, open `.env.deploy.staging` and fill in the values for your staging environment (e.g., staging project ID, service name). Ensure `DB_PROVIDER` is set appropriately (e.g., `firestore`).

### 2. Create Production Configuration

Copy the example file to create the production configuration:
```bash
cp .env.deploy.production.example .env.deploy.production
```
Open `.env.deploy.production` and carefully fill in the values for your production environment. Double-check all settings, especially the project ID and resource names.

## Execution

### 1. Make the script executable (One-time step)
```bash
chmod +x cloud_deploy.sh
```

### 2. Run the deployment script

To deploy, you must specify the target environment as an argument.

**To deploy to STAGING:**
```bash
./cloud_deploy.sh staging
```

**To deploy to PRODUCTION:**
```bash
./cloud_deploy.sh production
```

### What the Script Does

The script will perform the following steps automatically:
1.  **Loads Configuration**: Reads variables from the corresponding file (`.env.deploy.staging` or `.env.deploy.production`).
2.  **Asks for Confirmation**: Displays the critical configuration values (Project ID, Service Name, Region, etc.) and prompts you to confirm before proceeding. **This is a critical safety check.**
3.  **Validates Prerequisites**: Checks that Docker is running and the TypeScript code has no compilation errors.
4.  **Configures `gcloud`**: Sets the active project to the one specified in your configuration file.
5.  **Enables APIs**: Activates the Cloud Run and Artifact Registry APIs.
6.  **Creates Artifact Registry Repo**: Creates the specified repository if it doesn't already exist.
7.  **Builds & Pushes Docker Image**: Builds the application's Docker image and pushes it to your private Artifact Registry. It will pass the `NPM_TOKEN` as a build argument if it exists in your config file.
8.  **Deploys to Cloud Run**: Deploys the image to Google Cloud Run, injecting the environment variables from your configuration file.

Upon successful completion, the script will print the public **Service URL** of your newly deployed application.

