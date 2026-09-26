// Flow contract: research terminology is resolved from a canonical FHIR token through the governed exact-label HTTP boundary; caller-supplied labels are never authoritative.
import { createServer, type Server } from 'node:http';
import { VitalSignsCodes } from 'gdc-common-utils-ts/constants/vital-signs';
import { resolveResearchTerminologyLabels } from '../../../services/research-terminology-resolver';

describe('research terminology resolver', () => {
  let server: Server | undefined;

  afterEach(async () => {
    delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
    delete process.env.RESEARCH_TERMINOLOGY_SERVICE_TOKEN;
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('resolves trusted local and English labels from an exact system|code lookup', async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://localhost');
      expect(url.pathname).toBe('/v1/terminology/labels');
      expect(url.searchParams.get('system')).toBe(VitalSignsCodes.BodyTemperature.system);
      expect(url.searchParams.get('code')).toBe(VitalSignsCodes.BodyTemperature.code);
      expect(request.headers.authorization).toBe('Bearer local-service-token');
      response.writeHead(200, { 'content-type': 'application/vnd.api+json' });
      response.end(JSON.stringify({ data: { attributes: {
        system: VitalSignsCodes.BodyTemperature.system,
        code: VitalSignsCodes.BodyTemperature.code,
        text: 'Temperatura corporal',
        display: VitalSignsCodes.BodyTemperature.display,
        textLanguage: 'es',
        displayLanguage: 'en',
      } } }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.RESEARCH_TERMINOLOGY_SERVICE_TOKEN = 'local-service-token';

    await expect(resolveResearchTerminologyLabels({
      sector: 'health-care', jurisdiction: 'ES', resourceType: 'Observation',
      claims: {
        'Observation.code': VitalSignsCodes.BodyTemperature.claim,
        'Observation.language': 'es',
        'Observation.code-text': 'texto no confiable',
      },
    })).resolves.toMatchObject({
      codeClaim: 'Observation.code',
      system: VitalSignsCodes.BodyTemperature.system,
      code: VitalSignsCodes.BodyTemperature.code,
      text: 'Temperatura corporal',
      display: VitalSignsCodes.BodyTemperature.display,
    });
  });
});
