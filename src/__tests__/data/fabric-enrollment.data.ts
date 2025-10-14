// src/__tests__/data/fabric-enrollment.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { MldsaPublicJwk } from '../../crypto/interfaces/Cryptography.types';
import { ClaimsActionSchemaorg } from '../../models/schemaorg';
import { DidDocument } from '../../models/did';
import { DecodedDidcommMessage } from '../../models/request';
import { testTenant1Data, testClaimsTenant1Registration } from './end-to-end.data';
import { testHostDidWeb, testTenant1DidWebExternal, testTenant1DidWebHosted } from './organization.data';

// ACTORS
export const testEmployeeUrnControllerT = 'did:web:controller-t.example.com';
export const testFabricInitialNetworkUrn = 'urn:antifraud:fabric:test-network';

export const testTenantC_DidDocument: DidDocument = {
  '@context': 'https://www.w3.org/ns/did/v1',
  id: testTenant1DidWebHosted, // DID of Tenant C
  alsoKnownAs: [testTenant1DidWebExternal],
  verificationMethod: [ /* ... */ ],
  assertionMethod: [
    // This entry is the key to the authorization logic. It grants Controller T
    // permission to make assertions on behalf of Tenant C.
    {
      id: `${testEmployeeUrnControllerT}#key-1`,
      type: 'JsonWebKey2020',
      controller: testEmployeeUrnControllerT,
      publicKeyJwk:  {
        kty: 'AKP',
        alg: 'ML-DSA-44',
        pub: 'placeholder-public-key-for-controller-t', // Using 'pub' for ML-DSA signature key
      } as MldsaPublicJwk,
    },
  ],
  authentication: [ /* ... */ ],
};

// FLAT CLAIMS FOR THE ACTION
export const testFabricEnrollmentClaims = {
  // The Agent is Tenant C. We prefix all its claims with 'org.schema.Action.agent.'
  ...Object.entries(testClaimsTenant1Registration).reduce((acc, [key, value]) => {
    acc[`org.schema.Action.agent.${key.replace('org.schema.Organization.', '')}`] = value;
    return acc;
  }, {} as any),
  [ClaimsActionSchemaorg.agentIdentifier]: testTenant1Data.identifier, // URN of Tenant C

  // The Participant is Controller T
  [ClaimsActionSchemaorg.participantIdentifier]: testEmployeeUrnControllerT,

  // The Provider is the Fabric Network
  [ClaimsActionSchemaorg.providerIdentifier]: testFabricInitialNetworkUrn,
  [ClaimsActionSchemaorg.providerName]: 'Antifraud Test Network',

  // The Start Time of the action
  [ClaimsActionSchemaorg.startTime]: new Date().toISOString(),
};

// JOB REQUEST PAYLOAD
export const testFabricEnrollmentRequestBody = {
  data: [{
    type: 'Fabric-enrollment-request-v1.0',
    meta: {
      claims: testFabricEnrollmentClaims,
    },
  }],
};

export const testFabricEnrollmentJobInput: DecodedDidcommMessage = {
  aud: testHostDidWeb, // <-- The reques is to the host's `registry` URL, but not to the tenant's `entity` URL
  iss: testEmployeeUrnControllerT, // The request is signed by the participant
  thid: 'test-thid-fabric-enrollment',
  type: 'api+json',
  body: testFabricEnrollmentRequestBody,
};