# Shared and product-specific test contracts

GW CORE owns the behavior every derived gateway must preserve. The canonical
contract identifiers live in `contracts/core-contracts.json`; `npm run
check:core-contracts` fails when a referenced suite disappears, loses its TDD
declaration, or no longer contains its stated contract.

Product repositories keep additional tests separate by responsibility:

- `core`: behavior inherited from GW CORE;
- `extensions/unid`: UHC UNID behavior only;
- `extensions/vetchain`: VetChain behavior only;
- `journeys`: complete user or SDK journeys across real boundaries.

A product-only test is not evidence that CORE contains the same fix. When a
shared behavior changes, update the CORE manifest and prove the corresponding
contract in each derived gateway before release. Product extensions must not be
copied back into CORE merely to make file counts equal.
