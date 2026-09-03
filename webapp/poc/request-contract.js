(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  const cxTitle = clean(params.get("cxTitle"));
  const cxOpportunityId = clean(params.get("cxOpportunityId"));
  const cxDivision = clean(params.get("cxDivision"));
  const requestedContext = clean(params.get("cxContext"));
  const cxSalesCycle = clean(params.get("cxSalesCycle"));
  const cxSalesCycleDescription = clean(
    params.get("cxSalesCycleDescription")
  );
  const cxAmount = clean(params.get("cxAmount"));
  const cxCurrency = clean(params.get("cxCurrency"));
  const cxAmountSource = clean(params.get("cxAmountSource"));
  const cxProduct = clean(params.get("cxProduct"));
  const cxPep = parseOptionalBoolean(params.get("cxPep"));

  /*
   * La división proviene de la Opportunity en CX.
   * El value help vivo de F2403 confirmó para división 70:
   * - 20125: Intercambio publicitario (flujo estándar)
   * - 20099: Licitaciones GDL (override explícito desde CX)
   * El ID histórico 20012 no se usa porque F2403 no logra inicializarlo.
   */
  const contextByDivision = Object.freeze({
    "10": "20098",
    "11": "20096",
    "60": "20107",
    "70": "20125"
  });

  const cxContext = resolveContext(
    cxDivision,
    requestedContext,
    cxSalesCycle,
    cxSalesCycleDescription
  );
  const iframe = document.getElementById("fiori");
  const status = document.getElementById("status");

  let prefillApplied = false;
  let approvalModelListenerAttached = false;
  const approvalSyncControls = new WeakSet();
  const approvalFieldPairs = Object.freeze([
    {
      visible: "ZZ1_MONTO_LTH",
      approved: "ZZ1_MontoAprobacin_LTH"
    },
    {
      visible: "ZZ1_MonedaMonto_LTH",
      approved: "ZZ1_MontoAprobacin_LTHC"
    }
  ]);

  function clean(value) {
    return value === null || value === undefined
      ? ""
      : String(value).trim();
  }

  function normalize(value) {
    return clean(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function parseOptionalBoolean(value) {
    const text = normalize(value);
    if (!text) return null;
    if (["true", "1", "si", "yes"].includes(text)) return true;
    if (["false", "0", "no"].includes(text)) return false;
    return null;
  }

  function resolveContext(
    division,
    override,
    salesCycle,
    salesCycleDescription
  ) {
    if (division === "70") {
      if (isTenderSalesCycle(salesCycle, salesCycleDescription)) {
        return "20099";
      }

      if (!override) {
        return contextByDivision[division];
      }

      if (override === "20099") {
        console.warn(
          "[CX F2403 POC] Se usó cxContext=20099 como compatibilidad. En la integración productiva Licitaciones se determina por el ciclo de ventas.",
          { division, override, salesCycle, salesCycleDescription }
        );
        return "20099";
      }

      console.error(
        "[CX F2403 POC] Contexto de Publicidad no permitido. Licitaciones GDL se determina por el ciclo de ventas; las demás oportunidades usan Intercambio publicitario 20125.",
        { division, override, salesCycle, salesCycleDescription }
      );
      return "";
    }

    if (override) {
      console.warn(
        "[CX F2403 POC] cxContext ignorado. Los overrides explícitos solo están habilitados actualmente para división 70.",
        { division, override }
      );
    }

    return contextByDivision[division];
  }

  function isTenderSalesCycle(salesCycle, salesCycleDescription) {
    const description = normalize(
      salesCycleDescription || salesCycle
    );
    return description.includes("licitacion");
  }

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

  function applyExtendedHeaderPrefill(view, model, ctx) {
    /*
     * F2403 expone dos pares para el monto. Las propiedades
     * ZZ1_MONTO_LTH / ZZ1_MonedaMonto_LTH son las que están enlazadas
     * a los controles visibles; el par MontoAprobacin conserva los
     * valores técnicos que viajan en la entidad transitoria.
     */
    if (cxAmount) {
      model.setProperty("ZZ1_MontoAprobacin_LTH", cxAmount, ctx);
      model.setProperty("ZZ1_MONTO_LTH", cxAmount, ctx);
      fireBoundValueChange(view, "ZZ1_MONTO_LTH", cxAmount);
    }

    if (cxCurrency) {
      model.setProperty("ZZ1_MontoAprobacin_LTHC", cxCurrency, ctx);
      model.setProperty("ZZ1_MonedaMonto_LTH", cxCurrency, ctx);
      fireBoundValueChange(view, "ZZ1_MonedaMonto_LTH", cxCurrency);
    }

    if (cxAmount || cxCurrency) {
      console.info(
        "[CX F2403 POC] Monto y moneda precargados",
        {
          ZZ1_MontoAprobacin_LTH:
            model.getProperty("ZZ1_MontoAprobacin_LTH", ctx),
          ZZ1_MontoAprobacin_LTHC:
            model.getProperty("ZZ1_MontoAprobacin_LTHC", ctx),
          ZZ1_MONTO_LTH:
            model.getProperty("ZZ1_MONTO_LTH", ctx),
          ZZ1_MonedaMonto_LTH:
            model.getProperty("ZZ1_MonedaMonto_LTH", ctx)
        }
      );
    }

    if (cxPep !== null) {
      model.setProperty("ZZ1_PersonaespecialPEP_LTH", cxPep, ctx);
    }

    if (cxProduct) {
      const productProperty = findProductProperty(model, ctx);
      if (productProperty) {
        model.setProperty(productProperty, cxProduct, ctx);
        console.info(
          "[CX F2403 POC] Producto precargado",
          { property: productProperty, value: cxProduct }
        );
      } else {
        console.warn(
          "[CX F2403 POC] CX envió Producto, pero el metadata actual de C_LegalContentRequest no expone una propiedad identificable como Producto.",
          { cxProduct }
        );
      }
    }

    if (cxAmountSource === "opportunityFallback") {
      console.warn(
        "[CX F2403 POC] Monto precargado desde Opportunity como fallback. Funcionalmente el origen definitivo debe ser la cotización aprobada."
      );
    }
  }

  function findProductProperty(model, ctx) {
    const rootObject = model.getObject(ctx.getPath()) || {};
    const directProperty = Object.keys(rootObject).find((name) =>
      normalize(name).includes("producto") ||
      normalize(name).includes("product")
    );
    if (directProperty) return directProperty;

    let metadata;
    try {
      metadata = model.getServiceMetadata();
    } catch (_error) {
      return "";
    }

    const schemas = metadata?.dataServices?.schema || [];
    for (const schema of schemas) {
      for (const entityType of schema.entityType || []) {
        if (!normalize(entityType.name).includes("legalcontentrequest")) {
          continue;
        }

        for (const property of entityType.property || []) {
          const labelExtension = (property.extensions || []).find(
            (extension) => normalize(extension.name) === "label"
          );
          const label = normalize(labelExtension?.value);
          const name = normalize(property.name);

          if (
            label === "producto" ||
            label === "product" ||
            name.includes("producto") ||
            name.includes("product")
          ) {
            return property.name;
          }
        }
      }
    }

    return "";
  }

  function boundValueControls(container, property) {
    if (
      !container ||
      typeof container.findAggregatedObjects !== "function"
    ) {
      return [];
    }

    return container.findAggregatedObjects(true, (control) => {
      if (!control || typeof control.getBindingInfo !== "function") {
        return false;
      }

      const bindingInfo = control.getBindingInfo("value");
      if (!bindingInfo) return false;

      const paths = [];
      if (bindingInfo.path) paths.push(bindingInfo.path);
      for (const part of bindingInfo.parts || []) {
        if (part?.path) paths.push(part.path);
      }

      return paths.includes(property);
    });
  }

  function syncApprovalFields(model, ctx, reason) {
    const changes = {};

    for (const pair of approvalFieldPairs) {
      const visibleValue = model.getProperty(pair.visible, ctx);
      const approvedValue = model.getProperty(pair.approved, ctx);

      if (clean(visibleValue) === clean(approvedValue)) {
        continue;
      }

      model.setProperty(pair.approved, visibleValue, ctx);
      changes[pair.approved] = visibleValue;
    }

    if (Object.keys(changes).length) {
      console.info(
        "[CX F2403 POC] Campos de aprobación sincronizados",
        { reason, ...changes }
      );
    }
  }

  function scheduleApprovalFieldSync(view, model, ctx) {
    const scheduleSync = (reason) => {
      window.setTimeout(
        () => syncApprovalFields(model, ctx, reason),
        0
      );
    };

    if (
      !approvalModelListenerAttached &&
      typeof model.attachPropertyChange === "function"
    ) {
      model.attachPropertyChange((event) => {
        const path = clean(event.getParameter?.("path"));
        const property = path.split("/").filter(Boolean).pop();

        if (
          approvalFieldPairs.some((pair) => pair.visible === property)
        ) {
          scheduleSync("model-property-change");
        }
      });
      approvalModelListenerAttached = true;
    }

    /*
     * El evento propertyChange cubre la edición two-way del modelo. También
     * conectamos los controles visibles como respaldo para SmartField/inputs
     * que actualizan el binding durante su propio evento change.
     */
    [0, 250, 750, 1500, 3000, 5000].forEach((delay) => {
      window.setTimeout(() => {
        for (const pair of approvalFieldPairs) {
          for (const control of boundValueControls(view, pair.visible)) {
            if (
              approvalSyncControls.has(control) ||
              typeof control.attachChange !== "function"
            ) {
              continue;
            }

            control.attachChange(() => {
              scheduleSync("control-change");
            });
            approvalSyncControls.add(control);
          }
        }
      }, delay);
    });
  }

  function fireBoundValueChange(container, property, value) {
    if (
      !container ||
      typeof container.findAggregatedObjects !== "function"
    ) {
      return;
    }

    const controls = container.findAggregatedObjects(true, (control) => {
      if (!control || typeof control.getBindingInfo !== "function") {
        return false;
      }

      const bindingInfo = control.getBindingInfo("value");
      if (!bindingInfo) return false;

      const paths = [];
      if (bindingInfo.path) paths.push(bindingInfo.path);
      for (const part of bindingInfo.parts || []) {
        if (part?.path) paths.push(part.path);
      }

      return paths.includes(property);
    });

    const control = controls[0];
    if (!control) return;

    try {
      if (typeof control.fireChange === "function") {
        control.fireChange({ value, newValue: value });
      } else if (typeof control.fireEvent === "function") {
        control.fireEvent("change", { value, newValue: value });
      }
    } catch (error) {
      console.warn(
        "[CX F2403 POC] El valor se escribió en el modelo, pero no se pudo disparar el change del control.",
        { property, value, error }
      );
    }
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
          " no tiene un contexto S/4 válido para los parámetros recibidos."
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

      /*
       * Estos campos se aplican después de inicializar el contexto porque
       * F2403 puede recalcular el modelo al ejecutar GET_STEP_SEQUENCE.
       */
      scheduleApprovalFieldSync(view, model, ctx);
      applyExtendedHeaderPrefill(view, model, ctx);
      win.sap.ui.getCore().applyChanges();

      const result = model.getObject(ctx.getPath());

      console.log(
        "[CX F2403 POC] Prefill aplicado",
        {
          cxTitle,
          cxOpportunityId,
          cxDivision,
          requestedContext: requestedContext || null,
          cxSalesCycle: cxSalesCycle || null,
          cxSalesCycleDescription:
            cxSalesCycleDescription || null,
          cxContext,
          cxAmount: cxAmount || null,
          cxAmountSource: cxAmountSource || null,
          cxCurrency: cxCurrency || null,
          cxProduct: cxProduct || null,
          parties: "manual",
          cxPep,
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
          ZZ1_MontoAprobacin_LTH:
            result.ZZ1_MontoAprobacin_LTH,
          ZZ1_MontoAprobacin_LTHC:
            result.ZZ1_MontoAprobacin_LTHC,
          ZZ1_MONTO_LTH:
            result.ZZ1_MONTO_LTH,
          ZZ1_MonedaMonto_LTH:
            result.ZZ1_MonedaMonto_LTH,
          ZZ1_MonedaMonto_LTHT:
            result.ZZ1_MonedaMonto_LTHT,
          ZZ1_PersonaespecialPEP_LTH:
            result.ZZ1_PersonaespecialPEP_LTH,
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