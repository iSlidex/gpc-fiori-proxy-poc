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

test('elimina el contexto inmobiliario obsoleto y exige uno de los nuevos', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.doesNotMatch(source, /["']10["']\s*:\s*["']20098["']/);
  for (const id of ['20150', '20151', '20152', '20153']) {
    assert.match(source, new RegExp(`["']${id}["']`));
  }
  assert.match(source, /division === ["']10["']/);
  assert.match(source, /realEstateContexts\.includes\(override\)/);
});
