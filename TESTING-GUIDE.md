# End-to-End (E2E) Testing Guide

This guide provides instructions for setting up and running the End-to-End (E2E) test suite, which validates the application's integration with live Google Cloud Platform (GCP) services.
For general testing strategy and tiers, see `TESTING.md`.

## 1. Overview

The E2E test suite (`npm run test:e2e`) is designed to run against a real GCP project. It currently validates three key integrations:
- **Firestore**: `firestore.vault.repository.e2e.spec.ts` tests the `FirestoreVaultRepository`'s ability to connect, write, read, and query a live Firestore database.
- **Cloud Storage**: `gcs.storage.adapter.e2e.spec.ts` tests the `GcsStorageAdapter`'s ability to connect, upload files, manage permissions, and generate public URLs against a live GCS bucket.
- **Authentication & API**: `api.e2e.spec.ts` tests the full API flow, including generating a real authentication token from Firebase Auth and using it to authorize a request.

**Never run E2E tests against a production database or storage bucket.** Use a dedicated test project.

---

## 2. GCP Project Setup (One-Time)

This setup involves creating a project, a service account, and configuring the required services.

### Stage 1: Create or Select a GCP Project
Ensure you have a Google Cloud Project dedicated to testing. For this guide, we assume the project ID is `globaldatacare-test`.

### Stage 2: Create a Service Account
This account acts as a "robot user" for our tests.

1.  **Navigate to the Service Accounts page** in the Google Cloud Console for your project.
    -   *Direct Link:* `https://console.cloud.google.com/iam-admin/serviceaccounts?project=<YOUR_PROJECT_ID>`
2.  **Create a new service account** (e.g., `vault-e2e-tester`).
3.  **Grant it the `Cloud Datastore User` role** (`roles/datastore.user`). This provides the baseline permissions to read and write to Firestore. We will grant storage permissions later.
4.  **Create and download a JSON key** for this service account.
5.  **Move the downloaded file** to the root of this project and rename it to `gcp-service-account.json`.
6.  **CRITICAL:** Ensure `gcp-service-account.json` (or `/*.json`) is listed in your `.gitignore` file.

### Stage 3: Enable and Configure Services via Firebase Console
The Firebase Console is the easiest way to manage Firestore, Authentication, and Storage setup.

1.  **Add Firebase to your GCP Project:**
    -   Go to the [Firebase Console](https://console.firebase.google.com/).
    -   Click **"+ Add project"** and **select your existing GCP project** (e.g., `globaldatacare-test`). Do NOT create a new one.
    -   Accept the terms and continue. You can disable Google Analytics.

2.  **Initialize Firestore Database:**
    -   From the Firebase Console sidebar, go to **Build > Firestore Database**.
    -   Click **"Create database"**.
    -   Select **"Start in production mode"**.
    -   Choose a Firestore location (this choice is permanent).
    -   Click **"Enable"**.

3.  **Configure Cloud Storage:**
    -   From the Firebase Console sidebar, go to **Build > Storage**.
    -   Click **"Get Started"** and follow the prompts to create a default storage bucket. It will have a name like `<project-id>.appspot.com`.
    -   Once created, navigate to the bucket in the [Google Cloud Storage Console](https://console.cloud.google.com/storage/browser).
    -   Click on your bucket, then go to the **Permissions** tab.
    -   Click **"+ Grant Access"**.
    -   In **New principals**, paste the full email of the service account you created (e.g., `vault-e2e-tester@globaldatacare-test.iam.gserviceaccount.com`).
    -   In **Assign roles**, select the **`Storage Object Admin`** role. This provides all necessary permissions (`create`, `get`, `delete`, `getIamPolicy`) for the E2E test.
    -   Click **Save**.

4.  **Configure Authentication for API Test:**
    -   In the Firebase Console, go to **Build > Authentication**.
    -   Go to the **Sign-in method** tab.
    -   Click on **Email/Password** in the "Native providers" list, **enable** it, and click **Save**.
    -   Go to the **Users** tab and click **"+ Add user"**.
    -   Create a test user with an email and password that you will use in your `.env.test` file (e.g., `admin1@acme.org`).
    -   In the Firebase Console, go to **Project Overview > Project settings** (⚙️ icon).
    -   In the **General** tab, under "Your apps", click the Web icon (`</>`) to create a new Web App.
    -   Give it a nickname (e.g., `E2E Tests`) and click **"Register app"**. **Do not** check the box for Firebase Hosting unless you need it for other purposes.
    -   In the next step, you will see a `firebaseConfig` object. Copy the value of `apiKey`. This is your `FIREBASE_API_KEY`.

---

## 3. Local Environment Setup

### Create `.env.test` File
1.  In the project root, create a file named `.env.test`.
2.  Use `env.example` as a template and fill in all the required values you gathered from the steps above. It should look similar to this:

    ```
    # .env.test
    TEST_ENV=e2e
    DB_PROVIDER=firestore
    STORAGE_PROVIDER=gcs

    # --- GCP Credentials ---
    FIRESTORE_PROJECT_ID=globaldatacare-test
    GCS_BUCKET_NAME=globaldatacare-test.appspot.com
    GOOGLE_APPLICATION_CREDENTIALS=./gcp-service-account.json

    # --- Firebase Auth for API Test ---
    FIREBASE_API_KEY=AIzaSy...
    DEMO_ORG1_ADMIN_EMAIL=admin1@acme.org
    DEMO_ORG1_ADMIN_EMAIL_PASSWORD=your-test-user-password

    # ... other variables from .env.example
    ```

---

## 4. Running the E2E Tests

With the setup complete, you can run the full E2E test suite:

```shell
npm run test:e2e
```

This command will execute all test files in the `src/__tests__/e2e` directory. If the environment is configured correctly, all tests should pass.
