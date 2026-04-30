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
  const normalizedActionRaw = String(action || '');
  const normalizedAction = normalizedActionRaw === '_verify' ? '_batch' : normalizedActionRaw;
  const normalizedSector = String(sector || '').toLowerCase();

  if (!normalizedSection || !normalizedFormat || !normalizedResourceType || !normalizedAction) {
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

    const resourceAllowed = String(service.serviceEndpoint || '')
      .split(',')
      .map((r) => r.trim().toLowerCase())
      .includes(normalizedResourceType);
    if (!resourceAllowed) return false;

    const actionAllowed = (service.actions || []).includes(normalizedAction);
    return actionAllowed;
  });
}
