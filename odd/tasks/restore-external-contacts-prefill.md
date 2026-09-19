# Restaurar autofill de Firmante y Contacto Principal en F2403

## Objetivo
Restaurar el autofill de "Firmante" y "Contacto Principal" en el paso Partes
de F2403, usando el mismo patrón de "hidratación por value-help" que ya
funciona hoy para Cliente y Organización de Ventas — en vez de escribir el
BP crudo (que fue lo que rompió los controles el 2/sep).

## Contexto / diagnóstico (confirmado por investigación, no repetir)
- Commit `705b9d5` (GPC-CreacionSolicitudContrato) y `563925c`
  (gpc-fiori-proxy-poc), ambos del 2/sep, dejaron Cliente/Contacto
  Principal/Firmante en "selección manual" a propósito, documentado en
  comentario de código: *"Los IDs visibles de CX no son claves válidas de
  los value helps de S/4 y escribirlos directamente deja los controles en
  error."*
- El 8/sep (`e4cde57`, `46611c1`, `80513be` en gpc-fiori-proxy-poc) se
  restauró SOLO Cliente/Organización de Ventas, usando el patrón de
  "hidratación": en vez de `model.setProperty` directo, se lee la entidad de
  value-help vía OData (`model.read`), se obtiene el nombre a mostrar, se
  escriben ID+nombre juntos, y se dispara `fireChangeModelValue`/`fireChange`
  para validar el control (ver `applyEntityPrefill`,
  `validateEntityWhenControlIsReady` en `webapp/poc/request-contract.js`).
  Esto nunca se extendió a Firmante/Contacto Principal.
- "Contacto legal" nunca tuvo autofill implementado, en ninguna versión — no
  es parte de este alcance. **Confirmado por el usuario (18/sep)**: el
  value-help de Contacto Legal es el mismo `C_LglCntntMExtContactByBPVH` que
  Firmante/Contacto Principal — una vez validado este fix en el ambiente
  real, sumar Contacto Legal debería ser trivial (mismo mecanismo de
  hidratación, solo falta confirmar su código de `LglCntntMExtCntctType`).
  Queda como follow-up explícito, no se implementa en esta tarea.
- El usuario confirmó en vivo (Network tab de F2403) el value-help correcto
  para los campos de Contactos Externos:
  - Entity set: `C_LglCntntMExtContactByBPVH`
  - Clave compuesta: `RelationshipNumber`, `BusinessPartnerPerson`,
    `BusinessPartnerCompany`, `ValidityEndDate` (usualmente
    `datetime'9999-12-31T00:00:00'` para relaciones vigentes)
  - Campos útiles: `BusinessPartnerPerson` (BP de la persona de contacto —
    esto es lo que va en `LglCntntMExtCntctBP`), `BusinessPartnerName`
    (nombre a mostrar), `BusinessPartnerCompany` (empresa asociada a esa
    relación), `BusinessPartnerFullName`, `Country`, `CityName`,
    `PhoneNumber`, `EmailAddress`.
  - A diferencia de `C_LCMContactsOfCustomerVH` (Cliente, se lee por clave
    directa), este es una **colección que hay que filtrar** — no hay una
    clave predecible de antemano (no sabemos `RelationshipNumber`).
  - **No confirmado todavía**: el `$filter` exacto que usa F2403 al buscar
    (la captura del usuario fue sin filtro, listado inicial del dropdown).
    Diseñar el filtro como `BusinessPartnerPerson eq '<bp>'` combinado con
    `BusinessPartnerCompany eq '<clientBp>'` cuando haya match; si no hay
    match con ambos, hacer fallback a filtrar solo por `BusinessPartnerPerson`
    y tomar el primer resultado, dejando un `console.warn` visible cuando se
    use el fallback (para que sea fácil detectarlo en el ambiente real).
  - **Nombre de la propiedad "display name" en la fila de Contacto Externo**
    (análogo a `LglCntntMEntityName` en Entidades) no está confirmado. Usar
    descubrimiento heurístico de la propiedad (mismo patrón que
    `findProductProperty` ya usa en este archivo) en vez de hardcodear un
    nombre no verificado.
  - Hallazgo del código viejo (pre-2/sep, ver `git show 563925c^:webapp/poc/request-contract.js`):
    "Firmante" se autocompletaba **con el mismo BP que Cliente**
    (`signerBp: clientBp`), no con un contacto separado. "Contacto Principal"
    sí usaba una función `selectPrimaryContact()` (buscaba
    `opportunity.primaryContact`/`mainContact`/`account.primaryContact`/
    `involvedParties` con rol "contact") — esa función y `isOrganizationType()`
    fueron borradas en `705b9d5` y hay que restaurarlas.

