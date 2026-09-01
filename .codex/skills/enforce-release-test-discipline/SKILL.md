---
name: enforce-release-test-discipline
description: Enforce branch, TDD, canonical FHIR and schema.org vocabulary, fixture, test-layer, product-neutrality, changelog, semantic-version, npm publication, deployment and merge discipline across GW CORE, shared gdc SDKs and product portals. Use for every behavior fix, FHIR-like resource or search contract, flow change, test or 101 example, documentation contract, shared-package release, portal dependency promotion, App Hosting rollout, or request to ship with branch, patch, changelog and merge to main.
---

# Enforce Release and Test Discipline

## Start on a branch

1. Read the repository `AGENTS.md` and applicable product/contract skill.
2. Inspect the worktree and preserve unrelated user changes.
3. Update local knowledge of the remote, start from the intended current base,
   and create a named branch before editing.
4. Never implement or commit directly on `main`. If that already happened,
   disclose it; do not rewrite published history to manufacture a merge.

## Write the contract test first

- Use red-green-refactor for every behavior or flow change. Run the smallest
  executable test and retain the intended failure before implementation.
- Make this the first physical line of every new or modified test file:
  `// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.`
- Import synthetic identities, routes, DIDs, tokens, codes, dates and other
  governed examples from the canonical shared test-data/example module.
  Prefer the applicable `*-data-utils-ts` package or
  `gdc-common-utils-ts/examples`; add a missing fixture there once instead of
  repeating a local literal.
- Import defined enums, constants, claim names, resource types, transport
  profiles and HTTP methods from their owning package. Never restate their wire
  strings merely to make a test pass.
- Preserve the primary-document Bundle boundary: a DIDComm payload body is one
  FHIR-like/JSON-primary-document Bundle, and each successful result belongs in
  `body.data[].resource` (or canonical FHIR `entry[].resource`). Never place a
  second `{ total, data }` search list inside `BundleEntry.resource` except in
  the isolated, explicitly deprecated rolling-deployment serializer. Add a
  negative assertion against `resource.data` for the current profile and prove
  the legacy profile separately without teaching it in high-level snippets.
- Literal values are allowed only when the literal itself is the behavior under
  test, such as malformed input or an exact serialization assertion. State
  that reason beside it.

## Preserve standard vocabularies

- Before authoring a FHIR-like resource, property, status, search parameter or
  flat claim, verify the exact name and value against the applicable official
  HL7 FHIR version and the canonical catalog already exported by
  `gdc-common-utils-ts`. Do the same for schema.org types and properties.
- Never invent a FHIR resource name, pseudo-resource namespace such as
  `AccessRequest.*`, property, status or search parameter. FHIR-like flat
  claims keep the owning HL7 resource and original API/search parameter name;
  they do not create a parallel vocabulary.
- When R4 and R5 differ, state the selected profile explicitly and use only a
  value valid for that profile. For a shared claims-first contract, choose a
  deliberately supported cross-version representation and prove both
  projections. Never infer a value from a different FHIR release.
- Introduce an extension only after proving that neither FHIR nor schema.org
  covers the requirement. Give it an explicit canonical extension URL,
  document ownership and compatibility, add it to the shared catalog first,
  and keep it visibly separate from native standard fields.
- Model a professional permission request as one auditable `Communication`
  carrying a Bundle of ordinary `Consent.status=draft` resources. Draft
  Consent describes requested rules and grants no access. Only the
  controller-approved active Consent enters authorization evaluation; the
  historical status-less rule is read-only migration compatibility.
- Add regression assertions that reject invented namespaces and that prove
  non-active Consent states cannot authorize. Cite the official vocabulary in
  JSDoc and high-level docs, while tests import the governed constants instead
  of copying wire literals.

## Keep test layers separate

- Enforce the same portal progression everywhere: `test -> local-network -> test-network -> network`.
  First prove normal local UI -> BFF -> high-level
  SDK -> GW/services with in-memory `networkKind=test` and no blockchain.
  Fixture pages, mocked routes and API-only Playwright are diagnostics and
  never satisfy this cross-system gate. Run Fabric/local-network only after it
  is green; staging repeats the journey after deployment, and production is
  last.
- Enable and execute every affected package or SDK live E2E against the real
  local services before releasing it. A live E2E reported as `SKIP` means the
  release gate failed; it is not passing evidence. Complete these live E2E
  gates before `npm publish` or any container image build.
- Preserve identity roles at every transport boundary: DIDComm `from` is a
  sender DID, JWT `iss` is the signing entity, `kid` is a concrete key DID URL,
  and SMART `sub` is the authorized actor. Native FHIR Communication/Bundle
  inputs carry none of those DIDComm fields; HTTP Authorization proves the
  caller and `Communication.sender` keeps its FHIR business meaning.

- High-level `101`, documentation snippets and E2E journeys use only public
  application/SDK facades and assert user-visible or contract-visible results.
  They must not provision wallets, decode compact JOSE, record raw fetch calls,
  construct internal routes, inspect queues/vaults or instantiate transport
  adapters.
- Put algorithm and helper behavior in unit tests.
- Put HTTP serialization, encrypted transport, persistence adapters and route
  boundaries in focused integration tests.
- Put complete cross-system behavior in numbered E2E journeys with explicit
  authorization and persistence invariants. Mocks never count as boundary
  proof.
- Do not make high-level examples green by embedding internal plumbing. Move
  that proof to the correct lower-level suite and leave the high-level example
  copyable.

## Preserve shared-package neutrality

- Never place a product name, branded hostname, product route or product policy
  in GW CORE or a shared `gdc-*` package, including tests, examples, docs,
  comments and changelogs.
- Use neutral shared fixtures and enforce the rule with a repository check.
- Keep product-specific names and behavior only in the owning product repo.

## Release the complete change

1. Update the owning changelog with tested behavior. Shared changelogs remain
   product-neutral.
2. Run focused tests, affected integration/E2E tests, full tests, typecheck,
   build and neutrality/skill checks required by the repository. Enable every
   affected live E2E and reject a run containing `SKIP` before release.
3. Commit on the branch and push the branch.
4. Merge the reviewed branch into `main` with an explicit merge commit unless
   repository policy requires a PR merge. Push `main` and verify both remote
   refs and a clean worktree.
5. For a reusable bug fix, publish the next immutable patch version from a real
   TTY. Verify `npm view <package>@<version>`, integrity, the `latest` tag,
   clean registry installation and exported surface.
6. Pin deployable consumers to the exact registry version and update their
   lockfiles. Never substitute GitHub, `file:`, workspace or vendored tarball
   dependencies for a released package.
7. Verify the actual deployment/revision and live boundary before reporting
   completion.

Report separately: branch, commit, pushed branch, merge commit, pushed
`main`, package version/integrity, consumer pin, deployment and live result.
