# Implementation Plan: Fabric Network Onboarding

> **Parent Document:** **[Identity Bootstrapping Guide (`IDENTITY_BOOTSTRAP_GUIDE.md`)](IDENTITY_BOOTSTRAP_GUIDE.md)**

## 1. Overview

This document provides the detailed technical plan for implementing the multi-phase Fabric onboarding flow. It specifies the new components, API endpoints, and changes to existing logic required.

## 2. The Onboarding State Machine

A tenant's onboarding request will be tracked in a persistent store (e.g., a new `OnboardingRequest` repository) and will progress through the following states:
1.  `PendingIdentityVerification`
2.  `PendingStepUpVerification` (if LoA is low)
3.  `PendingBusinessAuthorization` (after identity is verified)
4.  `PendingBilling` (after authorization, awaiting payment)
5.  `ReadyForActivation` (payment reconciled, activation code sent)
6.  `Active` (onboarding complete)
7.  `Rejected`

## 3. Phase 1: Identity Verification

This phase is handled by the existing `FabricSponsorshipManager` but with modified logic.

*   **`FabricSponsorshipManager` (at `Org A`):**
    *   **Responsibility:** Only handles the **Identity Verification** phase.
    *   **Trigger:** Receives a job with an entry `type: 'Sponsorship-request-v1.0'`.
    *   **Logic:**
        1.  Verifies all cryptographic proofs (from `Host B` and `Controller T`).
        2.  Evaluates the LoA according to the `TRUST_POLICY.md`.
        3.  **On Success (`LoA 4`):** Persists the request with status `PendingBusinessAuthorization`. It then triggers an internal event or webhook to notify the Business Authorization system.
        4.  **On Insufficient LoA:** Updates the request status to `PendingStepUpVerification` and initiates the OOB flow.
    *   **Response:** The result of the polling operation for this job will be the current status of the request (e.g., `{ "status": "PendingBusinessAuthorization" }`), **not** a secret.

*   **Endpoints for this Phase:** Remain as defined previously for the initial sponsorship request.

## 4. Phase 2: Business Authorization

This phase requires a new set of internal components and is primarily driven by human interaction.

*   **New Component: Back-Office Admin Panel (UI/API)**
    *   **Responsibility:** Provides an interface for `Org A`'s business team to view and manage requests in the `PendingBusinessAuthorization` state.

*   **New Manager: `BillingManager` (at `Org A`)**
    *   **Responsibility:** Integrates with a payment/invoicing system.
    *   **Trigger:** Called by the Admin Panel when an operator decides to "Approve and Bill" a request.
    *   **Logic:**
        1.  Generates a `BillingReferenceID`.
        2.  Updates the request status to `PendingBilling`.
        3.  Sends an invoice to `Controller T`.
        4.  Exposes a webhook endpoint to receive payment reconciliation notifications from the payment gateway.

*   **New Manager: `ActivationCodeManager` (at `Org A`)**
    *   **Responsibility:** Generates and delivers the final technical activation code.
    *   **Trigger:** Called by the `BillingManager` after a payment is successfully reconciled.
    *   **Logic:**
        1.  Generates a secure, one-time `ActivationCode`.
        2.  Updates the request status to `ReadyForActivation`.
        3.  Sends the `ActivationCode` to `Controller T` via a secure channel (e.g., email).

## 5. Phase 3: Final Technical Activation

This is the final, user-initiated, asynchronous job.

*   **New Manager: `FabricActivationManager` (at `Org A`)**
    *   **Responsibility:** Handles the final technical activation step.
    *   **Trigger:** Receives a job with an entry `type: 'Final-activation-request-v1.0'`.
    *   **Logic:**
        1.  Verifies the provided `ActivationCode`.
        2.  If valid, it **now** calls the **ICA** to get the one-time enrollment secret.
        3.  It uses the KMS to encrypt the secret for `Controller T`.
        4.  It updates the request status to `Active`.
        5.  The final JWE is returned as the result of this job.

*   **API Endpoint for Activation Request (User -> Host):**
    *   **Path:** `POST /v1/{tenantId}/cds-{jurisdiction}/{sector}/entity/org.schema/Organization/_activate`
    *   **Justification:** A new, specific `_activate` action on the `Organization` resource.
    *   **Request Entry `type`:** `Final-activation-request-v1.0`, containing the `ActivationCode`.
    *   **Behavior:** Initiates the final chained job. `Controller T` receives a `thid` to poll for the final JWE.

*   **API Endpoint for Activation Polling (User -> Host):**
    *   **Path:** `POST /v1/{tenantId}/cds-{jurisdiction}/{sector}/entity/org.schema/Organization/_activate-response?thid={thid}`
    *   **Justification:** Follows the established `_action-response` pattern for polling.

*   **API Endpoint for Re-encryption Ceremony (User -> Host):**
    *   **Path:** `POST /v1/{tenantId}/cds-{jurisdiction}/{sector}/kms/fabric/Activation/_batch`
    *   **Behavior:** This remains the final step, triggered by `Controller T` after they have successfully decrypted the JWE.

## 6. Client Application Flow (`Controller T`) - Complete

1.  Initiate the **Sponsorship Job** and poll. The final result will be a status update (e.g., "Pending Business Authorization").
2.  Receive and pay the invoice (out-of-band).
3.  Receive the `ActivationCode` via email.
4.  Initiate the **Final Activation Job** using the `_activate` endpoint, providing the `ActivationCode`.
5.  Poll the `_activate-response` URL. The final result will be the JWE containing the ICA secret.
6.  Decrypt the JWE.
7.  Initiate the **Fabric Credential Provisioning Job** using the `/kms/fabric/Activation/_batch` endpoint, sending the plaintext ICA secret.
8.  Poll this final job to confirm the `Tenant C` service is `Active` on the blockchain.

