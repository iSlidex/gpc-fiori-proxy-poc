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
  assert.doesNotMatch(source, /contacts:\s*"manual"/);
});

test('restaura el prefill de Firmante y Contacto Principal vía hidratación por value-help', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /params\.get\("cxSignerBp"\)/);
  assert.match(source, /params\.get\("cxPrimaryContactBp"\)/);
  assert.match(source, /function applyExternalContactPrefill\(/);
  assert.match(source, /C_LglCntntMExtContactByBPVH/);
  assert.match(
    source,
    /BusinessPartnerPerson eq '\$\{escapeODataString\(bp\)\}' and BusinessPartnerCompany eq/
  );
  assert.match(
    source,
    /BusinessPartnerPerson eq '\$\{escapeODataString\(bp\)\}'`;/
  );
  assert.match(source, /type:\s*"0001"[\s\S]*label:\s*"Contacto principal"/);
  assert.match(source, /type:\s*"0002"[\s\S]*label:\s*"Firmante"/);
  assert.match(source, /LglCntntMExtCntctBP/);
  assert.match(source, /function findExternalContactNameProperty\(/);
  assert.match(source, /applyExternalContactPrefill\(view, model\)\.catch/);
  assert.match(
    source,
    /primaryContact:\s*cxPrimaryContactBp \|\| "manual"/
  );
  assert.match(source, /signer:\s*cxSignerBp \|\| "manual"/);
});

test('resuelve el contacto de organizaciones por nombre/correo dentro de la empresa cliente', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /params\.get\("cxPrimaryContactName"\)/);
  assert.match(source, /params\.get\("cxPrimaryContactEmail"\)/);
  assert.match(source, /async function resolveExternalContactByCompany\(/);
  assert.match(
    source,
    /BusinessPartnerCompany eq '\$\{escapeODataString\(clientBp\)\}'/
  );
  assert.match(source, /function normalizeContactName\(/);
  assert.match(source, /function contactNamesMatch\(/);
  assert.match(source, /ambiguo por nombre\/correo/);
  assert.match(source, /const resolutions = new Map\(\)/);
  assert.match(
    source,
    /`\$\{rowPath\}\/LglCntntMExtCntctBP`,\s*resolvedBp/
  );
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
