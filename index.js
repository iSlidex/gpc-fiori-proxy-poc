const approuter = require('@sap/approuter');

const ar = approuter();

const FRAME_ANCESTORS = [
  "'self'",
  'https://my1002084.us1.test.crm.cloud.sap',
  'https://gpc-creacion-solicitud-contrato.cfapps.us10-001.hana.ondemand.com',
  'https://*.applicationstudio.cloud.sap'
].join(' ');

// S/4 FLP returns its own CSP (currently only self + CX tenant). Because the
// F2403 iframe is nested under GPC-CreacionSolicitudContrato, every ancestor
// must be allowed by frame-ancestors. Override only proxied /sap responses so
// the browser can render F2403 inside the approved GPC/BAS parents.
ar.first.use('/sap', function allowApprovedFrameAncestors(req, res, next) {
  req.afterRequestHandler = function afterSapResponse(ctx, done) {
    const response = ctx.incomingResponse;

    response.removeHeader('x-frame-options');
    response.setHeader(
      'Content-Security-Policy',
      `frame-ancestors ${FRAME_ANCESTORS}`
    );

    done(null, response);
  };

  next();
});

ar.start();
