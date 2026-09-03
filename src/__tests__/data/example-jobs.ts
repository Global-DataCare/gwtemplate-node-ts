// TDD contract: write this test red first; make it green only with the complete real behavior.
// src/__tests__/data/example-jobs.ts
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { GatewayRouteFormats, GatewayRouteSections } from 'gdc-common-utils-ts/constants/gateway-response';
import { IdentityAuthActions, IdentityAuthRouteSegments } from 'gdc-common-utils-ts/constants/identity-auth';
import { SchemaOrgTypes } from 'gdc-common-utils-ts/constants/schemaorg';
import { EXAMPLE_JURISDICTION, EXAMPLE_ROUTE_VERSION, EXAMPLE_TENANT_IDENTIFIER } from 'gdc-common-utils-ts/examples/shared';
import { buildGwCoreTenantResourceActionPath } from 'gdc-common-utils-ts/utils/gw-core-path';

import { v4 as uuidv4 } from 'uuid';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { JobAction, Sector } from 'gdc-common-utils-ts/models/urlPath';
import { DEVICE_REGISTRATION_REQUEST, ORGANIZATION_ORDER_REQUEST, ORGANIZATION_REGISTRATION_REQUEST } from './example-payloads';

/**
 * A full, canonical JobRequest object for a Device Registration job.
 * This is the object that the worker process receives.
 */
export const DCR_REGISTRATION_JOB: JobRequest = {
  id: uuidv4(),
  status: JobStatus.DRAFT,
  sequence: 0,
  createdAtTimestamp: Date.now(),
  content: DEVICE_REGISTRATION_REQUEST,
  sector: Sector.TEST,
  section: GatewayRouteSections.Identity,
  format: GatewayRouteFormats.OpenId,
  resourceType: ResourceTypesFhirR4.Device,
  action: IdentityAuthActions.Dcr,
  tenantId: EXAMPLE_TENANT_IDENTIFIER,
};

/**
 * Canonical JobRequest for a Tenant Organization registration, mirroring the
 * example payloads documented in the API Integrators Guide.
 */
export const ORGANIZATION_REGISTRATION_JOB: JobRequest = {
  id: uuidv4(),
  status: JobStatus.DRAFT,
  sequence: 0,
  createdAtTimestamp: Date.now(),
  content: ORGANIZATION_REGISTRATION_REQUEST,
  sector: Sector.TEST,
  section: GatewayRouteSections.Registry,
  format: GatewayRouteFormats.SchemaOrg,
  action: JobAction._batch,
  resourceType: ResourceTypesFhirR4.Organization,
  tenantId: IdentityAuthRouteSegments.Host,
};

/**
 * Canonical JobRequest for a Tenant Organization order confirmation, mirroring the
 * example payloads documented in the API Integrators Guide.
 */
export const ORGANIZATION_ORDER_JOB: JobRequest = {
    ...ORGANIZATION_REGISTRATION_JOB,
    resourceType: SchemaOrgTypes.Order,
    content: ORGANIZATION_ORDER_REQUEST,
    requestUrl: buildGwCoreTenantResourceActionPath({
      tenantId: IdentityAuthRouteSegments.Host,
      jurisdiction: EXAMPLE_JURISDICTION.toLowerCase(),
      version: EXAMPLE_ROUTE_VERSION,
      sector: Sector.TEST,
      section: GatewayRouteSections.Registry,
      format: GatewayRouteFormats.SchemaOrg,
      resourceType: SchemaOrgTypes.Order,
      action: JobAction._batch,
    }),
};
