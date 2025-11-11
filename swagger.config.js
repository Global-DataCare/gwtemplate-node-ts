// swagger.config.js
const swaggerJSDoc = require('swagger-jsdoc');

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
      OrganizationRegistrationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string', example: 'thid-org-c1c2c3d4-e5f6-7890-1234-567890abcdef' },
          iss: { type: 'string', example: 'admin1@acme.org' },
          aud: { type: 'string', example: 'did:web:host.example.com' },
          body: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', example: 'Organization-registration-form-v1.0' },
                    meta: {
                      type: 'object',
                      properties: {
                        claims: {
                          type: 'object',
                          properties: {
                            'org.schema.Organization.legalName': { type: 'string', example: 'Acme Organization' },
                            'org.schema.Organization.identifier.additionalType': { type: 'string', example: 'TAX' },
                            'org.schema.Organization.identifier.value': { type: 'string', example: 'A123456789' },
                            'org.schema.Organization.alternateName': { type: 'string', example: 'acme' },
                            'org.schema.Organization.address.addressCountry': { type: 'string', example: 'ES' },
                            'org.schema.Person.email': { type: 'string', example: 'admin1@acme.org' },
                            'org.schema.Service.category': { type: 'string', example: 'health-care' },
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      EmployeeCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string', example: 'thid-employee-11b2c3d4-e5f6-7890-1234-567890abcdef' },
          iss: { type: 'string', example: 'did:web:host.example.com:acme:...' },
          aud: { type: 'string', example: 'did:web:host.example.com' },
          body: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', example: 'Employee-form-v1.0' },
                    request: {
                      type: 'object',
                      properties: {
                        method: { type: 'string', example: 'POST' },
                        url: { type: 'string', example: 'entity/org.schema/Employee/' }
                      }
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        claims: {
                          type: 'object',
                          properties: {
                            'org.schema.Person.identifier': { type: 'string', example: 'urn:uuid:11b2c3d4-e5f6-7890-1234-567890abcdef' },
                            'org.schema.Person.hasOccupation': { type: 'string', example: 'ISCO-08:4226' },
                            'org.schema.Person.email': { type: 'string', example: 'receptionist1@acme.org' },
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      CustomerCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string', example: 'thid-e2e-onboarding-customer-12345' },
          iss: { type: 'string', example: 'did:web:api.acme.org:employee:...' },
          aud: { type: 'string', example: 'urn:antifraud:health-care:acme' },
          body: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                description: 'An array of forms/claims for the customer.',
                items: {
                  type: 'object',
                  properties: {
                     type: { type: 'string', example: 'Individual-terms-v1.0' },
                     // ... Simplified for brevity
                  }
                }
              }
            }
          }
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
          thid: { type: 'string', example: 'thid-consent-dynamic' },
          iss: { type: 'string', example: 'did:web:api.acme.org:employee:...' },
          aud: { type: 'string', example: 'urn:antifraud:health-care:acme' },
          body: {
            type: 'object',
            properties: {
              resourceType: { type: 'string', example: 'Consent' },
              // ... other Consent properties
            }
          }
        }
      },
      CommunicationCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string', example: 'thid-comm-dynamic' },
          iss: { type: 'string', example: 'did:web:api.acme.org:employee:...' },
          aud: { type: 'string', example: 'urn:antifraud:health-care:acme' },
          body: {
            type: 'object',
            properties: {
              resourceType: { type: 'string', example: 'Communication' },
              // ... other Communication properties
            }
          }
        }
      }
    },
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer token for legacy (JSON) requests.'
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
};

