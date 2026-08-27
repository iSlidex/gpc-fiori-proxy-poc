(function () {
  'use strict';

  const iframe = document.getElementById('fiori');
  if (!iframe) return;

  const trustedOrigins = new Set([
    'https://my1002084.us1.test.crm.cloud.sap',
    'https://gpc-creacion-solicitud-contrato.cfapps.us10-001.hana.ondemand.com'
  ]);

  let trustedParentOrigin = '';

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

  rememberTrustedParent(getReferrerOrigin());

  function canUnlock() {
    return Boolean(trustedParentOrigin && iframe.contentWindow);
  }

  function unlock() {
    if (!canUnlock()) return;

    iframe.contentWindow.postMessage(
      'SAPFrameProtection*parent-unlocked',
      window.location.origin
    );
  }

  function scheduleUnlocks() {
    [0, 200, 500, 1000, 2000, 4000, 7000].forEach(function (delay) {
      window.setTimeout(unlock, delay);
    });
  }

  window.addEventListener('message', function (event) {
    const requestFromFiori =
      event.source === iframe.contentWindow &&
      event.origin === window.location.origin &&
      event.data === 'SAPFrameProtection*require-origin';

    if (requestFromFiori) {
      unlock();
      return;
    }

    const requestFromParent =
      event.source === window.parent &&
      event.data === 'GPC_ECM_UNLOCK_F2403' &&
      rememberTrustedParent(event.origin);

    if (requestFromParent) {
      scheduleUnlocks();
    }
  });

  iframe.addEventListener('load', scheduleUnlocks);
})();
