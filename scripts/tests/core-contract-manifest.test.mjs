// TDD flow contract: every canonical CORE contract points to a real test whose first line declares TDD and whose marker cannot silently disappear.
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkCoreContractManifest } from '../check-core-contract-manifest.mjs';

test('the CORE contract manifest remains executable and traceable', async () => {
  const result = await checkCoreContractManifest();
  assert.deepEqual(result.errors, []);
  assert.ok(result.checkedContractIds.length > 0);
});
