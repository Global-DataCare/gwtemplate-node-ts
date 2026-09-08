# Local-first TDD and release contract

This contract is mandatory for behavior changes, shared packages, gateways and
portals. Repository skills and release-continuity tests enforce it.

## 1. Canonical types and reusable test data

Before inventing a type, enum, code, identifier, claim, vocabulary or test
literal, search the applicable standards and the owning shared packages.

Use the canonical type or terminology from HL7/FHIR, LOINC, SNOMED CT, ICD-10,
WHO ATC, Schema.org or the applicable governed standard. Then reuse the
exported type, builder or fixture from the versioned domain data package
(`<version>-data` or `<version>-data-utils`) or `common-utils`.

If it does not exist, add it first to the owning shared package with its own
red-green test and export it. Consumers import that export. They must not copy
or locally recreate governed strings, object shapes or identifiers.

## 2. TDD contract

Every new or modified test file starts on its first line with a
`// Flow contract:` comment that links this document and names the production
journey, authorization boundary and persistence invariant under proof.

Apply strict `red -> green -> refactor`:

1. Write the smallest executable contract and run it red.
2. The red result must fail because the required production behavior is absent
   or wrong, not because the test is malformed or setup is missing.
3. Implement only enough production code to make that contract green.
4. Run the smallest affected integration and real-boundary gate.
5. Refactor while keeping the focused contract green.

A skip, accepted error, placeholder, pending setup, fixture-only UI or mock that
replaces the real boundary is never a green result. Unit mocks may isolate code,
but local service and Playwright proof must exercise the real UI -> BFF ->
high-level SDK -> GW/DataConv boundary when that journey is affected.

## 3. Local-first gates and failure continuation

Promotion order is cumulative:

`test -> local-network -> test-network/staging -> network/production`

The `test` stage includes every affected unit, integration, local service,
real UI and Playwright gate without blockchain. After a failure, resume only
the smallest failed gate. Do not repeat a green gate unless the fix changed its
boundary, it creates required state, or the environment is no longer
trustworthy. Run the complete affected local matrix once at branch closure.

## 4. Unpublished package iteration

Keep all participating repositories on pushed but unmerged branches while the
local matrix is still being corrected. Build an immutable tarball with
`npm pack` and install it in downstream branches with `--no-save`.

The tarball is temporary test input. Never commit a `file:`, Git, workspace or
vendored tarball dependency or its generated lockfile state. An npm
authorization or publication failure must never stop the local `test` stage.

Do not attempt `npm publish` until every affected local gate in section 3 is
green.

## 5. Publication and merge order

After all local gates are green:

1. Publish and verify immutable npm packages from the lowest changed dependency
   upward.
2. In gateway consumers, replace the temporary tarball with the exact published
   registry version; commit the registry dependency and lockfile.
3. Run only the minimal clean-install, import/export and startup smoke needed to
   prove the registry artifact matches the tested tarball. Do not repeat the
   green local matrix unless the artifact differs or invalidates prior evidence.
4. Merge and push package repositories to `main`.
5. Merge and push gateway consumers to `main` only with exact registry
   versions installed, then build immutable GW images and run `local-network`.
6. Portal consumers remain on pushed, unmerged branches with the immutable
   tarball during `local-network`; do not reinstall or repeat their already-green
   local matrix.
7. After `local-network` is green, install the exact registry version in each
   affected portal, commit its registry dependency and lockfile, and run only
   the minimal artifact smoke.
8. Merge portal consumers to `main`, continue to `test-network`/staging and
   finally `network`/production. No tarball or local dependency may reach
   `main`.

Missing exact registry publication blocks consumer merge, image build and
environment promotion. It does not block continued local testing with the
immutable tarball.
