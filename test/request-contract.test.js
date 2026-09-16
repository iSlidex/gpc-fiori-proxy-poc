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

test('precarga cliente y organización con claves S/4', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /params\.get\("cxClientBp"\)/);
  assert.match(source, /params\.get\("cxSalesOrganization"\)/);
  assert.match(source, /params\.get\("cxSalesOrganizationName"\)/);
  assert.match(source, /type:\s*"0002"[\s\S]*label:\s*"Cliente"/);
  assert.match(source, /type:\s*"0004"[\s\S]*label:\s*"Organización de ventas"/);
  assert.match(source, /key\.startsWith\("C_LegalTransactionEntity\("\)/);
  assert.match(source, /property:\s*"LglCntntMEntityCustomer"/);
  assert.match(source, /property:\s*"LglCntntMEntitySlsOrg"/);
  assert.match(source, /C_LCMContactsOfCustomerVH/);
  assert.match(source, /C_LCMSalesOrganizationVH/);
  assert.match(source, /`\$\{rowPath\}\/LglCntntMEntityName`/);
  assert.match(source, /validateEntityWhenControlIsReady/);
  assert.doesNotMatch(source, /key\.startsWith\("C_LCMEntityTypeValueHelp/);
});

test('precarga contactos externos en Opportunity y Case', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /params\.get\("cxSourceType"\)/);
  assert.match(source, /params\.get\("cxPrimaryContactBp"\)/);
  assert.match(source, /params\.get\("cxSignerBp"\)/);
  assert.match(source, /params\.get\("cxLegalContactBp"\)/);
  assert.match(source, /key\.startsWith\("C_LegalTransactionExtContact\("\)/);
  assert.match(source, /"0001"[\s\S]*"Contacto principal"/);
  assert.match(source, /"0002"[\s\S]*"Firmante"/);
  assert.match(source, /"0003"[\s\S]*"Contacto legal"/);
  assert.match(source, /LglCntntMExtCntctBP/);
  assert.match(source, /extContactsSmartTable/);
  assert.match(source, /attachDataReceived/);
});

test('Case usa sus contextos y deja monto, moneda, producto y PEP vacíos', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /Z001:\s*"20141"/);
  assert.match(source, /Z006:\s*"20142"/);
  assert.match(source, /cxSourceType !== "CASE" && cxAmount/);
  assert.match(source, /cxSourceType !== "CASE" && cxCurrency/);
  assert.match(source, /cxSourceType !== "CASE" && cxPep !== null/);
  assert.match(source, /cxSourceType !== "CASE" && cxProduct/);
  assert.match(source, /ZZ1_UbicacionTecnica_LTH/);
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

test('detecta la creación de F2403 y notifica al contenedor', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /attachBatchRequestCompleted/);
  assert.match(source, /GET_ACTIVE_LT/);
  assert.match(source, /gpc:legal-transaction-created/);
  assert.match(source, /legalTransactionId/);
});

test('elimina la acción nativa de crear documento desde plantilla', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /scheduleTemplateCreationRemoval/);
  assert.match(source, /crear a partir de plantilla/);
  assert.match(source, /create from template/);
  assert.match(source, /setVisible\(false\)/);
  assert.match(source, /MutationObserver/);
});
