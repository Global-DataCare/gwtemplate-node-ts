---
name: configure-trusted-identity-providers
description: Configure or audit several trusted OIDC id_token providers inside one GW CORE deployment. Use for AUTH_TOKEN_VERIFIER, exact iss and aud validation, OpenID discovery and jwks_uri, direct issuer plus managed identity-provider trust, or identity-provider rollout tests.
---

# Configure trusted identity providers

## Contract

- Treat one deployed GW as belonging to one network. Do not create a second
  conceptual staging/production trust layer inside it.
- Set `AUTH_TOKEN_VERIFIER=trusted-oidc` and configure
  `OIDC_TRUSTED_PROVIDERS_JSON` as a non-empty array of exact `iss` and `aud`
  pairs, matching the JWT claim names. Accept `issuer` and `audience` only as
  compatibility aliases and reject conflicting duplicate forms.
- Obtain `jwks_uri` from `issuer/.well-known/openid-configuration`. Permit
  `jwksUri` only as an explicit compatibility override.
- Use decoded `iss` only to select an allowlisted verifier. Accept the token
  only after signature, exact issuer, exact audience and temporal validation.
- Never infer employee/tenant authorization from successful token validation;
  continue through the existing subject, email and credential binding policy.

## TDD workflow

1. Add a failing routing test in
   `src/__tests__/unit/auth/TrustedOidcTokenVerifier.test.ts`.
2. Add startup/config validation in
   `src/__tests__/unit/auth/token-verifier-registry.test.ts`.
3. Implement in `src/auth/TrustedOidcTokenVerifier.ts` and
   `src/auth/token-verifier-registry.ts`.
4. Run both focused suites and `npm run type-check`.
5. Synchronize `env.example`, the integrator guide and `CHANGELOG.md`.

## Canonical snippet

```dotenv
AUTH_TOKEN_VERIFIER=trusted-oidc
OIDC_TRUSTED_PROVIDERS_JSON=[{"iss":"https://issuer.example","aud":"host-api"},{"iss":"https://securetoken.google.com/firebase-project-id","aud":"firebase-project-id"}]
```

Use deployment-specific issuer and audience placeholders in tracked examples;
keep real project names, domains, addresses and custody mappings in an
untracked operator inventory. Re-evaluate each trust list independently and
never infer token trust from a browser origin or copy a staging list into
production.
