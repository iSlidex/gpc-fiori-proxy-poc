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

  function isTrustedOrigin(origin) {
    return trustedOrigins.has(origin) || isBasPreviewOrigin(origin);
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

  rememberTrustedParent(getReferrerOrigin());

  if (trustedParentOrigin) {
    notifyParent('GPC_ECM_PROXY_READY', {
      proxyOrigin: window.location.origin
    });
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
      trustedParentOrigin
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
    /*
     * Si ya existe un ciclo activo no lo reiniciamos. Enviamos un
     * parent-unlocked inmediato y conservamos los reintentos que ya
     * estaban programados.
     */
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
      notifyParent('GPC_ECM_PROXY_READY', {
        proxyOrigin: window.location.origin
      });
      startPersistentUnlock('parent-request');
    }
  });

  /*
   * request-contract.js emite este evento cuando la vista Create,
   * controller, modelo y binding context de F2403 ya existen. Este es
   * el momento de mayor probabilidad de que frameOptions procese el
   * mensaje inmediatamente.
   */
  window.addEventListener('gpc:f2403-ready', function () {
    notifyParent('GPC_ECM_F2403_READY', {
      proxyOrigin: window.location.origin
    });
    startPersistentUnlock('f2403-ready');
  });

  iframe.addEventListener('load', function () {
    startPersistentUnlock('iframe-load');
  });
})();
