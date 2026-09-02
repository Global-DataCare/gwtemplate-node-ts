// src/utils/request-validator.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidService } from 'gdc-common-utils-ts/models/did';

/**
 * Validates a request against a tenant's service configurations by checking if the requested
 * resource and action are permitted by any of the defined services.
 *
 * @param services The array of DidService from the tenant's configuration.
 * @param params The parameters from the request URL, including sector, section, format, resourceType, and action.
 * @returns True if the request is valid according to the tenant's service definitions, false otherwise.
 */
export function isRequestValid(services: DidService[] | undefined, params: any): boolean {
  const { sector, section, format, resourceType, action } = params;

  if (!services) {
    return false;
  }

  const normalizedSection = String(section || '').toLowerCase();
  const normalizedFormat = String(format || '').toLowerCase();
  const normalizedResourceType = String(resourceType || '').toLowerCase();
  const normalizedAction = String(action || '');
  const normalizedSector = String(sector || '').toLowerCase();

  if (!normalizedSection || !normalizedFormat || !normalizedResourceType || !normalizedAction) {
    return false;
  }
  // License inventory has no direct mutation route. Historical DID documents
  // that advertised `_add` must not revive the removed shortcut.
  if (normalizedResourceType === 'license' && normalizedAction === '_add') {
    return false;
  }

  const getSelectorFromService = (service: DidService): { sector?: string; section?: string; format?: string } => {
    const selector = (service as any).selector as { sector?: string; section?: string; format?: string } | undefined;
    if (selector?.section && selector?.format) {
      return selector;
    }
    const id = String(service.id || '');
    const fragment = id.includes('#') ? id.split('#').pop() : undefined;
    if (fragment) {
      const parts = fragment.split(':').filter(Boolean);
      // Current SDK convention: `#<section>:<format>:<resourceType>:<action>`
      if (parts.length >= 4) {
        return { section: parts[0], format: parts[1] };
      }
      // Minimal convention: `#<section>:<format>`
      if (parts.length === 2) {
        return { section: parts[0], format: parts[1] };
      }
      // Legacy convention: `#<sector>:<section>:<format>`
      if (parts.length === 3) {
        return { sector: parts[0], section: parts[1], format: parts[2] };
      }
    }
    // Legacy format: v1:sector:section:format[:resourceType]
    const parts = (service.id || '').split(':');
    if (parts.length >= 4) {
      return { sector: parts[1], section: parts[2], format: parts[3] };
    }
    return {};
  };

  return services.some((service) => {
    const serviceSelector = getSelectorFromService(service);
    if (serviceSelector.sector && normalizedSector && serviceSelector.sector.toLowerCase() !== normalizedSector) {
      return false;
    }
    if (
      (serviceSelector.section || '').toLowerCase() !== normalizedSection ||
      (serviceSelector.format || '').toLowerCase() !== normalizedFormat
    ) {
      return false;
    }

    const configuredResources = String(service.serviceEndpoint || '')
      .split(',')
      .map((r) => r.trim().toLowerCase());
    const actions = service.actions || [];
    const legacyEmployeeLicenseInventorySelection =
      normalizedSection === 'entity' &&
      normalizedFormat === 'org.schema' &&
      normalizedResourceType === 'license' &&
      normalizedAction === '_search' &&
      configuredResources.includes('employee') &&
      actions.includes('_search');
    const legacyIndividualCommercialLicenseSelection =
      normalizedSection === 'individual' &&
      normalizedFormat === 'org.schema' &&
      normalizedResourceType === 'license' &&
      configuredResources.includes('offer') &&
      configuredResources.includes('order') &&
      actions.includes('_search');
    const legacyIndividualLicenseInventorySelection =
      legacyIndividualCommercialLicenseSelection && normalizedAction === '_search';
    const legacyIndividualMemberLicenseIssueSelection =
      legacyIndividualCommercialLicenseSelection && normalizedAction === '_issue';
    const legacyDigitalTwinResearchSubjectDiscovery =
      normalizedSection === 'digitaltwin' &&
      normalizedResourceType === 'researchsubject' &&
      normalizedAction === '_search' &&
      configuredResources.includes('composition') &&
      actions.includes('_search');
    // Historical tenants published Employee/_search before the associated
    // controller licence inventory endpoint was added. Keep that exact read
    // available without widening any mutation capability.
    const resourceAllowed = configuredResources.includes(normalizedResourceType)
      || legacyEmployeeLicenseInventorySelection
      // Historical individual organizations published their commercial seat
      // pool as Offer/Order search before License inventory became explicit.
      || legacyIndividualLicenseInventorySelection
      // The same historical pool supports the exact member invitation issue
      // action; other licence mutations remain unavailable.
      || legacyIndividualMemberLicenseIssueSelection
      // ResearchSubject replaced Composition as the public twin aggregate.
      // Treat the old read declaration as authorization for that read-only
      // replacement so existing tenants do not need reactivation or DCR.
      || legacyDigitalTwinResearchSubjectDiscovery;
    if (!resourceAllowed) return false;

    const legacyDigitalTwinWorkingSelection =
      normalizedSection === 'digitaltwin' &&
      normalizedResourceType === 'composition' &&
      normalizedAction === '_batch' &&
      actions.includes('_search');
    const employeeWalletRecoverySelection =
      normalizedSection === 'identity' &&
      normalizedFormat === 'openid' &&
      normalizedResourceType === 'token' &&
      normalizedAction === '_recover' &&
      actions.includes('_exchange');
    // Existing tenants may predate the explicit Composition/_batch service
    // declaration. A tenant that already exposes digital-twin Composition
    // search also exposes the researcher working-selection persistence step.
    const actionAllowed = actions.includes(normalizedAction)
      || legacyDigitalTwinWorkingSelection
      || legacyEmployeeLicenseInventorySelection
      || legacyIndividualLicenseInventorySelection
      || legacyIndividualMemberLicenseIssueSelection
      || employeeWalletRecoverySelection;
    return actionAllowed;
  });
}
