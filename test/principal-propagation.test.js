const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..');

test('autentica el wrapper y S4 con el IdP de usuarios de negocio', async () => {
  const xsApp = JSON.parse(await readFile(
    path.join(projectRoot, 'xs-app.json'),
    'utf8'
  ));

  assert.equal(xsApp.authenticationMethod, 'route');

  const pocRoute = xsApp.routes.find(
    (route) => route.source === '^/poc/(.*)$'
  );
  const s4Route = xsApp.routes.find(
    (route) => route.source === '^/sap/(.*)$'
  );

  assert.equal(pocRoute.authenticationType, 'xsuaa');
  assert.equal(pocRoute.identityProvider, 'sap.custom');
  assert.equal(s4Route.authenticationType, 'xsuaa');
  assert.equal(s4Route.identityProvider, 'sap.custom');
  assert.equal(s4Route.destination, 'S4CXMashup');
});

test('registra el callback estable del proxy', async () => {
  const security = JSON.parse(await readFile(
    path.join(projectRoot, 'xs-security.json'),
    'utf8'
  ));

  assert.deepEqual(security['oauth2-configuration']['redirect-uris'], [
    'https://corporacion-aeroportuaria-del-este-sas-gpc-dev-buildcod18c6fdca.cfapps.us10-001.hana.ondemand.com/login/callback'
  ]);
});

test('habilita cookies de sesión para el iframe de CX', async () => {
  const mta = await readFile(path.join(projectRoot, 'mta.yaml'), 'utf8');

  assert.match(mta, /COOKIES:[\s\S]*"SameSite":"None"/);
  assert.match(mta, /"Partitioned"/);
});

test('no deshabilita el SSO SAML de S/4 en la URL de bienvenida', async () => {
  const xsApp = JSON.parse(await readFile(
    path.join(projectRoot, 'xs-app.json'),
    'utf8'
  ));

  assert.doesNotMatch(xsApp.welcomeFile, /saml2=disabled/);
});