## Alcance
- [x] T1 — `GPC-CreacionSolicitudContrato/web/js/ecm-iframe.js`: restaurar
      `selectPrimaryContact()`/`isOrganizationType()` (o equivalente), volver a
      enviar `cxSignerBp` (= `clientBp`) y `cxPrimaryContactBp` como query
      params.
      **Progreso**: recuperadas `selectPrimaryContact()`, `isOrganizationType()`
      y `hasContent()` desde `git show 705b9d5^:web/js/ecm-iframe.js`, sin
      cambios de lógica. `buildPrefill(opportunity, dueDiligence, clientBp)`
      ahora recibe `clientBp` como tercer parámetro (la versión actual del
      archivo ya no calcula `clientBp` dentro de `buildPrefill` como en la
      versión vieja — se calcula en `openEcmCreation` con
      `account?.defaultExternalBusinessPartnerId`/`sapBusinessPartnerId` — así
      que se adaptó pasándolo en vez de recalcularlo con la fórmula vieja) y
      devuelve `signerBp: clientBp` + `primaryContactBp` (solo si
      `organizationClient`, igual que el código viejo). `openEcmCreation` ahora
      calcula `clientBp` antes de `buildPrefill()` (se movió el cálculo, antes
      estaba después), y agrega `setSearchParam(url, 'cxSignerBp', ...)` /
      `setSearchParam(url, 'cxPrimaryContactBp', ...)`. El log
      `console.info('[GPC ECM] Datos enviados a F2403', ...)` ya no tiene
      `contacts: 'manual'` hardcodeado; ahora expone `primaryContact` y
      `signer` reales (o `'manual'` si vinieron vacíos).
- [x] T2 — Tests en `GPC-CreacionSolicitudContrato/test/ecmIframeSource.test.js`
      actualizados para reflejar el comportamiento restaurado (antes afirmaban
      `doesNotMatch` sobre `cxSignerBp`/`cxPrimaryContactBp`/`signerBp:
      clientBp`; ahora afirman `match`, y se agregó verificación de
      `selectPrimaryContact`/`isOrganizationType` y del nuevo objeto
      `parties`).
- [x] T3 — `gpc-fiori-proxy-poc/webapp/poc/request-contract.js`: nueva función
      de hidratación para Contactos Externos (Firmante tipo `0002`, Contacto
      Principal tipo `0001`, mismos códigos que el código viejo), leyendo
      `C_LglCntntMExtContactByBPVH` con el filtro descrito en el diagnóstico,
      escribiendo `LglCntntMExtCntctBP` + la propiedad de nombre descubierta
      heurísticamente, y validando el control igual que `applyEntityPrefill`.
      **Progreso**: agregada `applyExternalContactPrefill(view, model)`,
      modelada sobre `applyEntityPrefill` (mismo patrón de retry/pending sobre
      filas transitorias). Se agregaron los helpers
      `queryExternalContactByFilter` (usa `model.read('/C_LglCntntMExtContactByBPVH',
      {urlParameters: {$filter: ...}})`, integrándose con el mismo
      `model.read` que ya usa `readODataEntity`, sin tocar su firma),
      `resolveExternalContact` (filtro combinado
      `BusinessPartnerPerson eq '<bp>' and BusinessPartnerCompany eq '<clientBp>'`,
      con fallback a solo `BusinessPartnerPerson` + `console.warn` visible
      cuando se usa el fallback) y `findExternalContactNameProperty`
      (descubrimiento heurístico estilo `findProductProperty`: busca en las
      propiedades de la fila (`model.getObject(rowPath)`) una que empiece con
      `LglCntntMExtCntct` y contenga "name"; si no la encuentra, deja solo el
      BP y hace `console.warn`, sin inventar un nombre). Se leen `cxSignerBp`
      y `cxPrimaryContactBp` de los query params. Se llama
      `applyExternalContactPrefill(view, model).catch(...)` en
      `applyPrefill()`, igual que
      `applyEntityPrefill(view, model).catch(...)`. El log final ya no tiene
      `contacts: 'manual'` hardcodeado; ahora expone `primaryContact` y
      `signer` reales.
      **NO CONFIRMADO** (ver sección de verificación manual más abajo): el
      nombre de la entidad transitoria de caché OData para las filas de
      Contactos Externos. Se asumió, por analogía con
      `C_LegalTransactionEntity(...)` (Entidades), que las filas aparecen como
      `C_LegalTransactionExternalContact(...)`. Esto NO viene del diagnóstico
      confirmado del usuario y debe verificarse contra F2403 real.
