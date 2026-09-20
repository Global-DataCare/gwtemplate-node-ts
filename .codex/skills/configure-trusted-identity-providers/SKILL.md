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

## Mandatory release authorization continuity

Fail-fast order is unit and integration with `networkKind=test`, followed by a
real local UI -> BFF -> SDK -> service Playwright journey without blockchain.
An unpublished SDK uses an immutable `npm pack` tarball as temporary
`--no-save` local input without committing dependency or lockfile changes.
Publish only after the entire affected local matrix is green; then install the
exact registry version and run the minimal artifact smoke before
`local-network` and staging.
After a failure, resume at the smallest failed gate. Rerun predecessor gates
only when they create required state, the fix changes an earlier boundary, or
environment state is no longer trustworthy. Run the complete suite once at
branch closure.

For any release chain that requires npm authorization, make at most three
attempts and keep each command session and browser window alive for up to five
minutes. Never end the turn or imply continued work while a window is pending.
After all three attempts fail, keep the release unpublished and continue the
local `test` stage with an immutable `npm pack` tarball. Never commit a
`file:`, Git, workspace or vendored tarball dependency.

Follow the canonical contract in
[`06.C-LOCAL-FIRST-RELEASE-CONTRACT.md`](../../../docs-v1/06-AUDIT-AND-EVIDENCE/06.C-LOCAL-FIRST-RELEASE-CONTRACT.md):

- Do not attempt `npm publish` until every affected local `test` gate is
  green, including unit, integration, local services, real UI and Playwright.
- An npm publish or authorization failure must never stop the `test` stage.
- Continue unit, integration, local service, UI and Playwright gates with the
  immutable tarball installed `--no-save` on pushed but unmerged branches.
- The `npm pack` tarball is temporary: install it `--no-save`, then restore
  the registry dependency and lockfile before committing dependency state.
- After a failure, resume only the smallest failed gate; do not repeat a green
  gate unless the fix changed its boundary, it creates required state, or the
  environment is no longer trustworthy.
- Resume the failed gate; rerun a predecessor only for required state, a
  changed earlier boundary or an untrustworthy environment.
- After publication, install the exact registry version and run only the minimal
  install/export smoke; do not repeat the green local matrix unless the
  published artifact differs from the tested tarball or invalidates that
  evidence.
- Missing exact registry publication blocks only consumer merge, image build,
  `local-network`, `test-network`/staging and `network` promotion.
- A gateway consumer installs the exact registry version before its merge,
  image build and `local-network`. A portal consumer may retain the immutable
  tarball on its pushed, unmerged branch throughout `local-network`; after
  `local-network` is green, it installs the exact registry version and runs
  only the artifact smoke before its merge and staging.
- Publish only after the local matrix is green, install the exact registry
  version in the gateway before `local-network`, and install it in portals
  before staging.
- Registry order is dependency publish and verification, then consumer install
  and lockfile pin, then package merge, consumer merge, image build and deploy.
- Every test file's first line must be a `Flow contract:` comment linking this
  policy. Apply TDD red -> green -> refactor: red must fail because the
  production behavior is absent or wrong; green must prove the production
  contract. A skip, accepted error, placeholder, pending setup, fixture-only UI
  or mock replacing a real boundary is never green.
- Reuse canonical types and terminology from HL7/FHIR, LOINC, SNOMED CT,
  ICD-10, WHO ATC, Schema.org or the applicable governed standard before
  inventing a local type, enum, code, identifier or vocabulary.
- Put missing reusable types in the versioned domain data package or
  `common-utils`, with tests in that owning shared package, before downstream
  use.
- Reuse canonical fixtures, builders, claims, identifiers and vocabulary from
  the versioned domain data package (`<version>-data` or
  `<version>-data-utils`) or `common-utils`; no duplicated literals are
  allowed. If the reusable datum does not exist, add it first to its owning
  shared package with tests and consume that export downstream.
