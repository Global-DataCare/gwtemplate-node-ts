import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'contracts', 'core-contracts.json');

/** Checks that CORE contract identifiers still resolve to executable TDD suites. */
export async function checkCoreContractManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const errors = [];
  const checkedContractIds = [];

  for (const contract of manifest.contracts ?? []) {
    checkedContractIds.push(contract.id);
    const testPath = path.join(repositoryRoot, contract.testFile);
    let source;
    try {
      source = await readFile(testPath, 'utf8');
    } catch {
      errors.push(`${contract.id}: missing ${contract.testFile}`);
      continue;
    }
    const firstLine = source.split(/\r?\n/, 1)[0];
    if (!firstLine.includes('TDD')) {
      errors.push(`${contract.id}: first line must declare TDD`);
    }
    if (!source.includes(contract.marker)) {
      errors.push(`${contract.id}: missing contract marker ${contract.marker}`);
    }
  }

  return { checkedContractIds, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkCoreContractManifest();
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`Checked ${result.checkedContractIds.length} CORE contracts.`);
  }
}
