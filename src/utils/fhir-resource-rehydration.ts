import { randomUUID } from 'crypto';
import { canonicalizeFhirClaims, getClaimValue } from './claims';
import { normalizeReference, tokenToCoding } from './fhir-data-utils';
import { determineResourceId } from './resource';
import { GatewayLocalFhirResourceTypes, ResourceTypesFhirR4 } from '../shared/fhir-constants';
import { DIGITAL_TWIN_SEARCH_CLAIM_PREFIX } from './digital-twin-research-projection';
import { convertClaimsToFhirResource } from 'gdc-common-utils-ts/utils/bundle-document-builder';

const PATIENT_REFERENCE_RESOURCE_TYPES = new Set<string>([
  ResourceTypesFhirR4.AllergyIntolerance,
  ResourceTypesFhirR4.Immunization,
  ResourceTypesFhirR4.RelatedPerson,
]);

const EFFECTIVE_FIELD_BY_RESOURCE_TYPE = Object.freeze<Record<string, string>>({
  [ResourceTypesFhirR4.MedicationStatement]: 'effectiveDateTime',
  [ResourceTypesFhirR4.Observation]: 'effectiveDateTime',
  [ResourceTypesFhirR4.DocumentReference]: 'date',
});

function buildCodeableConcept(params: {
  text?: string;
  codeToken?: string;
  codeDisplay?: string;
  userSelected?: string;
}): Record<string, any> | undefined {
  const { text, codeToken, codeDisplay, userSelected } = params;
  if (!text && !codeToken && !codeDisplay && !userSelected) return undefined;

  return {
    ...(text ? { text } : {}),
    ...(codeToken || codeDisplay || userSelected
      ? {
          coding: [{
            ...(codeToken ? tokenToCoding(codeToken) : {}),
            ...(codeDisplay ? { display: codeDisplay } : {}),
            ...(userSelected ? { userSelected: userSelected === 'true' } : {}),
          }],
        }
      : {}),
  };
}

export function buildFhirResourceFromIndexedClaims(
  resourceType: string,
  record: Record<string, any>,
): Record<string, any> {
  // Historical indexes may still carry version-specific FHIR prefixes. Read
  // them for migration compatibility, but expose and persist only the stable
  // FHIR API search-parameter namespace.
  const claims = canonicalizeFhirClaims(Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => !String(key).startsWith(DIGITAL_TWIN_SEARCH_CLAIM_PREFIX)),
  ));
  const subject =
    normalizeReference(getClaimValue<string>(claims, `${resourceType}.subject`))
    || normalizeReference(getClaimValue<string>(claims, `${resourceType}.patient`));
  const identifier = normalizeReference(
    getClaimValue<string>(claims, `${resourceType}.identifier`)
    || getClaimValue<string>(claims, `${resourceType}.identifier.value`),
  );
  const codeToken = normalizeReference(getClaimValue<string>(claims, `${resourceType}.code`));
  const status = normalizeReference(getClaimValue<string>(claims, `${resourceType}.status`));
  const noteText = normalizeReference(getClaimValue<string>(claims, `${resourceType}.note`));
  const effective = normalizeReference(
    getClaimValue<string>(claims, `${resourceType}.effective`)
    || getClaimValue<string>(claims, `${resourceType}.effectiveDateTime`)
    || getClaimValue<string>(claims, `${resourceType}.date`),
  );
  const codeText = normalizeReference(getClaimValue<string>(claims, `${resourceType}.code-text`));
  const codeDisplay = normalizeReference(
    getClaimValue<string>(claims, `${resourceType}.code-display`),
  );
  const medicationText = normalizeReference(getClaimValue<string>(claims, `${ResourceTypesFhirR4.MedicationStatement}.medication-text`));
  const language = normalizeReference(getClaimValue<string>(claims, `${resourceType}.language`));
  const userSelected = normalizeReference(getClaimValue<string>(claims, `${resourceType}.user-selected`));

  const projected = convertClaimsToFhirResource(claims) as Record<string, any>;
  const resource: Record<string, any> = {
    ...projected,
    resourceType,
    id: String(record?.id || determineResourceId(identifier || randomUUID(), process.env.NODE_ENV)),
    meta: {
      ...(projected?.meta && typeof projected.meta === 'object' ? projected.meta : {}),
      claims,
    },
  };

  if (identifier) {
    resource.identifier = [{ value: identifier }];
  }
  if (subject) {
    const subjectField = PATIENT_REFERENCE_RESOURCE_TYPES.has(resourceType) ? 'patient' : 'subject';
    resource[subjectField] = { reference: subject };
  }
  if (status) {
    resource.status = status;
  }
  if (language) {
    resource.language = language;
  }
  if (effective) {
    const effectiveField = EFFECTIVE_FIELD_BY_RESOURCE_TYPE[resourceType] || 'recordedDate';
    resource[effectiveField] = effective;
  }
  if (noteText) {
    resource.note = [{ text: noteText }];
  }

  if (resourceType === ResourceTypesFhirR4.MedicationStatement) {
    const medicationCodeableConcept = buildCodeableConcept({
      text: medicationText || codeText,
      codeToken,
      codeDisplay,
      userSelected,
    });
    if (medicationCodeableConcept) {
      resource.medicationCodeableConcept = medicationCodeableConcept;
    }
  } else {
    const code = buildCodeableConcept({
      text: codeText,
      codeToken,
      codeDisplay,
      userSelected,
    });
    if (code) {
      resource.code = code;
    }
  }

  if (resourceType === ResourceTypesFhirR4.DocumentReference) {
    const contentType = normalizeReference(getClaimValue<string>(claims, 'DocumentReference.contenttype'));
    const description = normalizeReference(getClaimValue<string>(claims, 'DocumentReference.description'));
    const contentHash = normalizeReference(getClaimValue<string>(claims, 'DocumentReference.contenthash'));
    const location = normalizeReference(getClaimValue<string>(claims, 'DocumentReference.location'));
    if (description) resource.description = description;
    resource.content = [{
      attachment: {
        ...(contentType ? { contentType } : {}),
        ...(location ? { url: location } : {}),
        ...(contentHash ? { id: contentHash } : {}),
      },
    }];
    if (subject) {
      resource.subject = { reference: subject };
    }
    if (effective) {
      resource.date = effective;
    }
  }

  if (resourceType === ResourceTypesFhirR4.DeviceUseStatement) {
    const deviceReference = normalizeReference(
      getClaimValue<string>(claims, 'DeviceUseStatement.device'),
    );
    const deviceDisplay = normalizeReference(
      getClaimValue<string>(claims, 'DeviceUseStatement.device-display'),
    );
    if (deviceReference || deviceDisplay) {
      resource.device = {
        ...(deviceReference ? { reference: deviceReference } : {}),
        ...(deviceDisplay ? { display: deviceDisplay } : {}),
      };
    }
    const recordedOn = normalizeReference(
      getClaimValue<string>(claims, 'DeviceUseStatement.recordedon'),
    );
    const timingDateTime = normalizeReference(
      getClaimValue<string>(claims, 'DeviceUseStatement.timing-datetime'),
    );
    if (recordedOn) resource.recordedOn = recordedOn;
    if (timingDateTime) resource.timingDateTime = timingDateTime;
  }

  if (resourceType === GatewayLocalFhirResourceTypes.OperationOutcome) {
    resource.issue = Array.isArray(record?.issue) ? record.issue : [];
  }

  return resource;
}
