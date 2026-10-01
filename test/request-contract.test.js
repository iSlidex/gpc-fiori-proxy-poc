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
  assert.match(source, /scheduleEntityPrefill/);
  assert.match(source, /attachRequestCompleted/);
  assert.match(source, /attachDataReceived/);
  assert.match(source, /model-request-completed/);
  assert.match(source, /table-data-received/);
  assert.match(source, /El ID es el dato funcional/);
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

test('precarga contactos externos en Opportunity y Case', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /params\.get\("cxSourceType"\)/);
  assert.match(source, /params\.get\("cxPrimaryContactBp"\)/);
  assert.match(source, /params\.get\("cxSignerBp"\)/);
  assert.match(source, /params\.get\("cxLegalContactBp"\)/);
  assert.match(source, /key\.startsWith\("C_LegalTransactionExtContact\("\)/);
  assert.match(source, /type:\s*"0001"[\s\S]*label:\s*"Contacto principal"/);
  assert.match(source, /type:\s*"0002"[\s\S]*label:\s*"Firmante"/);
  assert.match(source, /type:\s*"0003"[\s\S]*label:\s*"Contacto legal"/);
  assert.match(source, /LglCntntMExtCntctBP/);
  assert.match(source, /legalContact:\s*cxLegalContactBp \|\| "manual"/);
});

test('Case usa sus contextos y deja monto, moneda, producto y PEP vacíos', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /Z001:\s*"20141"/);
  assert.match(source, /Z006:\s*"20142"/);
  assert.match(source, /cxSourceType !== "CASE" && cxAmount/);
  assert.match(source, /cxSourceType !== "CASE" && cxCurrency/);
  assert.match(source, /cxSourceType !== "CASE" && cxPep !== null/);
  assert.match(source, /!isCaseContextSource && cxProduct/);
  assert.match(source, /ZZ1_UbicacionTecnica_LTH/);
});

test('usa el producto de Opportunity como ubicación técnica', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(
    source,
    /const cxTechnicalLocation = clean\(params\.get\("cxTechnicalLocation"\)\) \|\|[\s\S]*cxSourceType !== "CASE" \? cxProduct : ""/
  );
  assert.match(source, /if \(cxTechnicalLocation\) \{/);
  assert.match(source, /"ZZ1_UbicacionTecnica_LTH"/);
  assert.match(source, /"opportunityProduct"/);
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

test('detecta la creación de la transacción legal (GET_ACTIVE_LT) y notifica al monitor', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /function attachCreationObserver\(model, ctx\)/);
  assert.match(source, /typeof model\?\.attachBatchRequestCompleted !== "function"/);
  assert.match(source, /function extractCreatedLegalTransactionId\(requests = \[\]\)/);
  assert.match(
    source,
    /GET_ACTIVE_LT\[\^\\s\]\*\[\?&\]LegalTransaction\\s\*=\\s\*'\?\(\[0-9\]\+\)'\?/
  );
  assert.match(
    source,
    /new CustomEvent\("gpc:legal-transaction-created", \{ detail \}\)/
  );
  assert.match(source, /attachCreationObserver\(model, ctx\);/);
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
