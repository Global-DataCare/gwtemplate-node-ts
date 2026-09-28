// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { forwardOrganizationVerificationTransactionToIca } from '../../../managers/hosting/ica-verification';

const buildJob = (jurisdiction?: string) => ({
  jurisdiction,
  content: { body: {} },
}) as any;

const buildDependencies = (jurisdiction?: string, hostJurisdiction?: string) => ({
  job: buildJob(jurisdiction),
  entry: {},
  claims: {},
  resource: {},
  requestedSector: 'health-care',
  resourceType: 'contract',
  organizationVerificationTransactionRequestType: 'Organization-verification-transaction-request-v1.0',
  icaDidcommPlainJsonMediaType: 'application/didcomm-plain+json',
  hostJurisdiction,
  hostDid: 'did:web:host.example.test',
  signHostAuthorizationPayload: jest.fn(async () => 'generated.proof.signature'),
  buildIcaVerifyUrl: jest.fn((_jurisdiction: string, _sector: string, _resourceType: string) => (
    'https://ica.example.test/verify'
  )),
  pollIcaJsonResult: jest.fn(async () => ({})),
  fetchImpl: jest.fn(async () => new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as any,
});

describe('ICA verification jurisdiction and terminal-result boundary', () => {
  it('fails closed when neither the request nor HOST_JURISDICTION declares a jurisdiction', async () => {
    const dependencies = buildDependencies();

    await expect(forwardOrganizationVerificationTransactionToIca(dependencies)).rejects.toThrow(
      /ICA verification jurisdiction is required/i,
    );
    expect(dependencies.buildIcaVerifyUrl).not.toHaveBeenCalled();
    expect(dependencies.fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the configured HOST_JURISDICTION without substituting a country literal', async () => {
    const dependencies = buildDependencies(undefined, 'CA-BC');

    await forwardOrganizationVerificationTransactionToIca(dependencies);

    expect(dependencies.buildIcaVerifyUrl).toHaveBeenCalledWith('CA-BC', 'health-care', 'contract');
    expect(dependencies.signHostAuthorizationPayload).toHaveBeenCalledWith(expect.objectContaining({
      jurisdiction: 'CA-BC',
    }));
  });

  it('preserves a preauthorized proof and its exact signed resource', async () => {
    const dependencies = buildDependencies('US-NY');
    const signedResource = { meta: { claims: { signed: 'unchanged' } } };
    const hostAuthorizationProof = { jws: 'protected.payload.signature' };
    dependencies.job.content.body = {
      hostAuthorizationProof,
      data: [{ resource: signedResource }],
    };

    await forwardOrganizationVerificationTransactionToIca(dependencies);

    const sent = JSON.parse(String(dependencies.fetchImpl.mock.calls[0]?.[1]?.body || '{}'));
    expect(sent.body.hostAuthorizationProof).toEqual(hostAuthorizationProof);
    expect(sent.body.data[0].resource).toEqual(signedResource);
    expect(dependencies.signHostAuthorizationPayload).not.toHaveBeenCalled();
  });

  it('fails closed when ICA polling returns a terminal failure inside a successful HTTP envelope', async () => {
    const dependencies = buildDependencies('CA-BC');
    dependencies.fetchImpl = jest.fn(async () => new Response('', {
      status: 202,
      headers: { location: 'https://ica.example.test/result' },
    })) as any;
    dependencies.pollIcaJsonResult = jest.fn(async () => ({
      body: {
        issues: { issue: [{ severity: 'error', diagnostics: 'credential ledger unavailable' }] },
        data: [{ resource: { status: 'failed' }, response: { status: String(HttpStatusCodes.InternalServerError) } }],
      },
    }));

    await expect(forwardOrganizationVerificationTransactionToIca(dependencies)).rejects.toThrow(
      /ICA verification failed.*credential ledger unavailable/i,
    );
  });

  it('fails closed when a direct JSON response contains a terminal entry status', async () => {
    const dependencies = buildDependencies('EU');
    dependencies.fetchImpl = jest.fn(async () => new Response(JSON.stringify({
      body: { data: [{
        resource: { status: 'failed' },
        response: { status: String(HttpStatusCodes.ServiceUnavailable) },
      }] },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as any;

    await expect(forwardOrganizationVerificationTransactionToIca(dependencies)).rejects.toThrow(
      /ICA verification failed.*terminal ICA response status 503/i,
    );
  });
});
