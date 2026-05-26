import {
  buildDemoCommunicationDidcommRequest,
  buildDemoCommunicationLegacyFhirRequest,
  buildDemoIpsSearchRequest,
  buildDemoMedicationSearchRequest,
  demoCommunicationMedicationIpsDefaults,
} from '../src/__tests__/data/demo-communication-medications-ips.data.ts';

type PayloadName =
  | 'COMMUNICATION_DIDCOMM'
  | 'COMMUNICATION_LEGACY_FHIR'
  | 'MEDICATION_SEARCH'
  | 'IPS_SEARCH';

const payloadName = process.argv[2] as PayloadName | undefined;

if (!payloadName) {
  throw new Error(
    'Usage: render-demo-communication-medications-ips.mts <COMMUNICATION_DIDCOMM|COMMUNICATION_LEGACY_FHIR|MEDICATION_SEARCH|IPS_SEARCH>'
  );
}

const runtime = {
  thidComm: process.env.THID_COMM || 'comm-medications-demo',
  thidMedSearch: process.env.THID_MED_SEARCH || 'medications-search-demo',
  thidIpsSearch: process.env.THID_IPS_SEARCH || 'ips-search-demo',
};

const config = {
  ...demoCommunicationMedicationIpsDefaults,
  subjectId: process.env.SUBJECT_ID || demoCommunicationMedicationIpsDefaults.subjectId,
  ...runtime,
};

const rendered = (() => {
  switch (payloadName) {
    case 'COMMUNICATION_DIDCOMM':
      return buildDemoCommunicationDidcommRequest(config);
    case 'COMMUNICATION_LEGACY_FHIR':
      return buildDemoCommunicationLegacyFhirRequest(config);
    case 'MEDICATION_SEARCH':
      return buildDemoMedicationSearchRequest(config);
    case 'IPS_SEARCH':
      return buildDemoIpsSearchRequest(config);
    default:
      throw new Error(`Unknown payload '${payloadName}'.`);
  }
})();

process.stdout.write(JSON.stringify(rendered));
