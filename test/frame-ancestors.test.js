const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const mtaPath = path.join(__dirname, '..', 'mta.yaml');

test('permite el AppRouter autenticado del BFF como padre de F2403', async () => {
  const mta = await readFile(mtaPath, 'utf8');

  assert.match(
    mta,
    /GPC_FRAME_ANCESTOR:\s*"https:\/\/gpc-creacion-solicitud-contrato-router\.cfapps\.us10-001\.hana\.ondemand\.com"/
  );
  assert.match(
    mta,
    /EXTRA_FRAME_ANCESTORS:\s*"https:\/\/gpc-creacion-solicitud-contrato\.cfapps\.us10-001\.hana\.ondemand\.com"/
  );
  assert.doesNotMatch(
    mta,
    /GPC_FRAME_ANCESTOR:\s*"https:\/\/\*\.cfapps\.us10-001\.hana\.ondemand\.com"/
  );
});
