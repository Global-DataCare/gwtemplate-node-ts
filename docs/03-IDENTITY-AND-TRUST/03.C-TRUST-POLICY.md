# Trust and Assurance Level Policy

# Trust and Assurance Level Policy

> **Parent Document:** **[Identity Bootstrapping Guide (`IDENTITY_BOOTSTR-AP_GUIDE.md`)](IDENTITY_BOOTSTRAP_GUIDE.md)**

## 1. Overview

This document defines the trust policy for the federated data network. It specifies the roles of different actors, the required Levels of Assurance (LoA) for **organization identity verification**, and the secure protocols for escalating verification when initial evidence is insufficient. This policy is the formal basis for the business logic implemented in `Org A`'s `FabricSponsorshipManager`.

## 2. Roles and Responsibilities

*   **`Org A` (Trust Root & Policy Decision Point - PDP):**
    *   Acts as the ultimate governor of the network.
    *   Defines and enforces the minimum required Level of Assurance for any organization to join the network.
    *   Acts as the final verifier in "step-up" authentication flows.

*   **`Host B` (Service Host & Policy Enforcement Point - PEP):**
    *   Acts as the primary verifier for its tenant organizations.
    *   Is responsible for collecting identity evidence and assigning an initial LoA to that evidence.
    *   Acts as a trusted proxy, forwarding verification requests and proofs to `Org A`.

*   **`Controller T` (Human Administrator of `Tenant C`):**
    *   Represents `Tenant C` and is responsible for providing identity evidence to `Host B`.
    *   Is the ultimate recipient of all secrets for `Tenant C`.

## 3. Level of Assurance (LoA) Framework for Organizations

`Org A`'s policy is based on a simplified LoA framework focused on evidence applicable to **legal entities**.

| LoA | Level Name | Required Evidence | Automatic Approval by Org A? |
| :-- | :--- | :--- | :--- |
| **LoA 4** | **High** | A **digital signature from a qualified, government-issued X.509 certificate of legal representation** on a document (e.g., Terms of Service). The certificate's subject MUST match the organization's legal name. | **Yes, for Identity Verification phase.** |
| **LoA 2** | **Moderate** | Verification of **scanned official company documents** (e.g., articles of incorporation, tax registration certificate). The verification process must include checks against official, public business registries where possible. | **No, requires Step-Up.** |
| **LoA 1** | **Low** | Self-asserted company information, verified only by domain ownership (e.g., via DNS records or email validation). | **No, requires Step-Up.** |

**Note:** Verification of physical individuals (like `Controller T`'s own identity) is the responsibility of the Host and is considered a separate process from verifying the organization itself. `Org A`'s primary concern is the authenticity of the legal entity (`Tenant C`).

## 4. The Sponsorship and Verification Flow

### Step 4.1: Sponsorship Request

When `Host B` sponsors `Tenant C` for network access, its request to `Org A` MUST include:
1.  **The Identity of `Tenant C`:** The tenant's canonical URN.
2.  **The Identity of the Controller:** The DID of `Controller T`.
3.  **The Evidence Claim:** A structured, signed statement detailing the verification `Host B` performed and the LoA it has assigned. Example: `{"type": "DigitalCertificateVerification", "assuranceLevel": "LoA-4", "certificateThumbprint": "..."}`.
4.  **The Controller's Presence Proof:** A short-lived `bearer token` (e.g., JWT) obtained by `Controller T` and passed through `Host B` in a `meta.bearer` field.

### Step 4.2: Policy Decision at Org A

`Org A`'s `FabricSponsorshipManager` receives the request and executes the **Identity Verification** phase of the policy:
1.  Verifies the outer signature from `Host B`.
2.  Verifies the inner `bearer token` from `Controller T`.
3.  Inspects the `assuranceLevel` claim.
4.  If `LoA = 4`, the identity is considered verified. The request's status is updated to `PendingBusinessAuthorization`, and the flow is handed off to `Org A`'s business review team. **The process is not yet complete.**
5.  If `LoA < 4`, the request is put into a `pending-step-up` state, and the Out-of-Band Challenge Flow is initiated. Completing the step-up flow will also result in the status moving to `PendingBusinessAuthorization`.

The successful completion of the Identity Verification phase is a **prerequisite** for, but does not grant, final approval to join the network.

## 5. Out-of-Band (OOB) Step-Up Verification Flow

This flow is initiated when the initial evidence is insufficient (LoA 1 or 2). It uses a physical-world interaction to bridge the trust gap, secured by a PKCE-like protocol.

### Step 5.1: Challenge Generation (at `Controller T`)

1.  Before the sponsorship request, the client application of `Controller T` generates a cryptographically random `code_verifier` and its SHA-256 hash, the `code_challenge`.
2.  The initial sponsorship request sent to `Org A` **must include this `code_challenge`**.

### Step 5.2: OOB Challenge Delivery (from `Org A`)

1.  `Org A`'s system sees the `pending-step-up` request and its associated `code_challenge`.
2.  It sends a physical letter containing a human-readable one-time code to the **verified legal/postal address** of the `Tenant C` organization.

### Step 5.3: Challenge Response and Closure (through `Host B`)

1.  `Controller T` receives the code in the mail.
2.  `Controller T` uses their client application to make a final request to **their `Host B`**. This request contains:
    *   The `code_verifier` (the original secret).
    *   The one-time code received in the mail.
    *   A fresh `bearer token` to prove their presence.
3.  `Host B` acts as a trusted proxy, bundling this information into a new signed DIDComm message and forwarding it to `Org A`.
4.  `Org A` receives the message, verifies all proofs, and checks if the hashed `code_verifier` matches the stored `code_challenge`.
5.  If all checks pass, the request is approved, and the secure secret delivery process begins.
