// swagger.config.cjs (CommonJS so tooling can `require()` it regardless of package type)

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Gateway API',
    version: '1.0.0',
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
      name: '2.1.1 Identity Federation',
      description:
        'Federate an external OIDC id_token (e.g. eIDAS) into Firebase. This is only needed if you do NOT already have a Firebase id_token (e.g. your app uses another IdP and is not signed into Firebase).',
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
      name: 'Async Polling',
      description:
        'Polling endpoints (`_batch-response`) used to retrieve the final result of asynchronous jobs.',
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
        '2.1.1 Identity Federation',
        '2.1.2 Initial Access Token Exchange',
        '2.1.3 Device Registration (DCR)',
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
      tags: ['Discovery', 'Async Polling', '99. Legacy / Internal'],
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
            'Demo/Test-Network note: in non-production environments the backend may accept any non-empty token for convenience.',
            'Example token you can paste in Swagger "Authorize": `demo-id-token`.',
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
        description: 'A DIDComm-like message wrapper accepting an Offer via an Order.',
        value: {},
      },
      InitialAccessTokenExchangePlaintextMessage: {
        summary: 'Plaintext Message for Initial Access Token Exchange',
        description: 'A DIDComm-like message wrapper containing `subject_token` (activation code).',
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
        description: 'A DIDComm-like message wrapper accepting the family registration Offer.',
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
        value: {},
      },
      AsyncPollPending: {
        summary: 'Async Poll Pending Response',
        description: 'HTTP polling response while the job is still running (`202 Accepted`).',
        value: {},
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
          'Polling request body for asynchronous jobs. The `thid` (thread id) correlates to the original submission.',
        properties: {
          thid: { type: 'string', example: 'org-registration-thread-id' },
        },
        example: { thid: 'org-registration-thread-id' },
      },
      AsyncPollPending: {
        type: 'object',
        required: ['thid', 'status'],
        properties: {
          thid: { type: 'string', example: 'org-registration-thread-id' },
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
