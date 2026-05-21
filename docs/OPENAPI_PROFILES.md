# OpenAPI Profiles

This repository keeps a single OpenAPI source (`swagger-spec.json`) and derives profile-specific artifacts for integrators and AI agents.

## Generated Profiles

Run:

```bash
npm run build:openapi-profiles
```

Output files:

- `artifacts/openapi-profiles/openapi-core.json`
- `artifacts/openapi-profiles/openapi-compat.json`
- `artifacts/openapi-profiles/openapi-extension.json`

## Profile Intent

- `core`: canonical GW onboarding + consent + communication + composition/index flows.
- `compat`: `core` + compatibility/legacy aliases.
- `extension`: `compat` + extension-oriented capabilities.

## Operation Marking

Each operation in generated artifacts includes:

- `x-profile: core|compat|extension`

This tag identifies the operation origin class in the source spec.

## Classification Rules (Current)

Rules are implemented in `scripts/generate-openapi-profiles.mjs` by path pattern:

- `compat`: routes under `/identity/openid/*`, `/auth/token`, and legacy individual order aliases.
- `extension`: digital twin and non-core vertical paths (e.g., observation/subject and extension appointment surfaces).
- `core`: everything else.

Adjust these rules when promoting capabilities from extension/compat to core.

See explicit endpoint intent in:
- `docs/OPENAPI_PROFILE_MATRIX.md`
