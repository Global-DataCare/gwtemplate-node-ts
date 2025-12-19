#### 1. Core Principles

*   **Separation of Concerns (Gateway vs. Network):** The Gateway's primary role is to manage an organization's identity, vault, and configuration. Access to specific networks (`test`, `production`) is a service granted to that organization. An organization can be "active" on the Gateway but only have access to the `test` network.
*   **Separation of Concerns (Managers):**
    *   **`HostingManager`**: Responsible for the initial onboarding of a top-level Tenant organization. Its scope ends when the tenant's gateway account is `active` and they have been granted `test` network access.
    *   **`CustomerManager`**: Responsible for the onboarding of "Family Organizational Groups" *under* an existing Tenant. It follows a similar flow to the `HostingManager`.
    *   **`NetworkEnrollmentManager` / `FabricActivationManager`**: Responsible for the distinct, subsequent process of enrolling an existing, `test`-active organization onto the `production` network.
*   **Consistent API Primitives:** The `Offer`/`Order` pattern is the standard mechanism for initiating a commercial transaction. This is used for both the initial `test` registration and the subsequent `production` network enrollment.

#### 2. The Canonical Data Model

To support this clear separation, we use an inherited data model.

*   **`EntityConfig` (`src/models/entity.ts`):** A base interface for all entities (Organizations, People, etc.) containing common properties like `id`, `type`, `status`, and `claims`. The `status` field refers to the state of the entity itself (e.g., an employee is 'active' or 'inactive').

*   **`OrganizationConfig extends EntityConfig`:** A specialized interface for entities that can have network access (i.e., top-level Tenants and Family Groups). It introduces the critical `networkStatus` property.

    ```typescript
    /**
     * Defines the status of an Organization on a specific network.
     */
    export interface NetworkStatus {
      networkName: string; // e.g., 'test', 'test-network', 'production'
      status: 'pending_verification' | 'active' | 'revoked';
      activationDate?: string;
      verificationEvidence?: string; // e.g., URL to the vc.json or a transaction ID
    }

    /**
     * Extends the base EntityConfig for Tenants and Family Groups.
     */
    export interface OrganizationConfig extends EntityConfig {
      type: 'Organization';
      /**
       * The organization's access status for each available network.
       */
      networkStatus: NetworkStatus[];
    }
    ```

#### 3. The End-to-End Onboarding Super-Flow

This describes the complete lifecycle of an organization from initial contact to full production access.

##### **Phase 1: Gateway & Test-Network Onboarding (Responsibility: `HostingManager`)**

This phase is about creating the organization's account and giving them a sandbox to develop in.

1.  **Request (`POST /host/cds-{jurisdiction}/v1/test/registry/org.schema/Organization/_batch`):** A legal representative submits the organization's details.
2.  **Offer:** The `HostingManager` creates a provisional tenant record (`status: 'pending'`) and returns a formal `Offer` for the `test` service (cost may be zero).
3.  **Order (`POST /host/cds-{jurisdiction}/v1/test/registry/org.schema/Order/_batch`):** The representative accepts the `Offer`.
4.  **Final State (Phase 1):** The `HostingManager` provisions the tenant's vault and keys, and persists the final `OrganizationConfig` with the following state:
    *   `status: 'active'` (The gateway account is now fully active).
    *   `networkStatus: [{ networkName: 'test', status: 'active', ... }]` (The organization is immediately granted access to the test network).

##### **Phase 2: Production Network Enrollment (Responsibility: `NetworkEnrollmentManager`)**

This is a separate, more rigorous flow that begins only after Phase 1 is complete. It is treated "like a new registration for production."

1.  **Trigger (`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch` for Production):** An authorized controller for the now `test`-active organization submits a new `Order`. This `Order` accepts an `Offer` for the "Production Network Verification and Enrollment Service". The payment for this order triggers the real-world verification process.
2.  **Out-of-Band Verification:** The payment confirmation initiates an internal workflow for a regional Intermediary Certification Authority (ICA). This may involve manual checks of legal documents.
3.  **Issuance of Credentials:** Upon successful verification:
    *   The Governing Body or ICA signs a `vc.json` credential for the organization. This credential may be published to a public repository (e.g., GitHub) for discovery.
    *   A one-time `ActivationCode` is generated and sent to the organization's physical address via postal mail as a final security step.
4.  **Activation (`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate`):** The organization's controller receives the physical `ActivationCode` and submits it to a dedicated activation endpoint.
5.  **Final State (Phase 2):** The `FabricActivationManager` validates the code. On success, it finds the organization's `OrganizationConfig` document and **pushes a new entry** into its `networkStatus` array:
    *   `networkStatus: [`<br>
        `  { networkName: 'test', status: 'active', ... },`  
        `  { networkName: 'production', status: 'active', ... }`  
        `]`

#### 4. Immediate Action Plan

To move forward, we will execute the following steps in order:

1.  **Codify This Blueprint:** Create this `ONBOARDING_ARCHITECTURE_BLUEPRINT.md` file in the root directory.
2.  **Implement the Data Model:** Refactor `src/models/entity.ts` to match the `EntityConfig`/`OrganizationConfig` structure defined above.
3.  **Implement the `HostingManager`:** Perform a full-file replacement of `src/managers/HostingManager.ts` to correctly implement its role as defined in **Phase 1**. The code will be heavily commented to make the architectural boundaries and the handoff to the production enrollment flow explicitly clear.
4.  **Verify:** Run `npx tsc --noEmit` and then the `organizationApi.test.ts` integration test to confirm that the entire Phase 1 flow is working correctly and the data is persisted in the new, correct format.
