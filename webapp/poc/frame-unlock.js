(function () {
  'use strict';

  const iframe = document.getElementById('fiori');
  if (!iframe) return;

  const trustedOrigins = new Set([
    'https://my1002084.us1.test.crm.cloud.sap',
    'https://gpc-creacion-solicitud-contrato.cfapps.us10-001.hana.ondemand.com'
  ]);

  let trustedParentOrigin = '';
  let unlockTimer = null;
  let unlockAttempts = 0;
  let f2403Ready = false;
  const MAX_UNLOCK_ATTEMPTS = 40;
  const UNLOCK_INTERVAL_MS = 1000;

  function getReferrerOrigin() {
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

  function isGpcWrapperOrigin(origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:') return false;

      return (
        url.hostname ===
          'gpc-creacion-solicitud-contrato.cfapps.us10-001.hana.ondemand.com' ||
        /^corporacion-aeroportuaria-del-este-sas-gpc-dev-buildcod[a-z0-9-]*\.cfapps\.us10-001\.hana\.ondemand\.com$/i
          .test(url.hostname)
      );
    } catch (_error) {
      return false;
    }
  }

  function isTrustedOrigin(origin) {
    /*
     * CSP frame-ancestors ya decide qué sitios pueden cargar este proxy.
     * Una vez cargado, document.referrer identifica al padre efectivo.
     * Validamos además event.source === window.parent al procesar mensajes,
     * evitando mantener una segunda allowlist que se desincronice con CSP.
     */
    const referrerOrigin = getReferrerOrigin();

    return Boolean(
      origin &&
      (
        origin === referrerOrigin ||
        trustedOrigins.has(origin) ||
        isBasPreviewOrigin(origin) ||
        isGpcWrapperOrigin(origin)
      )
    );
  }

  function rememberTrustedParent(origin) {
    if (isTrustedOrigin(origin)) {
      trustedParentOrigin = origin;
      return true;
    }
    return false;
  }

  function notifyParent(type, detail) {
    if (!trustedParentOrigin || window.parent === window) return;

    window.parent.postMessage(
      {
        source: 'gpc-fiori-proxy-poc',
        type,
        detail: detail || {}
      },
      trustedParentOrigin
    );
  }

  function notifyCurrentState() {
    notifyParent(
      f2403Ready ? 'GPC_ECM_F2403_READY' : 'GPC_ECM_PROXY_READY',
      { proxyOrigin: window.location.origin }
    );
  }

  rememberTrustedParent(getReferrerOrigin());

  if (trustedParentOrigin) {
    notifyCurrentState();
  }

  function canUnlock() {
    return Boolean(trustedParentOrigin && iframe.contentWindow);
  }

  function unlock(reason) {
    if (!canUnlock()) return false;

    iframe.contentWindow.postMessage(
      'SAPFrameProtection*parent-unlocked',
      window.location.origin
    );

    console.debug('[GPC F2403] parent-unlocked enviado', {
      reason,
      attempt: unlockAttempts,
      trustedParentOrigin,
      f2403Ready
    });
    return true;
  }

  function stopPersistentUnlock() {
    if (unlockTimer) {
      window.clearInterval(unlockTimer);
      unlockTimer = null;
    }
  }

  function startPersistentUnlock(reason) {
    if (unlockTimer) {
      unlock(reason);
      return;
    }

    unlockAttempts = 0;
    unlock(reason);

    unlockTimer = window.setInterval(function () {
      unlockAttempts += 1;
      unlock('retry');

      if (unlockAttempts >= MAX_UNLOCK_ATTEMPTS) {
        stopPersistentUnlock();
      }
    }, UNLOCK_INTERVAL_MS);
  }

  window.addEventListener('message', function (event) {
    const requestFromFiori =
      event.source === iframe.contentWindow &&
      event.origin === window.location.origin &&
      event.data === 'SAPFrameProtection*require-origin';

    if (requestFromFiori) {
      unlock('fiori-require-origin');
      return;
    }

    const requestFromParent =
      event.source === window.parent &&
      event.data === 'GPC_ECM_UNLOCK_F2403' &&
      rememberTrustedParent(event.origin);

    if (requestFromParent) {
      // ecm-iframe.js manda varios reintentos de unlock. Una vez que F2403
      // está listo no debemos volver a anunciar PROXY_READY porque eso hace
      // que el monitor vuelva a mostrar el overlay de carga.
      notifyCurrentState();
      startPersistentUnlock('parent-request');
    }
  });

  window.addEventListener('gpc:f2403-ready', function () {
    f2403Ready = true;
    notifyCurrentState();
    startPersistentUnlock('f2403-ready');
  });

  iframe.addEventListener('load', function () {
    startPersistentUnlock('iframe-load');
  });
})();