- [x] T4 — Tests: actualizar `gpc-fiori-proxy-poc/test/request-contract.test.js`
      (ya no debe afirmar `doesNotMatch(/cxPrimaryContactBp/)` ni
      `doesNotMatch(/cxSignerBp/)` ni `match(/contacts:\s*"manual"/)`) y
      agregar cobertura nueva para `applyExternalContactPrefill`.
      **Progreso**: test original renombrado y con
      `assert.doesNotMatch(source, /contacts:\s*"manual"/)`; test nuevo
      `restaura el prefill de Firmante y Contacto Principal vía hidratación
      por value-help` cubre lectura de query params, existencia de
      `applyExternalContactPrefill`/`findExternalContactNameProperty`, uso de
      `C_LglCntntMExtContactByBPVH`, ambos filtros OData, los tipos `0001`
      Contacto principal / `0002` Firmante, y el nuevo objeto `parties` del
      log.
- NO tocado (fuera de alcance, según instrucción explícita): caso "cliente
  tipo empresa" (bug separado, después de esto) ni Contacto Legal (nunca
  existió).

## Verificación
- `npm run check` y `npm test`/`npm run test:unit` en ambos repos: ver
  resultados verbatim en el reporte de la sesión (todos verdes,
  2026-09-18). Esto solo prueba que el JS no tiene errores de sintaxis y que
  las aserciones de string-matching sobre el código fuente pasan — **no
  prueba que la integración contra SAP real funcione**.
- **Pendiente — requiere prueba manual en el ambiente real** (F2403 vivo)
  antes de dar por cerrada la tarea. No hay mock/metadata local de
  `C_LglCntntMExtContactByBPVH`, así que lo siguiente no se pudo verificar
  localmente:
  - Que las filas de Contactos Externos en el paso Partes realmente aparecen
    en `model.oData` bajo la clave `C_LegalTransactionExternalContact(...)`
    (supuesto por analogía, no confirmado).
  - Que el `$filter` combinado
    (`BusinessPartnerPerson eq '<bp>' and BusinessPartnerCompany eq '<clientBp>'`)
    devuelve resultados contra el servicio real, y que el fallback (solo
    `BusinessPartnerPerson`) se dispara correctamente cuando no hay match.
  - Que alguna propiedad de la fila que empiece con `LglCntntMExtCntct` y
    contenga "name" existe y contiene el nombre a mostrar (heurística de
    `findExternalContactNameProperty`); si no existe ninguna, el código deja
    el campo de nombre sin llenar y solo pone el BP (comportamiento
    intencional, no un bug).
  - Cómo reacciona el control de UI real (`fireChangeModelValue`) al escribir
    `LglCntntMExtCntctBP` mediante `validateEntityWhenControlIsReady`.
  - Que `signerBp = clientBp` y el `primaryContactBp` resuelto por
    `selectPrimaryContact()` en `ecm-iframe.js` corresponden a BPs válidos
    para el value-help real.

## Estado
Iniciado 2026-09-18, a partir de un reporte de regresión del usuario y
diagnóstico completo por git archaeology + captura de Network del usuario.

Implementación completada 2026-09-18 (T1-T4). Pendiente de cierre: prueba
manual contra F2403 real (ver "Verificación" arriba) — en particular el
nombre de la entidad transitoria de Contactos Externos y el `$filter`
exacto, que no se pueden confirmar sin el ambiente real.

## Nota 2026-09-19 — clientes organización
- Validado en vivo: Firmante/Contacto principal se llenan para cliente individual
  (BP = cliente). La entidad transitoria real es `C_LegalTransactionExtContact`.
- Para organizaciones CX solo entrega `primaryContact.displayId` (1001816, ID visible
  de CX, no clave S/4) + nombre y correo. Ya no se envía ese displayId como BP:
  `ecm-iframe.js` manda `cxPrimaryContactName`/`cxPrimaryContactEmail` y
  `resolveExternalContactByCompany` resuelve la persona en
  `C_LglCntntMExtContactByBPVH` filtrando `BusinessPartnerCompany eq <cxClientBp>`
  (primero por correo, luego por nombre normalizado sin títulos). Si no hay un único
  candidato queda manual y se loguea la lista de candidatos.
- Firmante = Contacto principal (misma resolución, cacheada; sin reintentos en bucle).
- Pendiente de validar en F2403 real con una oportunidad de empresa.
