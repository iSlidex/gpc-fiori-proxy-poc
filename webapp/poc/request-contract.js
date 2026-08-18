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
    "60": "20107"
    // Pendiente: agregar los otros tres mappings confirmados.
  });

  const cxContext = contextByDivision[cxDivision];

  const iframe = document.getElementById("fiori");
  const status = document.getElementById("status");

  let prefillApplied = false;
  let prefillInProgress = false;

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

  async function waitForF2403() {
    /*
     * FLP puede terminar de cargar antes que la aplicación F2403.
     * Por eso esperamos hasta encontrar:
     *
     * - SAPUI5
     * - la vista Create
     * - el controller
     * - el binding context
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
        obj.LegalTransactionTitle === cxTitle &&
        obj.LglCntntMContext === cxContext &&
        obj.LglCntntMContextUUID &&
        controller._contextGUID &&
        Array.isArray(controller._aStepsIndices) &&
        controller._aStepsIndices.length > 0;

      if (initialized) {
        return;
      }

      await sleep(250);
    }

    throw new Error(
      "El contexto fue asignado, pero F2403 no terminó de inicializarlo."
    );
  }

  function getCurrentF2403State() {
    try {
      const win = iframe.contentWindow;

      if (!win || !win.sap || !win.sap.ui) {
        return null;
      }

      const core = win.sap.ui.getCore();
      const view = core.byId(
        "application-LegalTransaction-create-component---create"
      );

      if (!view) {
        return null;
      }

      const controller = view.getController();
      const model = controller && controller.getModel();
      const ctx = view.getBindingContext();

      if (!controller || !model || !ctx) {
        return null;
      }

      return {
        win,
        view,
        controller,
        model,
        ctx
      };
    } catch (error) {
      return null;
    }
  }

  function hasExpectedPrefill(state) {
    if (!state) {
      return false;
    }

    const obj =
      state.model.getObject(state.ctx.getPath());

    return Boolean(
      obj &&
      obj.LegalTransactionTitle === cxTitle &&
      obj.LglCntntMContext === cxContext &&
      obj.LglCntntMContextUUID &&
      state.controller._contextGUID &&
      Array.isArray(
        state.controller._aStepsIndices
      ) &&
      state.controller._aStepsIndices.length > 0
    );
  }

  async function waitForPrefillStability() {
    /*
     * F2403 puede recrear el binding context después de que la
     * vista y el UUID ya existen. Exigimos varias lecturas
     * consecutivas sobre el estado más reciente antes de dar
     * el prefill por terminado.
     */
    let stableSamples = 0;
    let expectedStateWasSeen = false;

    for (let attempt = 0; attempt < 80; attempt++) {
      const state = getCurrentF2403State();

      if (hasExpectedPrefill(state)) {
        expectedStateWasSeen = true;
        stableSamples++;

        if (stableSamples >= 12) {
          return state;
        }
      } else {
        if (expectedStateWasSeen) {
          return null;
        }

        stableSamples = 0;
      }

      await sleep(250);
    }

    return null;
  }

  async function applyPrefillOnce() {
    const {
      win,
      view,
      controller,
      model,
      ctx
    } = await waitForF2403();

    /*
     * IMPORTANTE: título primero. basicDataValidation() consulta
     * el título antes de ejecutar GET_STEP_SEQUENCE.
     */
    model.setProperty(
      "LegalTransactionTitle",
      cxTitle,
      ctx
    );

    /*
     * Contexto después.
     */
    model.setProperty(
      "LglCntntMContext",
      cxContext,
      ctx
    );

    /*
     * Sincronizamos los bindings visuales antes de lanzar
     * changeModelValue.
     */
    win.sap.ui.getCore().applyChanges();

    const contextField =
      view.byId("idLglCntntMContext");

    if (!contextField) {
      throw new Error(
        "No se encontró idLglCntntMContext."
      );
    }

    /*
     * Este es el mismo evento que la vista estándar F2403
     * conecta con basicDataValidation().
     */
    if (
      typeof contextField.fireChangeModelValue === "function"
    ) {
      contextField.fireChangeModelValue();
    } else {
      contextField.fireEvent(
        "changeModelValue"
      );
    }

    await waitForContextInitialization(
      controller,
      model,
      ctx
    );
  }

  function logSuccessfulPrefill(state, attempt) {
    const result =
      state.model.getObject(state.ctx.getPath());

    console.log(
      "[CX F2403 POC] Prefill aplicado",
      {
        attempt,
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
          state.controller._contextGUID,

        steps:
          state.controller._aStepsIndices
      }
    );
  }

  async function applyPrefill() {
    if (prefillApplied || prefillInProgress) {
      return;
    }

    prefillInProgress = true;

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

      let lastError;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await applyPrefillOnce();

          const stableState =
            await waitForPrefillStability();

          if (!stableState) {
            throw new Error(
              "F2403 reinicializó el modelo después del prefill."
            );
          }

          logSuccessfulPrefill(
            stableState,
            attempt
          );

          prefillApplied = true;
          hideStatus();
          return;
        } catch (error) {
          lastError = error;

          console.warn(
            "[CX F2403 POC] Reintentando prefill",
            {
              attempt,
              error: error.message
            }
          );

          if (attempt < 3) {
            setStatus(
              "F2403 continúa inicializándose. Reintentando..."
            );
            await sleep(500);
          }
        }
      }

      throw lastError;
    } catch (error) {
      console.error(
        "[CX F2403 POC] Error",
        error
      );

      setStatus(
        "Error inicializando F2403: " +
        error.message
      );
    } finally {
      prefillInProgress = false;
    }
  }

  iframe.addEventListener("load", function () {
    applyPrefill();
  });

})();