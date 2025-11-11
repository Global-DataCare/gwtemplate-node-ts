// scripts/generate-swagger-spec.js
/* eslint-disable @typescript-eslint/no-var-requires */

// Use ts-node to allow this script to import TypeScript files,
// respecting the project's own tsconfig.json.
require('ts-node').register();

const swaggerJSDoc = require('swagger-jsdoc');
const fs = require('fs');
const path = require('path');

// We need to load the original swagger.config.js to get the options
const { options, swaggerDefinition } = require('../swagger.config.js');

// --- Single Source of Truth ---
// Import the example payloads from our TypeScript source of truth.
const {
  ORGANIZATION_REGISTRATION_PAYLOAD,
  EMPLOYEE_REGISTRATION_PAYLOAD,
  CUSTOMER_ONBOARDING_PAYLOAD,
  CONSENT_PAYLOAD,
  COMMUNICATION_PAYLOAD,
} = require('../src/__tests__/data/example-payloads.ts');

// --- Dynamic Injection ---
// Inject the imported payloads into the Swagger definition as examples.
swaggerDefinition.components.schemas.OrganizationRegistrationLegacy.example = ORGANIZATION_REGISTRATION_PAYLOAD;
swaggerDefinition.components.schemas.EmployeeCreationLegacy.example = EMPLOYEE_REGISTRATION_PAYLOAD;
swaggerDefinition.components.schemas.CustomerCreationLegacy.example = CUSTOMER_ONBOARDING_PAYLOAD;
swaggerDefinition.components.schemas.ConsentCreation.example = CONSENT_PAYLOAD;
swaggerDefinition.components.schemas.CommunicationCreation.example = COMMUNICATION_PAYLOAD;


// swaggerJSDoc uses the final, modified options to generate the spec
const swaggerSpec = swaggerJSDoc({
  swaggerDefinition: swaggerDefinition, // Pass the modified definition
  apis: options.apis,
});

const outputPath = path.resolve(__dirname, '../swagger-spec.json');

fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2));

console.log(`✅ Swagger specification generated with dynamic examples at: ${outputPath}`);

