import { buildIcaVerifyUrl } from '../../../managers/hosting/ica-did-registration';

const build = (networkMode?: string) => buildIcaVerifyUrl({
  jurisdiction: 'ES',
  sector: 'onehealth-research',
  resourceType: 'contract',
  config: {
    networkMode,
    ica: {
      mode: 'external',
      externalUrl: 'https://ica.globaldatacare.es',
      jurisdiction: 'ES',
    },
  },
  isDemoSecurityMode: () => false,
  isDevelopmentOrDemoDiagnosticsEnabled: () => false,
});

describe('ICA verification network-kind routing', () => {
  it.each(['local-network', 'test-network', 'network'])(
    'uses the canonical %s path section',
    (networkMode) => {
      expect(build(networkMode)).toBe(
        `https://ica.globaldatacare.es/ica/cds-ES/v1/onehealth-research/${networkMode}/pdf/contract/_verify`,
      );
    },
  );

  it.each([undefined, 'test'])('keeps terms as the test compatibility alias', (networkMode) => {
    expect(build(networkMode)).toBe(
      'https://ica.globaldatacare.es/ica/cds-ES/v1/onehealth-research/terms/pdf/contract/_verify',
    );
  });
});
