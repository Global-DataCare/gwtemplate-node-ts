import { randomUUID } from 'node:crypto';

/** Client for the ICA's existing status lookup; this interface never changes credentials. */
export class IcaCredentialStatusClient {
  constructor(private readonly options: {
    resolveEndpoint: (issuer: string) => string | Promise<string>;
    allowLocalTestEndpoint?: boolean;
  }) {}

  async check(credential: Record<string, any>): Promise<{ status: 'good' | 'revoked' | 'unknown'; checkedAt: string }> {
    const issuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id;
    const types = Array.isArray(credential.type) ? credential.type : [credential.type];
    if (!issuer || !credential.id || !types.length || !types.every(type => typeof type === 'string' && /^[A-Za-z][A-Za-z0-9:_-]*$/.test(type))) throw new Error('Unsupported ICA credential identifier or type list.');
    const template = await this.options.resolveEndpoint(issuer);
    if (!template.includes('{credentialType}')) throw new Error('ICA status endpoint must declare its credential type component.');
    // The current ICA status lookup matches the entire stored type list.
    // Commas are valid path characters and must remain literal for that profile.
    const endpoint = new URL(template.replace('{credentialType}', types.join(',')));
    const local = this.options.allowLocalTestEndpoint && process.env.NODE_ENV === 'test' && endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((!local && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password || endpoint.hash || endpoint.search || !endpoint.pathname.endsWith('/_status')) throw new Error('ICA status requires the configured HTTPS status endpoint.');
    const thread = randomUUID(); const deadline = Date.now() + 20_000;
    const post = (url: URL, body?: string) => fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      headers: { 'content-type': 'application/didcomm-plain+json', accept: 'application/didcomm-plain+json, application/json' }, body });
    const accepted = await post(endpoint, JSON.stringify({ jti: randomUUID(), thid: thread,
      type: 'https://globaldatacare.es/didcomm/ica/network/credentials/status-request/v1', body: { data: [{ credentialId: credential.id }] } }));
    if (accepted.status !== 202 || !accepted.headers.get('location')) throw new Error(`ICA status request was not accepted (${accepted.status}).`);
    const poll = new URL(accepted.headers.get('location')!, endpoint);
    if (poll.origin !== endpoint.origin || poll.username || poll.password || poll.hash
      || poll.pathname !== endpoint.pathname.replace(/_status$/, '_status-response')) throw new Error('ICA status polling location has an unexpected origin or path.');
    poll.searchParams.set('thid', thread);
    for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
      const response = await post(poll);
      if (response.status === 202) {
        const requestedDelay = Number(response.headers.get('retry-after') || '1') * 1000;
        const delay = Math.min(Number.isFinite(requestedDelay) ? Math.max(100, requestedDelay) : 1000, 3000, Math.max(0, deadline - Date.now()));
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (response.status !== 200) throw new Error(`ICA status polling failed (${response.status}).`);
      const text = await response.text(); if (text.length > 262_144) throw new Error('ICA status response is too large.');
      const payload = JSON.parse(text); const entries = payload?.body?.data;
      const entry = Array.isArray(entries) && entries.length === 1 ? entries[0] : undefined;
      const resource = entry?.resource;
      if (String(entry?.response?.status) !== '200' || resource?.status !== 'resolved' || resource.thid !== thread
        || resource.credentialType !== types.join(',') || !Array.isArray(resource.content) || resource.content.length !== 1) throw new Error('ICA credential status response does not match its request.');
      const item = resource.content[0];
      if (item.credentialId !== credential.id || !['good', 'revoked', 'unknown'].includes(item.status)) throw new Error('ICA credential status identifier or state mismatch.');
      const checkedAt = Date.parse(item.checkedAt);
      if (!Number.isFinite(checkedAt) || Math.abs(Date.now() - checkedAt) > 30_000) throw new Error('ICA credential status result is not fresh.');
      return { status: item.status, checkedAt: item.checkedAt };
    }
    throw new Error('ICA credential status lookup timed out.');
  }
}
