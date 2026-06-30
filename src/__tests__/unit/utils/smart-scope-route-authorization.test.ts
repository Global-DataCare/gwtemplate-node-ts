import { enforceSmartScopeRouteCompatibility } from '../../../utils/smart-scope-route-authorization';

describe('smart scope route authorization', () => {
  it('allows individual routes when one organization/Composition root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'individual',
      bearerPayload: {
        scope: 'organization/Composition.rs?subject=did:web:example:individual:123&section=LOINC|48765-2',
      },
    })).not.toThrow();
  });

  it('rejects individual routes when only organization/ResearchSubject root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'individual',
      bearerPayload: {
        scope: 'organization/ResearchSubject.rs?subject=did:web:example:individual:123',
      },
    })).toThrow('Individual endpoints require one SMART scope rooted at organization/Composition.');
  });

  it('allows digitaltwin routes when one organization/ResearchSubject root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'digitaltwin',
      bearerPayload: {
        scope: 'organization/ResearchSubject.rs?subject=did:web:example:individual:123',
      },
    })).not.toThrow();
  });

  it('rejects digitaltwin routes when only organization/Composition root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'digitaltwin',
      bearerPayload: {
        scope: 'organization/Composition.rs?subject=did:web:example:individual:123&section=LOINC|48765-2',
      },
    })).toThrow('digitaltwin endpoints require one SMART scope rooted at organization/ResearchSubject.');
  });
});
