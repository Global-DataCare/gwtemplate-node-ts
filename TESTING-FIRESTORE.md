# Testing Guide for Firestore

This document provides specific instructions for testing the `FirestoreVaultRepository`.

## 1. Integration Tests (Emulator)

This is the **recommended method for most development**. It uses a local Firestore emulator and requires no cloud connection.

### Setup
1.  **Install Emulator:** Ensure you have the gcloud component.
    ```shell
    gcloud components install cloud-firestore-emulator
    ```
2.  **Start Emulator:** In a separate terminal, run:
    ```shell
    gcloud emulators firestore start --host-port="localhost:8080"
    ```

### Execution
With the emulator running, execute the integration test script:
```shell
npm run test:integration
```
This command runs the test file(s) located in `src/__tests__/integration`. The test setup (`jest.setup.ts`) detects it's not an E2E run and the repository constructor (`FirestoreVaultRepository`) detects the `FIRESTORE_EMULATOR_HOST` environment variable, forcing the connection to your local emulator.

## 2. End-to-End Tests (Live GCP Project)

E2E tests validate the connection and configuration against a real Firestore instance. **Never run E2E tests against a production database.** Use a dedicated test project.

### Cloud Project Setup (One-Time)

Setting up a Google Cloud project for E2E testing involves three main stages: creating the project, configuring Firestore within the Firebase console, and creating a service account for authentication.

#### Stage 1: Create or Select a GCP Project
Ensure you have a Google Cloud Project dedicated to testing. For this guide, we assume the project ID is `globaldatacare-test`.

#### Stage 2: Configure Firestore via the Firebase Console
Even for a backend-only project, the Firebase Console is required for essential Firestore management tasks like setting Security Rules.

1.  **Add Firebase to your GCP Project:**
    -   Go to the [Firebase Console](https://console.firebase.google.com/).
    -   Click **"+ Add project"**.
    -   From the dropdown menu, **select your existing GCP project** (e.g., `globaldatacare-test`). Do NOT create a new one.
    -   Accept the terms and continue. You can disable Google Analytics for this project.
    -   This process links your GCP project to the Firebase management interface.

2.  **Initialize Firestore Database:**
    -   From the Firebase Console sidebar, go to **Build > Firestore Database**.
    -   Click the **"Create database"** button. This will configure the existing Firestore API you enabled in GCP.
    -   Select **"Start in production mode"**. This applies secure-by-default rules.
    -   Choose your database edition: **"Standard"**.
    -   Select a Firestore location (e.g., a regional location close to you). This choice is permanent.
    -   Click **"Enable"**.

3.  **Set Security Rules:**
    -   After the database is created, go to the **"Rules"** tab.
    -   Replace the default rule (`allow read, write: if false;`) with the one below. This rule grants access to any authenticated principal, which includes our service account.
      ```
      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /{document=**} {
            allow read, write: if request.auth != null;
          }
        }
      }
      ```
    -   Click **"Publish"**.

#### Stage 3: Create a Service Account for Authentication
This account acts as a "robot user" for our tests.

1.  **Navigate to the Service Accounts page** in the Google Cloud Console for your project.
    -   *Direct Link:* `https://console.cloud.google.com/iam-admin/serviceaccounts?project=<YOUR_PROJECT_ID>`
2.  **Create a new service account** (e.g., `vault-e2e-tester`).
3.  **Grant it the `Cloud Datastore User` role** (`roles/datastore.user`). This provides permissions to read and write to Firestore.
4.  **Create and download a JSON key** for this service account.
5.  **Move the downloaded file** to the root of this project and rename it to `gcp-service-account.json`.
6.  **CRITICAL:** Ensure `gcp-service-account.json` (or `/*.json`) is listed in your `.gitignore` file.

### Local Environment Setup

#### Create `.env.test` File
1.  In the project root, create a file named `.env.test`.
2.  Use `.env.example` as a template. It should look like this:

    ```
    # .env.test
    DB_PROVIDER=firestore
    FIRESTORE_PROJECT_ID=globaldatacare-test
    GOOGLE_APPLICATION_CREDENTIALS=./gcp-service-account.json
    ```

### Docker & Containerized Environments

The `FirestoreVaultRepository` is designed to work seamlessly in containerized environments. Instead of relying on a file path, you can provide the content of the `gcp-service-account.json` file directly as an environment variable.

1.  Copy the entire content of your `gcp-service-account.json` file.
2.  Set it as the value for the `GOOGLE_APPLICATION_CREDENTIALS` environment variable in your Docker setup (e.g., Docker Compose, Kubernetes secrets).

The repository will automatically detect that the variable is a JSON string and parse it, removing the need to manage key files within your container images.

