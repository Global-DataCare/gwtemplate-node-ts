import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';

export type SearchFilters = Record<string, string[]>;

function splitValues(rawValue: string): string[] {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRequestTarget(requestUrl: unknown): string {
  return String(requestUrl || '').trim().split('?')[0].replace(/^\/+|\/+$/g, '');
}

function collectParameterValue(parameter: any): string[] {
  if (typeof parameter?.valueBoolean === 'boolean') {
    return [String(parameter.valueBoolean)];
  }
  if (typeof parameter?.valueInteger === 'number') {
    return [String(parameter.valueInteger)];
  }
  if (typeof parameter?.valueDecimal === 'number') {
    return [String(parameter.valueDecimal)];
  }
  if (parameter?.valueReference?.reference) {
    return splitValues(String(parameter.valueReference.reference));
  }
  if (parameter?.valueCoding?.code) {
    const code = String(parameter.valueCoding.code).trim();
    const system = String(parameter.valueCoding.system || '').trim();
    return [system ? `${system}|${code}` : code].filter(Boolean);
  }

  return splitValues(
    String(
      parameter?.valueString
      || parameter?.valueCode
      || parameter?.valueUri
      || parameter?.valueDate
      || parameter?.valueDateTime
      || '',
    ),
  );
}

export function extractSearchFiltersFromParametersResource(resource: any): SearchFilters {
  const parameters = Array.isArray(resource?.parameter) ? resource.parameter : [];
  const filters: SearchFilters = {};
  for (const parameter of parameters) {
    const name = String(parameter?.name || '').trim();
    if (!name) continue;
    const values = collectParameterValue(parameter);
    if (values.length === 0) continue;
    filters[name] = [...(filters[name] || []), ...values];
  }
  return filters;
}

export function extractSearchFiltersFromRequestUrl(requestUrl: unknown): SearchFilters {
  const rawUrl = String(requestUrl || '').trim();
  const queryIndex = rawUrl.indexOf('?');
  const params = new URLSearchParams(queryIndex >= 0 ? rawUrl.slice(queryIndex + 1) : '');
  const filters: SearchFilters = {};
  for (const [key, value] of params.entries()) {
    const values = splitValues(value);
    if (values.length > 0) {
      filters[key] = values;
    }
  }
  return filters;
}

export function extractSearchResourceTarget(requestUrl: unknown): string {
  const target = getRequestTarget(requestUrl);
  if (!target) return '';
  const withoutAction = target.endsWith('/_search') ? target.slice(0, -'/_search'.length) : target;
  const segments = withoutAction.split('/').filter(Boolean);
  return segments.length > 0 ? String(segments[segments.length - 1] || '').trim() : '';
}

export function assertSearchRequestTarget(
  requestUrl: unknown,
  expectedResourceType: string,
): void {
  const target = extractSearchResourceTarget(requestUrl);
  if (!target) {
    throw new ManagerError('Search request requires request.url.', IssueType.Required);
  }

  if (target !== expectedResourceType) {
    throw new ManagerError(
      `Search request expects request.url to target '${expectedResourceType}', got '${getRequestTarget(requestUrl)}'.`,
      IssueType.Invalid,
    );
  }
}

export function extractSearchFiltersFromEntry(
  entry: any,
  expectedResourceType: string,
): SearchFilters {
  const request = entry?.request;
  if (!request) {
    throw new ManagerError('Search entry requires a request object.', IssueType.Required);
  }

  const method = String(request.method || '').toUpperCase();
  assertSearchRequestTarget(request.url, expectedResourceType);

  if (method === 'GET') {
    return extractSearchFiltersFromRequestUrl(request.url);
  }

  if (method === 'POST') {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Parameters') {
      throw new ManagerError(
        "POST search entry requires resource.resourceType = 'Parameters'.",
        IssueType.Required,
      );
    }
    return extractSearchFiltersFromParametersResource(resource);
  }

  throw new ManagerError(
    `Search entry only supports GET or POST request methods, got '${method || '(empty)'}'.`,
    IssueType.NotSupported,
  );
}
