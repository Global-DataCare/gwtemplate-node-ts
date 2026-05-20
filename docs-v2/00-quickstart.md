# 00 Quickstart

Objective: run API, validate health, run one core test flow.

1. Install deps: `npm install`
2. Start API local: `npm run api:local-demo` (or repo equivalent)
3. Health check: `GET /host/.well-known/ping`
4. Run targeted tests (core first):
- Communication/Composition/DocumentReference
- Then extension tests (if repo is UNID)
