import type {
  ClinicalSectionUpdateInput,
  IndividualControllerSdk,
  IpsOrFhirImportInput,
  RouteContext,
  SubmitAndPollResult,
} from 'gdc-sdk-node-ts';

/** Import one IPS while preserving its declared external author provenance. */
export function importIps(
  sdk: IndividualControllerSdk,
  route: RouteContext,
  input: IpsOrFhirImportInput,
): Promise<SubmitAndPollResult> {
  return sdk.importIpsOrFhirAndUpdateIndex(route, input);
}

/** Apply typed create/delete entries as the authenticated controller. */
export function updateClinicalData(
  sdk: IndividualControllerSdk,
  route: RouteContext,
  input: ClinicalSectionUpdateInput,
): Promise<SubmitAndPollResult> {
  return sdk.updateClinicalSection(route, input);
}
