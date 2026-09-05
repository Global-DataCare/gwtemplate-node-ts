import type {
  ActorSession,
  ClinicalSectionUpdateInput,
  IndividualControllerSdk,
  IpsOrFhirImportInput,
  RouteContext,
  SubmitAndPollResult,
  ClinicalCreatorIpsExport,
  ServerProfileSessionManager,
} from 'gdc-sdk-node-ts';
import {
  cloneImportedClinicalDocumentForDemo,
} from 'gdc-sdk-node-ts';

/** Implemented by the individual-controller, individual-member and professional facades. */
type ClinicalSummaryWriter = Pick<IndividualControllerSdk, 'updateClinicalSummary'>;

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
  sdk: ClinicalSummaryWriter,
  route: RouteContext,
  input: Readonly<{
    importedIps: Record<string, unknown>;
    individualDid: string;
    actorSession: Pick<ActorSession, 'actorDid'>;
    providerDid: string;
  }>,
): Promise<SubmitAndPollResult> {
  const actorDid = String(input.actorSession.actorDid || '').trim();
  if (!actorDid) throw new Error('The loaded actor session has no operational DID.');

  const editableCopy = cloneImportedClinicalDocumentForDemo({
    bundle: input.importedIps,
    authenticatedActorDid: actorDid,
  });

  return sdk.updateClinicalSummary(route, {
    subject: input.individualDid,
    // Operational DID returned by the authenticated role-specific profile session.
    sender: actorDid,
    // Real tenant DID inside the host that accommodates the tenant.
    recipient: input.providerDid,
    bundle: editableCopy,
  });
}

/** Export canonical FHIR author and attester without exposing the protected profile. */
export function exportClinicalCreator(
  profileManager: ServerProfileSessionManager,
  ownerId: string,
  profileId: string,
): Promise<ClinicalCreatorIpsExport> {
  return profileManager.exportClinicalCreatorIps({ ownerId, profileId });
}
