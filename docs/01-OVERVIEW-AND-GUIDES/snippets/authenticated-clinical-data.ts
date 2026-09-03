import type {
  ClinicalSectionUpdateInput,
  IndividualControllerSdk,
  IpsOrFhirImportInput,
  RouteContext,
  SubmitAndPollResult,
} from 'gdc-sdk-node-ts';
import { cloneImportedClinicalDocumentForDemo } from 'gdc-sdk-node-ts';

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

/** Create and write a separately authored, editable demo copy of an imported IPS. */
export function updateEditableImportedIpsForDemo(
  sdk: IndividualControllerSdk,
  route: RouteContext,
  input: Readonly<{
    importedIps: Record<string, unknown>;
    individualDid: string;
    actorDid: string;
    providerDid: string;
  }>,
): Promise<SubmitAndPollResult> {
  const editableCopy = cloneImportedClinicalDocumentForDemo({
    bundle: input.importedIps,
    authenticatedActorDid: input.actorDid,
  });

  return sdk.updateClinicalSummary(route, {
    subject: input.individualDid,
    // Operational DID returned by the authenticated profile.
    sender: input.actorDid,
    // Real tenant DID inside the host that accommodates the tenant.
    recipient: input.providerDid,
    bundle: editableCopy,
  });
}
