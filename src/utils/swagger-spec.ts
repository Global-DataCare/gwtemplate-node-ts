import swaggerJSDoc from 'swagger-jsdoc';

export type SwaggerSpec = Record<string, any>;

export async function generateSwaggerSpec(): Promise<SwaggerSpec> {
  // @ts-expect-error - `swagger.config.cjs` is a runtime-only CommonJS config file.
  const swaggerConfig = await import('../../swagger.config.cjs');
  const { options, swaggerDefinition } = (swaggerConfig as any).default ?? swaggerConfig;

  // Same source of truth as docs/tests.
  const examples = await import('../__tests__/data/example-payloads');

  swaggerDefinition.components.schemas.OrganizationRegistrationLegacy.example =
    examples.ORGANIZATION_REGISTRATION_REQUEST;
  swaggerDefinition.components.schemas.EmployeeCreationLegacy.example =
    examples.EMPLOYEE_REGISTRATION_REQUEST;
  swaggerDefinition.components.schemas.CustomerCreationLegacy.example =
    examples.CUSTOMER_ONBOARDING_MESSAGE;
  swaggerDefinition.components.schemas.ConsentCreation.example = examples.CONSENT_CREATION_MESSAGE;
  swaggerDefinition.components.schemas.CommunicationCreation.example =
    examples.COMMUNICATION_CREATION_MESSAGE;
  swaggerDefinition.components.schemas.RelatedPersonCreation.example =
    examples.FAMILY_MEMBER_RELATIONSHIP_MESSAGE;
  swaggerDefinition.components.schemas.ObservationCreation.example =
    examples.PERSONAL_OBSERVATION_MESSAGE;
  swaggerDefinition.components.schemas.AsyncPollRequest.example = examples.ASYNC_POLL_REQUEST;
  swaggerDefinition.components.schemas.AsyncPollPending.example = examples.ASYNC_POLL_PENDING_RESPONSE;
  swaggerDefinition.components.schemas.AsyncPollSecureResponse.example = examples.ASYNC_POLL_SECURE_RESPONSE_FORM;

  swaggerDefinition.components.examples.OrganizationRegistrationPlaintextMessage.value =
    examples.ORGANIZATION_REGISTRATION_REQUEST;
  swaggerDefinition.components.examples.OrganizationOrderPlaintextMessage.value =
    examples.ORGANIZATION_ORDER_REQUEST;
  swaggerDefinition.components.examples.OrganizationOrderResponseBundle.value =
    examples.ORGANIZATION_ORDER_RESPONSE;
  swaggerDefinition.components.examples.InitialAccessTokenExchangePlaintextMessage.value =
    examples.INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST;
  swaggerDefinition.components.examples.LicenseIssuePlaintextMessage.value =
    examples.LICENSE_ISSUE_REQUEST;
  swaggerDefinition.components.examples.FirebaseCustomTokenPlaintextMessage.value =
    examples.FIREBASE_CUSTOM_TOKEN_REQUEST;
  swaggerDefinition.components.examples.DeviceRegistrationPlaintextMessage.value =
    examples.DEVICE_REGISTRATION_REQUEST;
  swaggerDefinition.components.examples.SmartTokenRequestPlaintextMessage.value =
    examples.SMART_TOKEN_REQUEST;
  swaggerDefinition.components.examples.EmployeeRegistrationPlaintextMessage.value =
    examples.EMPLOYEE_REGISTRATION_REQUEST;
  swaggerDefinition.components.examples.FamilyRegistrationPlaintextMessage.value =
    examples.FAMILY_REGISTRATION_REQUEST;
  swaggerDefinition.components.examples.FamilyOrderPlaintextMessage.value =
    examples.FAMILY_ORDER_REQUEST;
  swaggerDefinition.components.examples.CustomerOnboardingPlaintextMessage.value =
    examples.CUSTOMER_ONBOARDING_MESSAGE;
  swaggerDefinition.components.examples.ConsentCreationPlaintextMessage.value =
    examples.CONSENT_CREATION_MESSAGE;
  swaggerDefinition.components.examples.CommunicationCreationPlaintextMessage.value =
    examples.COMMUNICATION_CREATION_MESSAGE;
  swaggerDefinition.components.examples.CompositionUpdatePlaintextMessage.value =
    examples.COMPOSITION_UPDATE_MESSAGE;
  swaggerDefinition.components.examples.PersonalObservationPlaintextMessage.value =
    examples.PERSONAL_OBSERVATION_MESSAGE;
  swaggerDefinition.components.examples.FamilyMemberRelationshipPlaintextMessage.value =
    examples.FAMILY_MEMBER_RELATIONSHIP_MESSAGE;
  swaggerDefinition.components.examples.AsyncPollRequest.value = examples.ASYNC_POLL_REQUEST;
  swaggerDefinition.components.examples.AsyncPollPending.value = examples.ASYNC_POLL_PENDING_RESPONSE;
  swaggerDefinition.components.examples.AsyncPollSecureResponse.value = examples.ASYNC_POLL_SECURE_RESPONSE_FORM;

  return swaggerJSDoc({
    swaggerDefinition,
    apis: options.apis,
  }) as SwaggerSpec;
}
