// swagger.config.cjs (CommonJS so tooling can `require()` it regardless of package type)

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Gateway API',
    version: '1.0.3',
    description:
      'API documentation for the secure gateway, covering both legacy (JSON) and secure (JWE) flows.',
  },
  servers: [],
  security: [{ BearerAuth: [] }],
  tags: [
    {
      name: '1.1 Organization Registration',
      description: 'Step 1 (Offer): register a new tenant (organization) on the host.',
    },
    {
      name: '1.2 Organization Order',
      description: 'Step 2 (Order): accept the registration offer and obtain payment/checkout.',
    },
    {
      name: '2.1.4 License Issuance (Invite)',
      description: 'Issue an invite for license activation (host or tenant licensing flow).',
    },
    {
      name: '2.1.2 Initial Access Token Exchange',
      description: 'Exchange activation code + Firebase id_token for initial_access_token (DCR).',
    },
    {
      name: '2.1.3 Device Registration (DCR)',
      description: 'Register device keys / client_id using OpenID Dynamic Client Registration.',
    },
    {
      name: '2.2 OIDC4VCI',
      description: 'Issue Gaia-X compliance credentials via OIDC4VCI.',
    },
    {
      name: '2.2 SMART Token',
      description: 'Step 4: request SMART access tokens (scoped) for a single subject context.',
    },
    {
      name: '3.1 Employee Role',
      description: 'Step 5: create employee/role resources under a tenant.',
    },
    {
      name: '4.1 Family Registration',
      description: 'Step 6 (Offer): register a family organization/household under a tenant.',
    },
    {
      name: '4.2 Family Order',
      description: 'Step 6a (Order): accept the family registration offer.',
    },
    {
      name: '4.3 Family Member Relationship',
      description: 'Step 6b: register family members / emergency contacts (RelatedPerson).',
    },
    {
      name: '5. Consent',
      description: 'Step 7: create consent rules (FHIR Consent).',
    },
    {
      name: '6. Communication',
      description: 'Step 8: send secure communications (FHIR Communication).',
    },
    {
      name: '7. Composition',
      description: 'Step 9: update the Unified Health Index (FHIR Composition).',
    },
    {
      name: '8.4 Personal Observations',
      description: 'Collect self-reported, non-clinical observations for emergency/care continuity.',
    },
    {
      name: 'Discovery',
      description: 'Well-known and discovery endpoints.',
    },
    {
      name: 'Data Catalog Discovery',
      description: 'DCAT-3 catalog discovery endpoints (`/dcat3/catalog/...`) for operator/provider dataset lookup.',
    },
    {
      name: 'Async Polling',
      description:
        'Polling endpoints (`_batch-response`) used to retrieve the final result of asynchronous jobs.',
    },
    {
      name: '2.1.1 Frontend Identity Federation (Optional)',
      description:
        'Optional pre-step: federate an external OIDC id_token (e.g. eIDAS) into Firebase when the frontend does not already have a Firebase id_token.',
    },
    {
      name: '99. Legacy / Internal',
      description: 'Deprecated or internal endpoints kept for backward compatibility.',
    },
  ],
  'x-tagGroups': [
    {
      name: '1. Onboarding a New Organization',
      tags: ['1.1 Organization Registration', '1.2 Organization Order'],
    },
    {
      name: '2. Device and Identity Registration',
      tags: [
        '2.1.4 License Issuance (Invite)',
        '2.1.2 Initial Access Token Exchange',
        '2.1.3 Device Registration (DCR)',
        '2.2 OIDC4VCI',
        '2.2 SMART Token',
      ],
    },
    {
      name: '3. Tenant Operations',
      tags: [
        '3.1 Employee Role',
      ],
    },
    {
      name: '4. Family Onboarding',
      tags: ['4.1 Family Registration', '4.2 Family Order', '4.3 Family Member Relationship'],
    },
    {
      name: '5–7. Individual Data Flows',
      tags: ['5. Consent', '6. Communication', '7. Composition'],
    },
    {
      name: '8. Personal Data',
      tags: ['8.4 Personal Observations'],
    },
    {
      name: 'Other',
      tags: [
        'Discovery',
        'Data Catalog Discovery',
        '2.1.1 Frontend Identity Federation (Optional)',
        '99. Legacy / Internal',
      ],
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          [
            'Bearer token used by legacy (JSON) flows and some onboarding steps.',
            '',
            'Demo/Test-Network note: in non-production environments signature checks may be bypassed, but token format must still be JWT-like (`header.payload.signature`).',
            'Example token you can paste in Swagger "Authorize": `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJkZW1vLXVzZXIiLCJlbWFpbCI6ImRlbW9AZXhhbXBsZS5vcmcifQ.demo`.',
            '',
            'Production note: token validation is environment-dependent and typically expects a Firebase id_token for end-user identity.',
          ].join('\n'),
      },
    },
    parameters: {
      AppId: {
        name: 'App-ID',
        in: 'header',
        required: true,
        schema: { type: 'string', example: 'com.acme.myapp' },
        description:
          "Reverse-DNS application identifier (similar to Apple Bundle ID). For web apps, use a stable reverse-DNS identifier (e.g. 'org.example.webapp').",
      },
      AppVersion: {
        name: 'App-Version',
        in: 'header',
        required: true,
        schema: { type: 'string', example: '1.0.0' },
        description: 'User-facing application version (semver recommended).',
      },
      TenantId: {
        name: 'tenantId',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'acme' },
        description: "The unique 'alternateName' of the tenant.",
      },
      Jurisdiction: {
        name: 'jurisdiction',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'ES' },
        description:
          "The provider/tenant jurisdiction code within the host-operated infrastructure (e.g., country code like 'ES' or a subdivision like 'ES-CT').",
      },
      Version: {
        name: 'version',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'v1' },
        description: 'API version segment (e.g., v1).',
      },
      Sector: {
        name: 'sector',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'health-care' },
        description: 'The business sector.',
      },
      HostRegistrySector: {
        name: 'sector',
        in: 'path',
        required: true,
        schema: { type: 'string', enum: ['test', 'test-network', 'network'], example: 'test' },
        description:
          'Host onboarding "network environment" sector. demo/test→test, development/staging→test-network, production→network.',
      },
    },
    examples: {
      OrganizationRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Organization Registration',
        description:
          'A DIDComm-like message wrapper containing the registration claims. This is the format for `application/didcomm-plaintext+json`.',
        value: {},
      },
      OrganizationOrderPlaintextMessage: {
        summary: 'Plaintext Message for Organization Order',
        description:
          'A DIDComm-like message wrapper accepting an Offer via an Order. Order.acceptedOffer.identifier is required and must match the full Offer identifier URN returned by the Organization registration _batch-response (use {{offerId}} placeholder in Swagger UI).',
        value: {},
      },
      OrganizationOrderResponseBundle: {
        summary: 'Organization Order Response Bundle',
        description:
          'Async Order response bundle with Organization-order-response-v1.0, org.schema.Order.* invoice/payment claims and org.schema.IndividualProduct.* activation claims.',
        value: {},
      },
      InitialAccessTokenExchangePlaintextMessage: {
        summary: 'Plaintext Message for Initial Access Token Exchange',
        description:
          'A DIDComm-like message wrapper containing `subject_token` (activation code). `subject_token` must be a JSON string (quoted); use {{activationCode}} placeholder in Swagger UI.',
        value: {},
      },
      LicenseIssuePlaintextMessage: {
        summary: 'Plaintext Message for License Issue',
        description:
          'A DIDComm-like message wrapper reserving a seat and issuing an activation code. User licenses can issue multiple device-profile codes; device licenses only issue one.',
        value: {},
      },
      LicenseIssueExistingEmployeePlaintextMessage: {
        summary: 'Plaintext Message for License Issue (Existing Employee)',
        description:
          'Reserves a seat and issues an activation code for an employee already registered in the tenant (e.g., admin/legal representative adding another device).',
        value: {},
      },
      FirebaseCustomTokenPlaintextMessage: {
        summary: 'Plaintext Message for Firebase Custom Token Federation',
        description: 'A DIDComm-like message wrapper containing `provider` + `id_token`.',
        value: {},
      },
      DeviceRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Device Registration (DCR)',
        description: 'A DIDComm-like message wrapper containing the OpenID DCR request body.',
        value: {},
      },
      SmartTokenRequestPlaintextMessage: {
        summary: 'Plaintext Message for SMART Token Request',
        description: 'A DIDComm-like message wrapper containing the SMART token request (scope, sub, etc.).',
        value: {},
      },
      EmployeeRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Employee Registration',
        description: 'A DIDComm-like message wrapper containing the employee claims.',
        value: {},
      },
      FamilyRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Family Registration',
        description: 'A DIDComm-like message wrapper containing the family organization claims.',
        value: {},
      },
      FamilyOrderPlaintextMessage: {
        summary: 'Plaintext Message for Family Order',
        description:
          'A DIDComm-like message wrapper accepting the family registration Offer. Order.acceptedOffer.identifier is required and must match the Offer ID returned by the family registration _batch-response.',
        value: {},
      },
      ConsentCreationPlaintextMessage: {
        summary: 'Plaintext Message for FHIR Consent Creation',
        description:
          'A DIDComm-like message wrapper containing a FHIR Consent resource in the `body`.',
        value: {},
      },
      CommunicationCreationPlaintextMessage: {
        summary: 'Plaintext Message for FHIR Communication',
        description:
          'A DIDComm-like message wrapper containing a FHIR Communication resource in the `body`.',
        value: {},
      },
      CompositionUpdatePlaintextMessage: {
        summary: 'Plaintext Message for FHIR Composition Update',
        description:
          'A DIDComm-like message wrapper containing a FHIR Composition bundle entry in the `body`.',
        value: {},
      },
      FamilyMemberRelationshipPlaintextMessage: {
        summary: 'Plaintext Message for Family Member Relationship',
        description:
          'A DIDComm-like message wrapper registering an emergency contact / family relationship (RelatedPerson) using `org.hl7.fhir.api` claims.',
        value: {},
      },
      PersonalObservationPlaintextMessage: {
        summary: 'Plaintext Message for Personal Observations',
        description:
          'A DIDComm-like message wrapper collecting self-reported (non-clinical) observations using `org.hl7.fhir.api` claims.',
        value: {},
      },
      CustomerOnboardingPlaintextMessage: {
        summary: '(Legacy) Plaintext Message for Person/Customer Onboarding',
        description: 'Legacy flow: DIDComm-like message wrapper containing Person onboarding claims.',
        value: {},
      },
      AsyncPollRequest: {
        summary: 'Async Poll Request',
        description: 'HTTP polling request body (JSON) containing the `thid` from the original submission.',
        value: { thid: 'request-thid' },
      },
      OrganizationRegistrationPollRequest: {
        summary: 'Organization Registration Poll Request',
        description: 'Polls the Organization registration job using the same `thid` from the Organization _batch request.',
        value: { thid: 'org-registration-thread-<test-id>' },
      },
      OrganizationOrderPollRequest: {
        summary: 'Organization Order Poll Request',
        description: 'Polls the Order job using the same `thid` from the Order _batch request.',
        value: { thid: 'org-order-thread-<test-id>' },
      },
      EmployeePollRequest: {
        summary: 'Employee Poll Request',
        description: 'Polls the Employee job using the same `thid` from the Employee _batch request.',
        value: { thid: 'employee-thread-<test-id>' },
      },
      PersonPollRequest: {
        summary: 'Person Poll Request',
        description: 'Polls the Person job using the same `thid` from the Person _batch request.',
        value: { thid: 'person-thread-<test-id>' },
      },
      ConsentPollRequest: {
        summary: 'Consent Poll Request',
        description: 'Polls the Consent job using the same `thid` from the Consent _batch request.',
        value: { thid: 'consent-thread-<test-id>' },
      },
      CommunicationPollRequest: {
        summary: 'Communication Poll Request',
        description: 'Polls the Communication job using the same `thid` from the Communication _batch request.',
        value: { thid: 'communication-thread-<test-id>' },
      },
      TokenExchangePollRequest: {
        summary: 'Token Exchange Poll Request',
        description: 'Polls the initial access token exchange job using the same `thid` from Token/_exchange.',
        value: { thid: 'token-exchange-thread-<test-id>' },
      },
      CompositionPollRequest: {
        summary: 'Composition Poll Request',
        description: 'Polls the Composition job using the same `thid` from the Composition _batch request.',
        value: { thid: 'composition-thread-<test-id>' },
      },
      RelatedPersonPollRequest: {
        summary: 'RelatedPerson Poll Request',
        description: 'Polls the RelatedPerson job using the same `thid` from the RelatedPerson _batch request.',
        value: { thid: 'relatedperson-thread-<test-id>' },
      },
      ObservationPollRequest: {
        summary: 'Observation Poll Request',
        description: 'Polls the Observation job using the same `thid` from the Observation _batch request.',
        value: { thid: 'observation-thread-<test-id>' },
      },
      TenantOrganizationPollRequest: {
        summary: 'Tenant Organization Poll Request',
        description: 'Polls the tenant Organization job using the same `thid` from the Organization _batch request.',
        value: { thid: 'tenant-organization-thread-<test-id>' },
      },
      TenantOrderPollRequest: {
        summary: 'Tenant Order Poll Request',
        description: 'Polls the tenant Order job using the same `thid` from the Order _batch request.',
        value: { thid: 'tenant-order-thread-<test-id>' },
      },
      AsyncPollPending: {
        summary: 'Async Poll Pending Response',
        description: 'HTTP polling response while the job is still running (`202 Accepted`).',
        value: { thid: 'request-thid', status: 'PENDING' },
      },
      AsyncPollSecureResponse: {
        summary: 'Async Poll Secure Response',
        description:
          'Polling response format for secure flows (`application/x-www-form-urlencoded`), returning `response=<jwe>`.',
        value: {},
      },
    },
    schemas: {
      DidcommPlaintextMessage: {
        type: 'object',
        required: ['jti', 'thid', 'iss', 'aud', 'type', 'body'],
        properties: {
          jti: { type: 'string' },
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          type: { type: 'string' },
          body: { type: 'object' },
          meta: { type: 'object' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          resourceType: { type: 'string', example: 'OperationOutcome' },
          issue: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', example: 'error' },
                code: { type: 'string', example: 'not-found' },
                diagnostics: { type: 'string' },
              },
            },
          },
        },
      },
      OrganizationRegistrationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      EmployeeCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      CustomerCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      SecureRequest: {
        type: 'object',
        description: 'A JWE-encrypted payload, sent as a form parameter.',
        properties: {
          request: {
            type: 'string',
            format: 'jwe',
            example: 'ey...',
          },
        },
      },
      AsyncPollRequest: {
        type: 'object',
        required: ['thid'],
        description:
          'Polling request body for asynchronous jobs. The `thid` must match the thread id from the corresponding request (e.g., registration vs order).',
        properties: {
          thid: { type: 'string', example: 'request-thid' },
        },
        example: { thid: 'request-thid' },
      },
      AsyncPollPending: {
        type: 'object',
        required: ['thid', 'status'],
        properties: {
          thid: { type: 'string', example: 'request-thid' },
          status: { type: 'string', enum: ['PENDING'], example: 'PENDING' },
        },
      },
      AsyncPollSecureResponse: {
        type: 'object',
        description:
          'Polling response format for secure (FAPI/JARM-style) flows. The encrypted payload is returned in the `response` form parameter.',
        properties: {
          response: {
            type: 'string',
            format: 'jwe',
            example: 'ey...',
          },
        },
      },
      ConsentCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      CommunicationCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      RelatedPersonCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      ObservationCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: ['./src/routes/**/*.ts'],
};

module.exports = {
  options,
  swaggerDefinition,
  ...swaggerDefinition,
};
