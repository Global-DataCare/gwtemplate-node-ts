# 01 Narrative Contract

This document is the v2 implementation of the root
[NARRATIVE-ALIGNMENT.md](../NARRATIVE-ALIGNMENT.md) contract for all 101
material in this repository, including tests, snippets, and docs.

## Required Story Order

Every 101 example must explain the full upstream-to-GW story, even when the
example only shows one local step.

Required order:

1. `login`
2. `loadProfile(...)`
3. loaded-profile workspace and wallet/key material selection
4. security mode decision: FHIR compatibility, `didcomm-plain+json`, or strict
   FAPI JWE/JAR/JARM
5. if FHIR is used, name the version explicitly
6. if strict mode is used, say which loaded-profile keys are used for signing
   and encryption
7. only then describe the GW route, queue, or manager behavior under test

## Local Step Rule

If a test or snippet mocks upstream work, it must still say so explicitly.

- say what was mocked
- say where the real implementation lives upstream
- say why the example is still useful
- never let a local example read like the complete architecture if it is not

## Compatibility Rule

When a route supports compatibility modes, docs and tests must distinguish:

- canonical mode
- compatibility mode
- legacy alias, if any

Do not describe compatibility routes as canonical unless that is the active
contract.

## Where To Point Readers

Use these files as the governing references:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)

## Writing Rule

Keep the text concrete and testable.

- no vague architecture prose without a route, test, or payload example
- no payload example without the upstream runtime context
- no 101 file without the boundary between upstream runtime and GW behavior
