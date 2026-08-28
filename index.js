const approuter = require('@sap/approuter');

const ar = approuter();

const DEFAULT_FRAME_ANCESTORS = Object.freeze({
  cx: 'https://my1002084.us1.test.crm.cloud.sap',
  gpc: 'https://gpc-creacion-solicitud-contrato.cfapps.us10-001.hana.ondemand.com',
  bas: 'https://*.applicationstudio.cloud.sap'
});

function clean(value) {
  return value === null || value === undefined
    ? ''
    : String(value).trim();
}

function getFrameAncestors(env = process.env) {
  const extras = clean(env.EXTRA_FRAME_ANCESTORS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set([
    "'self'",
    clean(env.CX_FRAME_ANCESTOR) || DEFAULT_FRAME_ANCESTORS.cx,
    clean(env.GPC_FRAME_ANCESTOR) || DEFAULT_FRAME_ANCESTORS.gpc,
    clean(env.BAS_FRAME_ANCESTOR) || DEFAULT_FRAME_ANCESTORS.bas,
    ...extras
  ].filter(Boolean)));
}

const frameAncestors = getFrameAncestors();
const frameAncestorsDirective = `frame-ancestors ${frameAncestors.join(' ')}`;

function rewriteContentSecurityPolicy(value) {
  const raw = Array.isArray(value)
    ? value.filter(Boolean).join('; ')
    : clean(value);

  const directives = raw
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)
    .filter((directive) => !/^frame-ancestors\b/i.test(directive));

  directives.push(frameAncestorsDirective);
  return directives.join('; ');
}

function rewriteHeaderObject(headers = {}) {
  const rewritten = { ...headers };
  let existingCsp = '';

  Object.keys(rewritten).forEach((name) => {
    const lower = name.toLowerCase();
    if (lower === 'x-frame-options') {
      delete rewritten[name];
      return;
    }
    if (lower === 'content-security-policy') {
      existingCsp = rewritten[name];
      delete rewritten[name];
    }
  });

  rewritten['Content-Security-Policy'] =
    rewriteContentSecurityPolicy(existingCsp);

  return rewritten;
}

function rewriteHeaderArray(headers = []) {
  const rewritten = [];
  let existingCsp = '';

  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index];
    const value = headers[index + 1];
    const lower = String(name).toLowerCase();

    if (lower === 'x-frame-options') {
      continue;
    }
    if (lower === 'content-security-policy') {
      existingCsp = value;
      continue;
    }

    rewritten.push(name, value);
  }

  rewritten.push(
    'Content-Security-Policy',
    rewriteContentSecurityPolicy(existingCsp)
  );

  return rewritten;
}

/*
 * Tanto /poc como /sap se sirven dentro de un iframe. S/4 aporta su propio
 * frame-ancestors y @sap/approuter puede aportar X-Frame-Options. Interceptamos
 * la respuesta final para conservar cualquier otra directiva CSP y reemplazar
 * únicamente frame-ancestors por la lista aprobada para CX, el monitor GPC y
 * BAS. Esto generaliza el bridge original que permitía únicamente CX.
 */
function allowApprovedEmbedding(req, res, next) {
  const originalSetHeader = res.setHeader.bind(res);
  const originalWriteHead = res.writeHead.bind(res);

  res.setHeader = function setHeader(name, value) {
    const lower = String(name).toLowerCase();

    if (lower === 'x-frame-options') {
      return res;
    }

    if (lower === 'content-security-policy') {
      return originalSetHeader(
        'Content-Security-Policy',
        rewriteContentSecurityPolicy(value)
      );
    }

    return originalSetHeader(name, value);
  };

  res.writeHead = function writeHead(statusCode, statusMessage, headers) {
    let message = statusMessage;
    let responseHeaders = headers;

    // Firma writeHead(statusCode, headers)
    if (
      (typeof statusMessage === 'object' && statusMessage !== null) ||
      Array.isArray(statusMessage)
    ) {
      responseHeaders = statusMessage;
      message = undefined;
    }

    if (Array.isArray(responseHeaders)) {
      responseHeaders = rewriteHeaderArray(responseHeaders);
    } else if (responseHeaders && typeof responseHeaders === 'object') {
      responseHeaders = rewriteHeaderObject(responseHeaders);
    } else {
      res.removeHeader('X-Frame-Options');
      originalSetHeader(
        'Content-Security-Policy',
        rewriteContentSecurityPolicy(res.getHeader('Content-Security-Policy'))
      );
    }

    if (message !== undefined) {
      return originalWriteHead(statusCode, message, responseHeaders);
    }

    if (responseHeaders !== undefined) {
      return originalWriteHead(statusCode, responseHeaders);
    }

    return originalWriteHead(statusCode);
  };

  // Asegura CSP también para los recursos locales /poc.
  originalSetHeader('Content-Security-Policy', frameAncestorsDirective);
  next();
}

ar.first.use('/poc', allowApprovedEmbedding);
ar.first.use('/sap', allowApprovedEmbedding);

console.log('[GPC F2403 Proxy] frame-ancestors aprobados', frameAncestors);

ar.start();
