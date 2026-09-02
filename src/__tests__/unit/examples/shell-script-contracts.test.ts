// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();

function readScript(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('shell script payload contracts', () => {
  it('keeps portal smoke checks anchored to canonical payload fixtures', () => {
    const portalScript = readScript('scripts/portal-web-go-no-go.sh');

    expect(portalScript).toContain('render_example_payload ORGANIZATION_ACTIVATION_REQUEST');
    expect(portalScript).toContain('render_example_payload ORGANIZATION_REGISTRATION_REQUEST');
    expect(portalScript).toContain('render_example_payload ORGANIZATION_ORDER_REQUEST');
    expect(portalScript).toContain('render_example_payload EMPLOYEE_REGISTRATION_REQUEST');
    expect(portalScript).toContain('render_example_payload INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST');
    expect(portalScript).toContain('render_example_payload DEVICE_REGISTRATION_REQUEST');
    expect(portalScript).toContain('render_example_payload SMART_TOKEN_REQUEST');
    expect(portalScript).toContain('render_example_payload FAMILY_REGISTRATION_REQUEST');
    expect(portalScript).not.toMatch(/dummy-/);
    expect(portalScript).not.toContain('/body/jwks/keys');
  });

  it('keeps the communication demo payloads out of bash heredocs', () => {
    const demoScript = readScript('scripts/demo-communication-medications-ips.sh');

    expect(demoScript).toContain('render_demo_payload_with_runtime COMMUNICATION_DIDCOMM');
    expect(demoScript).toContain('render_demo_payload_with_runtime COMMUNICATION_LEGACY_FHIR');
    expect(demoScript).toContain('render_demo_payload_with_runtime MEDICATION_SEARCH');
    expect(demoScript).toContain('render_demo_payload_with_runtime IPS_SEARCH');
    expect(demoScript).not.toContain('cat <<JSON');
  });

  it('shares the shell payload helper instead of duplicating ts-node loader boilerplate', () => {
    const bootstrapScript = readScript('scripts/bootstrap-single-tenant.sh');
    const portalScript = readScript('scripts/portal-web-go-no-go.sh');
    const demoScript = readScript('scripts/demo-communication-medications-ips.sh');

    expect(bootstrapScript).toContain('source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"');
    expect(portalScript).toContain('source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"');
    expect(demoScript).toContain('source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"');
  });

  it('waits for the asynchronous Offer and Order before declaring a tenant ready', () => {
    const bootstrapScript = readScript('scripts/bootstrap-single-tenant.sh');

    expect(bootstrapScript).toContain('poll_async_until');
    expect(bootstrapScript).toContain('organization Offer');
    expect(bootstrapScript).toContain('organization Order activation');
    expect(bootstrapScript).toContain('any(. == "201" or . == 201)');
  });

  it('fails closed on nested Organization errors', () => {
    const bootstrapScript = readScript('scripts/bootstrap-single-tenant.sh');

    expect(bootstrapScript).toContain('.body.data[0].response.outcome.issue[0].diagnostics');
  });

  it('exposes the mandatory Node 24 live-E2E runner and rejects skipped journeys', () => {
    const liveRunner = readScript('scripts/run-secure-e2e-google-user.sh');

    expect(liveRunner).toContain('NODE_MAJOR');
    expect(liveRunner).toContain('LIVE_GW_API_SCRIPT:-api:local-demo');
    expect(liveRunner).toContain('npm run "$GW_API_SCRIPT"');
    expect(liveRunner).toContain('test:e2e:live-gw');
    expect(liveRunner).toContain('LIVE_GW_ALLOW_HOST_TEARDOWN=0');
    expect(liveRunner).toContain('RUN_LIVE_GW_E2E_PROFILE_RUNTIME=0');
    expect(liveRunner).toContain('RUN_LIVE_GW_E2E_INDIVIDUAL_LIFECYCLE="$individual_lifecycle_enabled"');
    expect(liveRunner).toContain('RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION="$host_verification_enabled"');
    expect(liveRunner).toContain('LIVE_GW_E2E_SUITE=individual');
    expect(liveRunner).toContain('SKIP');
  });
});
