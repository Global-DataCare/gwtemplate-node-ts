export const demoCommunicationMedicationIpsDefaults = {
  subjectId: 'did:web:api.acme.org:individual:subject-001',
  fhirContextR4: 'org.hl7.fhir.r4',
  fhirContextApi: 'org.hl7.fhir.api',
  fhirBundleBatch: 'batch',
  fhirBundleDocument: 'document',
  communicationResource: 'Communication',
  documentReferenceResource: 'DocumentReference',
  medicationStatementResource: 'MedicationStatement',
  compositionResource: 'Composition',
  claimCommunicationSubject: 'Communication.subject',
  claimCommunicationSent: 'Communication.sent',
  claimCompositionSection: 'Composition.section',
  claimMedicationStatementSubject: 'MedicationStatement.subject',
  loincSectionMedicationHistory: 'LOINC|10160-0',
  loincDocumentPatientSummarySystem: 'http://loinc.org',
  loincDocumentPatientSummaryCode: '60591-5',
  loincDocumentMedicationHistoryCode: '10160-0',
  demoTimestamp: '2026-05-22T10:00:00Z',
  demoCompositionId: 'ips-composition-001',
  demoCompositionTitle: 'IPS Medication Summary',
  demoMedicationId: 'medication-001',
  demoMedicationText: 'Paracetamol 500mg',
  demoMedicationNote: 'Tomar una pastilla cada 8 horas',
  demoMedicationIdentifier: 'urn:uuid:medication-001',
  demoDocumentReferenceId: 'ips-document-reference-001',
  demoDocumentReferenceIdentifier: 'urn:uuid:ips-document-reference-001',
  demoDocumentReferenceTitle: 'ips-medications.json',
  demoDocumentReferenceAttachmentTitle: 'ips-document-reference.json',
  attachmentFhirJson: 'application/fhir+json',
  urnIdentifierSystem: 'urn:ietf:rfc:3986',
} as const;

export interface DemoCommunicationMedicationIpsRuntime {
  thidComm: string;
  thidMedSearch: string;
  thidIpsSearch: string;
}

type DemoConfig = typeof demoCommunicationMedicationIpsDefaults & DemoCommunicationMedicationIpsRuntime;

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function buildDemoDocumentBundle(config: DemoConfig) {
  return {
    resourceType: 'Bundle',
    type: config.fhirBundleDocument,
    entry: [
      {
        resource: {
          resourceType: config.compositionResource,
          id: config.demoCompositionId,
          status: 'final',
          type: {
            coding: [
              {
                system: config.loincDocumentPatientSummarySystem,
                code: config.loincDocumentPatientSummaryCode,
                display: 'Patient summary Document',
              },
            ],
          },
          subject: { reference: config.subjectId },
          date: config.demoTimestamp,
          title: config.demoCompositionTitle,
          section: [
            {
              code: {
                coding: [
                  {
                    system: config.loincDocumentPatientSummarySystem,
                    code: config.loincDocumentMedicationHistoryCode,
                    display: 'History of Medication Use',
                  },
                ],
              },
              entry: [{ reference: config.demoMedicationIdentifier }],
            },
          ],
        },
      },
      {
        resource: {
          resourceType: config.medicationStatementResource,
          id: config.demoMedicationId,
          status: 'active',
          subject: { reference: config.subjectId },
          effectiveDateTime: config.demoTimestamp,
          medicationCodeableConcept: {
            text: config.demoMedicationText,
          },
          note: [{ text: config.demoMedicationNote }],
          identifier: [{ system: config.urnIdentifierSystem, value: config.demoMedicationIdentifier }],
        },
      },
    ],
  };
}

export function buildDemoDocumentReference(config: DemoConfig) {
  const documentBundle = buildDemoDocumentBundle(config);
  return {
    resourceType: config.documentReferenceResource,
    id: config.demoDocumentReferenceId,
    subject: { reference: config.subjectId },
    date: config.demoTimestamp,
    description: config.demoCompositionTitle,
    identifier: [{ system: config.urnIdentifierSystem, value: config.demoDocumentReferenceIdentifier }],
    content: [
      {
        attachment: {
          contentType: config.attachmentFhirJson,
          title: config.demoDocumentReferenceTitle,
          data: encodeBase64(JSON.stringify(documentBundle)),
        },
      },
    ],
  };
}

export function buildDemoCommunicationDidcommRequest(config: DemoConfig) {
  const documentReference = buildDemoDocumentReference(config);
  return {
    thid: config.thidComm,
    body: {
      resourceType: 'Bundle',
      type: config.fhirBundleBatch,
      entry: [
        {
          request: { method: 'POST', url: `individual/${config.fhirContextR4}/${config.communicationResource}` },
          meta: {
            claims: {
              '@context': config.fhirContextR4,
              [config.claimCommunicationSubject]: config.subjectId,
              [config.claimCommunicationSent]: config.demoTimestamp,
              [config.claimCompositionSection]: config.loincSectionMedicationHistory,
            },
          },
          resource: {
            resourceType: config.communicationResource,
            status: 'completed',
            subject: { reference: config.subjectId },
            sent: config.demoTimestamp,
            payload: [
              {
                contentAttachment: {
                  contentType: config.attachmentFhirJson,
                  title: config.demoDocumentReferenceAttachmentTitle,
                  data: encodeBase64(JSON.stringify(documentReference)),
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export function buildDemoCommunicationLegacyFhirRequest(config: DemoConfig) {
  const didcomm = buildDemoCommunicationDidcommRequest(config);
  return {
    thid: config.thidComm,
    resourceType: didcomm.body.resourceType,
    type: didcomm.body.type,
    entry: didcomm.body.entry,
  };
}

export function buildDemoMedicationSearchRequest(config: DemoConfig) {
  return {
    thid: config.thidMedSearch,
    body: {
      data: [
        {
          type: `${config.medicationStatementResource}-search-request-v1.0`,
          meta: {
            claims: {
              '@context': config.fhirContextApi,
              [config.claimMedicationStatementSubject]: config.subjectId,
            },
          },
        },
      ],
    },
  };
}

export function buildDemoIpsSearchRequest(config: DemoConfig) {
  return {
    thid: config.thidIpsSearch,
    body: {
      resourceType: 'Bundle',
      type: config.fhirBundleBatch,
      entry: [
        {
          request: {
            method: 'GET',
            url: `Bundle?type=${encodeURIComponent(config.fhirBundleDocument)}&composition.subject=${encodeURIComponent(config.subjectId)}&composition.section=${encodeURIComponent(config.loincSectionMedicationHistory)}`,
          },
        },
      ],
    },
  };
}
