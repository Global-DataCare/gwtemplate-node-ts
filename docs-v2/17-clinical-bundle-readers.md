# 17 Clinical Bundle Readers

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- define the GW consumption boundary for section-aware clinical bundle readers,
- avoid reteaching upstream high-level helper APIs inside GW docs,
- point integrators to the owning repositories.

## GW Rule

- GW tests and node-side flows should consume the shared high-level readers/editors.
- the canonical method-by-method documentation does not belong in GW.
- `gdc-common-utils-ts` owns the high-level shared editor/view/helper docs.
- `gdc-sdk-core-ts` owns the FHIR document reader facade docs.
- `gdc-sdk-node-ts` owns the profile/workspace orchestration docs.

## What GW Assumes

- one real clinical document with one `Composition`
- resources already assigned to canonical sections
- no section inference by resource type when the source document omitted the section
- `sections?: readonly string[]` where `undefined` or `[]` means all sections

## Source Of Truth

- shared high-level IPS helpers and examples:
  [101-IPS_BUNDLE.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-IPS_BUNDLE.md)
- shared editor/reader baseline:
  [101-BUNDLE_EDITOR_READER.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-BUNDLE_EDITOR_READER.md)
- SDK core document facade:
  [communication-document-facade.ts](https://github.com/Global-DataCare/gdc-sdk-core-ts/blob/main/src/communication-document-facade.ts)
- SDK node profile workspace:
  [profile-workspace.ts](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/src/profile-workspace.ts)

## Related Tests

- `gdc-common-utils-ts/__tests__/101-ips-bundle-meta-claims.test.ts`
- `gdc-common-utils-ts/__tests__/utils-clinical-resource-view.test.ts`
- `gdc-sdk-core-ts/tests/101-communication-ips-document-reader.test.mjs`
- `gdc-sdk-node-ts/tests/101-profile-workspace-runtime.test.mjs`
- `gwtemplate-node-ts/src/__tests__/unit/examples/shared-bundle-entry-editors.test.ts`

## Out Of Scope

- inventing local section aliases outside `gdc-common-utils-ts`
- counting unsectioned resources as if they belonged to a section
- frontend/channel-specific formatting rules that are not shared across GW and SDK
