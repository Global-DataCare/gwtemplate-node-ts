// swagger.config.js
const { 
  ORGANIZATION_REGISTRATION_MESSAGE,
  EMPLOYEE_REGISTRATION_MESSAGE,
  CUSTOMER_ONBOARDING_MESSAGE,
  CONSENT_CREATION_MESSAGE,
  COMMUNICATION_CREATION_MESSAGE
} = require('./src/__tests__/data/example-payloads');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Gateway API',
    version: '1.0.0',
    description: 'API documentation for the secure gateway, covering both legacy (JSON) and secure (JWE) flows.',
  },
  servers: [],
  // Apply the security scheme globally to all operations
  security: [
    {
      BearerAuth: []
    }
  ],
  // Add components for reusable schemas, parameters, etc.
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Bearer token for legacy (JSON) requests. Use the demo tokens from the cURL guide.'
      }
    },
    parameters: {
      TenantId: {
        name: 'tenantId',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'acme' },
        description: "The unique 'alternateName' of the tenant."
      },
      Jurisdiction: {
        name: 'jurisdiction',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'ES' },
        description: 'The jurisdiction code (e.g., country code).'
      },
      Sector: {
        name: 'sector',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'health-care' },
        description: 'The business sector.'
      }
    },
    // Define reusable examples here
    examples: {
      OrganizationRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Organization Registration',
        description: 'A DIDComm-like message wrapper containing the registration claims. This is the format for `application/didcomm-plaintext+json`.',
        value: ORGANIZATION_REGISTRATION_MESSAGE
      },
      EmployeeRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Employee Registration',
        description: 'A DIDComm-like message wrapper containing the employee claims.',
        value: EMPLOYEE_REGISTRATION_MESSAGE
      },
      CustomerOnboardingPlaintextMessage: {
        summary: 'Plaintext Message for Customer Onboarding',
        description: 'A DIDComm-like message wrapper containing the customer claims.',
        value: CUSTOMER_ONBOARDING_MESSAGE
      },
      ConsentCreationPlaintextMessage: {
        summary: 'Plaintext Message for FHIR Consent Creation',
        description: 'A DIDComm-like message wrapper containing a FHIR Consent resource in the `body`.',
        value: CONSENT_CREATION_MESSAGE
      },
      CommunicationCreationPlaintextMessage: {
        summary: 'Plaintext Message for FHIR Communication',
        description: 'A DIDComm-like message wrapper containing a FHIR Communication resource in the `body`.',
        value: COMMUNICATION_CREATION_MESSAGE
      }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          resourceType: {
            type: 'string',
            example: 'OperationOutcome',
          },
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
      // --- Reusable Request Body Schemas ---
      // These schemas are now just for structure, the examples are separate
      OrganizationRegistrationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' }
        }
      },
      EmployeeCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' }
        }
      },
      CustomerCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' }
        }
      },
      SecureRequest: {
        type: 'object',
        description: 'A JWE-encrypted payload, sent as a form parameter.',
        properties: {
          request: {
            type: 'string',
            format: 'jwe',
            example: 'ey...'
          }
        }
      },
      ConsentCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' }
        }
      },
      CommunicationCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' }
        }
      }
    }
  }
};

const options = {
  swaggerDefinition,
  // Path to the API docs; routes files with JSDoc comments (recursive)
  apis: ['./src/routes/**/*.ts'],
};

// Export both the options and the definition separately for reuse in other scripts.
module.exports = {
  options,
  swaggerDefinition,
  // We also export the definition directly for convenience in the spec generator
  ...swaggerDefinition 
};
