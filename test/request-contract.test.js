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

test('precarga cliente y organización con claves S/4 y deja contactos manuales', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /params\.get\("cxClientBp"\)/);
  assert.match(source, /params\.get\("cxSalesOrganization"\)/);
  assert.match(source, /type:\s*"0002"[\s\S]*label:\s*"Cliente"/);
  assert.match(source, /type:\s*"0004"[\s\S]*label:\s*"Organización de ventas"/);
  assert.match(source, /model\.setProperty\("LglCntntMEntity", requested\.value, rowContext\)/);
  assert.match(source, /contacts:\s*"manual"/);
  assert.doesNotMatch(source, /cxPrimaryContactBp/);
  assert.doesNotMatch(source, /cxSignerBp/);
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
