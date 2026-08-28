# OpenAPI Profiles

This repository keeps a single OpenAPI source (`swagger-spec.json`) and derives profile-specific artifacts for integrators and AI agents.

## Generated Profiles

Run:

```bash
npm run build:openapi-profiles
```

Output files:

- `docs/openapi-profiles/openapi-core.json`
- `docs/openapi-profiles/openapi-compat.json`

These generated profiles are versioned documentation artifacts, not ephemeral
test output. `artifacts/` remains reserved for local logs, runtime traces, and
other non-versioned build/test byproducts.

## Profile Intent

- `core`: canonical GW onboarding + consent + communication + composition/index flows.
- `compat`: `core` + compatibility/legacy aliases.

La especificación completa y autoritativa del runtime es `swagger-spec.json`.
GW CORE no publica un perfil de extensiones: las capacidades adicionales de
una solución se definen y documentan en su repositorio derivado.

## Operation Marking

Each operation in generated artifacts includes:

- `x-profile: core|compat`

This tag identifies the operation origin class in the source spec.

## Classification Rules (Current)

Rules are implemented in `scripts/generate-openapi-profiles.mjs` by path pattern:

- `compat`: routes under `/identity/openid/*`, `/auth/token`, and legacy individual order aliases.
- `core`: todas las rutas implementadas que no son alias de compatibilidad.

Adjust these rules when replacing a compatibility alias with a canonical route.

See explicit endpoint intent in:
- `docs/OPENAPI_PROFILE_MATRIX.md`
