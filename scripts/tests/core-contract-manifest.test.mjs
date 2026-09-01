// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Every canonical CORE contract points to a real test whose marker cannot silently disappear.
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkCoreContractManifest } from '../check-core-contract-manifest.mjs';

test('the CORE contract manifest remains executable and traceable', async () => {
  const result = await checkCoreContractManifest();
  assert.deepEqual(result.errors, []);
  assert.ok(result.checkedContractIds.length > 0);
});
