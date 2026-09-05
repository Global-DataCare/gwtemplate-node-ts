// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * 1. One member transports an individual-authored section batch with personal attestation.
 * 2. GW stores resource and Composition provenance as independent indexed claims.
 * 3. Subject summary rebuilds the native Composition and supporting RelatedPerson graph.
 * Authorization invariant: author remains the individual and attester remains the registered member.
 * Persistence invariant: summary export does not replace either reference with transport actorDid.
 */
import {
  CompositionAttesterModes,
  CompositionClaim,
  FhirIpsCreatorKinds,
  HealthcareBasicSections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts';
import {
  EXAMPLE_ALLERGY_IDENTIFIER,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_RELATED_PERSON_MEMBER_DID,
  EXAMPLE_RELATED_PERSON_ROLE,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { buildConsolidatedIpsBundleDocument, getClinicalCreatorBindingsSectionId } from '../../../utils/ips-bundle';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';

describe('IPS Bundle personal provenance export', () => {
  it('keeps the individual author and member attester with its RelatedPerson resource', async () => {
    const tenantVaultId = 'health-care_test-tenant';
    const memberAuthor = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
    const records = new Map<string, unknown[]>([
      [getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'composition'), [{
        [CompositionClaim.Identifier]: 'urn:uuid:composition-personal-provenance',
        [CompositionClaim.Subject]: EXAMPLE_SUBJECT_DID,
        [CompositionClaim.Section]: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
        [CompositionClaim.Author]: EXAMPLE_SUBJECT_DID,
        [CompositionClaim.Attester]: memberAuthor,
        [CompositionClaim.AttesterMode]: CompositionAttesterModes.Personal,
      }]],
      [getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'allergies'), [{
        id: EXAMPLE_ALLERGY_IDENTIFIER.split(':').at(-1),
        'AllergyIntolerance.identifier': EXAMPLE_ALLERGY_IDENTIFIER,
        'AllergyIntolerance.patient': EXAMPLE_SUBJECT_DID,
        [CompositionClaim.Section]: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      }]],
      [getClinicalCreatorBindingsSectionId(), [{
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: memberAuthor,
        ownerIdentifier: EXAMPLE_SUBJECT_DID,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [EXAMPLE_RELATED_PERSON_MEMBER_DID],
      }]],
    ]);
    const vaultRepository = {
      listContainersInSection: jest.fn(async (_vaultId: string, sectionId: string) => records.get(sectionId) || []),
    };

    const bundle = await buildConsolidatedIpsBundleDocument({
      vaultRepository: vaultRepository as any,
      tenantVaultId,
      subject: EXAMPLE_SUBJECT_DID,
      scope: 'individual',
      requiredSections: [HealthcareBasicSections.AllergiesAndIntolerances.attributeValue],
      excludedSections: [],
      requiredTypes: [],
    });
    const composition = bundle.entry[0].resource;
    expect(composition.author).toEqual([{ reference: EXAMPLE_SUBJECT_DID }]);
    expect(composition.attester).toEqual([{
      mode: CompositionAttesterModes.Personal,
      party: { reference: memberAuthor },
    }]);
    expect(bundle.entry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fullUrl: memberAuthor,
        resource: expect.objectContaining({ resourceType: ResourceTypesFhirR4.RelatedPerson }),
      }),
    ]));
  });
});
