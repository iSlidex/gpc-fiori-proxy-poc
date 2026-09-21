const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const sourcePath = path.join(__dirname, '..', 'webapp', 'poc', 'frame-unlock.js');

test('reenvía gpc:legal-transaction-created al padre como GPC_ECM_LEGAL_TRANSACTION_CREATED', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(
    source,
    /window\.addEventListener\('gpc:legal-transaction-created', function \(event\) \{/
  );
  assert.match(source, /'GPC_ECM_LEGAL_TRANSACTION_CREATED',\s*\n\s*event\.detail \|\| \{\}/);
  assert.match(source, /stopPersistentUnlock\(\);/);
});
