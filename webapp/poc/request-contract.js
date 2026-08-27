(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  const cxTitle = (params.get("cxTitle") || "").trim();
  const cxOpportunityId = (
    params.get("cxOpportunityId") || ""
  ).trim();
  const cxDivision = (
    params.get("cxDivision") || ""
  ).trim();

  /*
   * La división proviene de la Opportunity en CX.
   * Solo se agregan mappings confirmados contra la configuración
   * vigente de S/4; no usar IDs históricos ni UUIDs de contexto.
   */
  const contextByDivision = Object.freeze({
    "10": "20098",
    "11": "20096",
    "60": "20107",
    "70": "20099"
  });

  const cxContext = contextByDivision[cxDivision];
  const iframe = document.getElementById("fiori");
  const status = document.getElementById("status");

  let prefillApplied = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setStatus(message) {
    if (status) {
      status.textContent = message;
      status.style.display = "block";
    }
  }

  function hideStatus() {
    if (status) {
      status.style.display = "none";
    }
  }

  function notifyF2403Ready() {
    window.dispatchEvent(
      new CustomEvent("gpc:f2403-ready", {
        detail: { timestamp: Date.now() }
      })
    );
  }

  async function waitForF2403() {
    /*
     * FLP puede terminar de cargar antes que la aplicación F2403.
     * Esperamos hasta encontrar SAPUI5, la vista Create, su controller,
     * modelo y binding context. En ese instante notificamos al bridge
     * de frame protection para que envíe parent-unlocked justo cuando
     * F2403 ya está preparado para procesarlo.
     */
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const win = iframe.contentWindow;

        if (!win || !win.sap || !win.sap.ui) {
          await sleep(250);
          continue;
        }

        const core = win.sap.ui.getCore();
        const view = core.byId(
          "application-LegalTransaction-create-component---create"
        );

        if (!view) {
          await sleep(250);
          continue;
        }

        const controller = view.getController();
        if (!controller) {
          await sleep(250);
          continue;
        }

        const model = controller.getModel();
        const ctx = view.getBindingContext();

        if (!model || !ctx) {
          await sleep(250);
          continue;
        }

        notifyF2403Ready();

        return {
          win,
          core,
          view,
          controller,
          model,
          ctx
        };
      } catch (error) {
        console.debug(
          "[CX F2403 POC] Esperando aplicación...",
          error
        );
      }

      await sleep(250);
    }

    throw new Error(
      "F2403 no estuvo disponible dentro del tiempo esperado."
    );
  }

  async function waitForContextInitialization(
    controller,
    model,
    ctx
  ) {
    if (!cxContext) {
      return;
    }

    for (let attempt = 0; attempt < 80; attempt++) {
      const obj = model.getObject(ctx.getPath());

      const initialized =
        obj &&
        obj.LglCntntMContextUUID &&
        controller._contextGUID;

      if (initialized) {
        return;
      }

      await sleep(250);
    }

    throw new Error(
      "El contexto fue asignado, pero F2403 no terminó de inicializarlo."
    );
  }

  async function applyPrefill() {
    if (prefillApplied) {
      return;
    }

    try {
      setStatus("Inicializando solicitud de contrato...");

      if (!cxTitle) {
        throw new Error(
          "CX no envió el título de la Opportunity (cxTitle)."
        );
      }

      if (!cxDivision) {
        throw new Error(
          "CX no envió la división de la Opportunity (cxDivision)."
        );
      }

      if (!cxContext) {
        throw new Error(
          "La división CX " +
          cxDivision +
          " todavía no tiene un contexto S/4 configurado."
        );
      }

      if (!cxOpportunityId) {
        console.warn(
          "[CX F2403 POC] CX no envió cxOpportunityId."
        );
      }

      const {
        win,
        view,
        controller,
        model,
        ctx
      } = await waitForF2403();

      /*
       * Título primero: basicDataValidation() consulta el título antes
       * de ejecutar GET_STEP_SEQUENCE.
       */
      model.setProperty(
        "LegalTransactionTitle",
        cxTitle,
        ctx
      );

      /* Contexto después. */
      model.setProperty(
        "LglCntntMContext",
        cxContext,
        ctx
      );

      win.sap.ui.getCore().applyChanges();

      const contextField = view.byId("idLglCntntMContext");

      if (!contextField) {
        throw new Error(
          "No se encontró idLglCntntMContext."
        );
      }

      if (
        typeof contextField.fireChangeModelValue === "function"
      ) {
        contextField.fireChangeModelValue();
      } else {
        contextField.fireEvent("changeModelValue");
      }

      await waitForContextInitialization(
        controller,
        model,
        ctx
      );

      const result = model.getObject(ctx.getPath());

      console.log(
        "[CX F2403 POC] Prefill aplicado",
        {
          cxTitle,
          cxOpportunityId,
          cxDivision,
          cxContext,
          LegalTransactionTitle:
            result.LegalTransactionTitle,
          LglCntntMContext:
            result.LglCntntMContext,
          LglCntntMContextUUID:
            result.LglCntntMContextUUID,
          LglCntntMContextTitle:
            result.LglCntntMContextTitle,
          LglCntntMProfile:
            result.LglCntntMProfile,
          contextGUID:
            controller._contextGUID,
          steps:
            controller._aStepsIndices
        }
      );

      prefillApplied = true;
      hideStatus();
    } catch (error) {
      console.error(
        "[CX F2403 POC] Error",
        error
      );

      setStatus(
        "Error inicializando F2403: " +
        error.message
      );
    }
  }

  iframe.addEventListener("load", function () {
    applyPrefill();
  });

  /*
   * Iniciamos F2403 después de registrar el listener de carga.
   * frame-unlock.js ya está cargado previamente desde el HTML.
   */
  const fioriSrc = iframe.dataset.src;

  if (!fioriSrc) {
    setStatus(
      "Error inicializando F2403: no se configuró data-src."
    );
    return;
  }

  iframe.src = fioriSrc;
})();
