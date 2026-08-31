# 101 Reading Path

> 101 note
> - Start here when you need the `gwtemplate-node-ts` learning order.
> - The shared front-story lives in `gdc-common-utils-ts`; this repo only starts after that profile/runtime and Communication authoring layer.
> - This repo owns GW CORE backend contract, routing, policy, indexing, and lifecycle semantics.
> - It does not own the first self-managed user login/profile/runtime entrypoint.
> - It also does not own payload authoring; that stays in shared GDC helper and SDK layers.

## User Story Start

For a self-managed user in a BFF, web app, or native app, the canonical story
starts upstream:

1. authenticate the user
2. load/unlock one protected profile
3. materialize one actor-scoped session or runtime facade
4. assume or bootstrap the actor state already owned by that user
5. only then submit/poll GW routes to create/read/edit/search business data

Current upstream entrypoints:

- common-utils BFF/channel flow:
  [gdc-common-utils-ts/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-BFF_AND_CHANNEL_MESSAGE_FLOW.md)
- common-utils communication layering:
  [gdc-common-utils-ts/docs/101-COMMUNICATION_LAYERING.md](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/docs/101-COMMUNICATION_LAYERING.md)
- backend/BFF runtime:
  [gdc-sdk-node-ts/tests/101-backend-profile-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/tests/101-backend-profile-runtime.test.mjs)
- backend profile workspace:
  [gdc-sdk-node-ts/tests/101-profile-workspace-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/tests/101-profile-workspace-runtime.test.mjs)
- frontend/native runtime:
  [gdc-sdk-front-ts/tests/101-frontend-profile-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-front-ts/blob/main/tests/101-frontend-profile-runtime.test.mjs)
- frontend individual-controller runtime:
  [gdc-sdk-front-ts/tests/101-individual-controller-frontend-runtime.test.mjs](https://github.com/Global-DataCare/gdc-sdk-front-ts/blob/main/tests/101-individual-controller-frontend-runtime.test.mjs)

## Read First

1. [101-01.K-HIGH_LEVEL_TUTORIAL_BOUNDARIES.md](./101-01.K-HIGH_LEVEL_TUTORIAL_BOUNDARIES.md)
2. [101-01.M-SECURE-PROFILE-ENROLLMENT.md](./101-01.M-SECURE-PROFILE-ENROLLMENT.md)
3. [101-01.I-LIFECYCLE.md](./101-01.I-LIFECYCLE.md)
4. [101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md](./101-01.J-SHARED_BUNDLE_ENTRY_EDITORS.md)

## Boundary

- Teach here: GW route/contract/lifecycle semantics after profile/runtime login already happened upstream.
- Reuse shared helper and SDK references instead of rebuilding login/profile stories locally in GW docs.
- Do not present low-level GW transport/plumbing as the first newbie narrative when the real start is upstream.
