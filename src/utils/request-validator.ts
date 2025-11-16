// src/utils/request-validator.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { DidService } from '../models/did';
import { createDidServiceId } from './did';

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
  
  // The service ID in the config could be general (without resourceType) or specific.
  // We construct both possibilities to check against the tenant's service list.
  const baseServiceId = createDidServiceId({ version: 'v1', sector, section, format });
  const specificServiceId = createDidServiceId({ version: 'v1', sector, section, format, resourceType });
  
  // A request is valid if it matches EITHER a specific service definition OR a more general one.
  const matchingService = services.find(s => s.id === specificServiceId || s.id === baseServiceId);

  if (!matchingService) {
    return false;
  }

  const resourceAllowed = (matchingService.serviceEndpoint as string)
    .toLowerCase()
    .split(',')
    .map(r => r.trim())
    .includes(resourceType.toLowerCase());
  const actionAllowed = (matchingService.actions || []).includes(action);

  return resourceAllowed && actionAllowed;
}
