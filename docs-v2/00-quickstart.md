# 00 Quickstart

Objective: run API, validate health, run one core test flow.

1. Install deps: `npm install`
2. Start API local: `npm run api:local-demo` (or repo equivalent)
3. Health check: `GET /host/.well-known/ping`
4. Run targeted tests (core first):
- Communication/Composition/DocumentReference
- Then extension tests (if any)

## Read next (context that must not be skipped)

- `docs-v2/06-security-model-and-why.md`
- `docs-v2/07-didweb-pqc-and-trust-chain.md`
- `docs-v2/08-use-case-flow-explanations.md`
