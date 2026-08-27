(function () {
  'use strict';

  const iframe = document.getElementById('fiori');
  if (!iframe) return;

  const trustedOrigins = new Set([
    'https://my1002084.us1.test.crm.cloud.sap',
    'https://gpc-creacion-solicitud-contrato.cfapps.us10-001.hana.ondemand.com'
  ]);

  function parentOrigin() {
    try {
      return new URL(document.referrer).origin;
    } catch (_error) {
      return '';
    }
  }

  function isBasPreviewOrigin(origin) {
    try {
      const host = new URL(origin).hostname;
      return /^port\d+-workspaces-[a-z0-9-]+\.us10\.applicationstudio\.cloud\.sap$/i.test(host);
    } catch (_error) {
      return false;
    }
  }

  function isTrustedParent() {
    const origin = parentOrigin();
    return trustedOrigins.has(origin) || isBasPreviewOrigin(origin);
  }

  function unlock() {
    if (!iframe.contentWindow || !isTrustedParent()) {
      return;
    }

    iframe.contentWindow.postMessage(
      'SAPFrameProtection*parent-unlocked',
      window.location.origin
    );
  }

  window.addEventListener('message', function (event) {
    const requestFromFiori =
      event.source === iframe.contentWindow &&
      event.origin === window.location.origin &&
      event.data === 'SAPFrameProtection*require-origin';

    if (requestFromFiori) unlock();
  });

  iframe.addEventListener('load', unlock);
})();
