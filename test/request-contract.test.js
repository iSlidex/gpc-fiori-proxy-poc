const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const sourcePath = path.join(
  __dirname,
  '..',
  'webapp',
  'poc',
  'request-contract.js'
);

test('mantiene los participantes fuera del prefill automático', async () => {
  const source = await readFile(sourcePath, 'utf8');

  for (const parameter of [
    'cxClientBp',
    'cxClientType',
    'cxPrimaryContactBp',
    'cxSignerBp'
  ]) {
    assert.equal(
      source.includes(parameter),
      false,
      `${parameter} no debe ser leído ni escrito por el proxy`
    );
  }

  assert.match(source, /parties:\s*"manual"/);
});

test('sincroniza monto y moneda visibles con sus campos de aprobación', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(
    source,
    /visible:\s*"ZZ1_MONTO_LTH"[\s\S]*approved:\s*"ZZ1_MontoAprobacin_LTH"/
  );
  assert.match(
    source,
    /visible:\s*"ZZ1_MonedaMonto_LTH"[\s\S]*approved:\s*"ZZ1_MontoAprobacin_LTHC"/
  );
  assert.match(source, /attachPropertyChange/);
  assert.match(source, /attachChange/);
  assert.match(source, /syncApprovalFields/);
});
