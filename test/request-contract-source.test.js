'use strict';

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

test('usa el contexto de Solicitud de Servicio para Service Order', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /cxSourceType === "SERVICE_ORDER"/);
  assert.match(
    source,
    /"20141": "Solicitud de Servicio \/ Servicios"/
  );
  assert.match(source, /if \(!override\) return "20141"/);
});

test('recibe los tres identificadores de la orden sin eliminar Opportunity', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /cxOpportunityId/);
  assert.match(source, /cxServiceOrderUuid/);
  assert.match(source, /cxServiceOrderDisplayId/);
  assert.match(source, /cxServiceOrderExternalId/);
});
