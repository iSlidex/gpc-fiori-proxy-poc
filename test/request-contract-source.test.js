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

test('resuelve el contexto de Service Order por tipo de caso', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /cxSourceType === "SERVICE_ORDER"/);
  assert.match(
    source,
    /"20141": "Solicitud de Servicio \/ Servicios"/
  );
  assert.match(source, /Z001: "20141"/);
  assert.match(source, /Z006: "20142"/);
  assert.doesNotMatch(source, /"20140": "Servicios"/);
  assert.match(source, /expectedContext = serviceContextByCaseType\[cxCaseType\]/);
});

test('recibe los tres identificadores de la orden sin eliminar Opportunity', async () => {
  const source = await readFile(sourcePath, 'utf8');

  assert.match(source, /cxOpportunityId/);
  assert.match(source, /cxServiceOrderUuid/);
  assert.match(source, /cxServiceOrderDisplayId/);
  assert.match(source, /cxServiceOrderExternalId/);
  assert.match(source, /cxCaseUuid/);
  assert.match(source, /cxCaseDisplayId/);
  assert.match(source, /cxCaseType/);
});
