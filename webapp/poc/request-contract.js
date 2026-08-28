(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  const cxTitle = clean(params.get("cxTitle"));
  const cxOpportunityId = clean(params.get("cxOpportunityId"));
  const cxDivision = clean(params.get("cxDivision"));
  const requestedContext = clean(params.get("cxContext"));
  const cxAmount = clean(params.get("cxAmount"));
  const cxCurrency = clean(params.get("cxCurrency"));
  const cxAmountSource = clean(params.get("cxAmountSource"));
  const cxProduct = clean(params.get("cxProduct"));
  const cxClientBp = clean(params.get("cxClientBp"));
  const cxClientType = clean(params.get("cxClientType"));
  const cxPrimaryContactBp = clean(params.get("cxPrimaryContactBp"));
  const cxSignerBp = clean(params.get("cxSignerBp"));
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

  const cxContext = resolveContext(cxDivision, requestedContext);
  const iframe = document.getElementById("fiori");
  const status = document.getElementById("status");

  let prefillApplied = false;
  const populatedEntityPaths = new Set();
  const populatedExternalContactPaths = new Set();

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

  function resolveContext(division, override) {
    if (division === "70") {
      if (!override) {
        return contextByDivision[division];
      }

      if (override === "20099") {
        return "20099";
      }

      console.error(
        "[CX F2403 POC] Contexto de Publicidad no permitido. Para Licitaciones GDL use cxContext=20099; sin override se usa Intercambio publicitario 20125.",
        { division, override }
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

  function applyExtendedHeaderPrefill(model, ctx) {
    if (cxAmount) {
      model.setProperty("ZZ1_MontoAprobacin_LTH", cxAmount, ctx);
    }

    if (cxCurrency) {
      model.setProperty("ZZ1_MontoAprobacin_LTHC", cxCurrency, ctx);
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

  function schedulePartyPrefill(view, model) {
    const entitiesSmartTable = view.byId("entitiesSmartTable");
    const externalSmartTable = view.byId("extContactsSmartTable");

    const applyEntities = () => applyEntityPrefill(entitiesSmartTable, model);
    const applyExternal = () => applyExternalContactPrefill(externalSmartTable, model);

    if (
      entitiesSmartTable &&
      typeof entitiesSmartTable.attachDataReceived === "function"
    ) {
      entitiesSmartTable.attachDataReceived(applyEntities);
    }

    if (
      externalSmartTable &&
      typeof externalSmartTable.attachDataReceived === "function"
    ) {
      externalSmartTable.attachDataReceived(applyExternal);
    }

    /*
     * Los SmartTables pueden bindearse antes o después de entrar al paso Partes.
     * Probamos de inmediato y dejamos algunos reintentos no bloqueantes como
     * respaldo; dataReceived cubre los rebinds posteriores.
     */
    [0, 250, 750, 1500, 3000, 5000, 8000, 12000, 20000].forEach(
      (delay) => {
        window.setTimeout(() => {
          applyEntities();
          applyExternal();
        }, delay);
      }
    );
  }

  function getRows(smartTable) {
    if (!smartTable || typeof smartTable.getTable !== "function") {
      return [];
    }
    const table = smartTable.getTable();
    return table && typeof table.getItems === "function"
      ? table.getItems()
      : [];
  }

  function applyEntityPrefill(smartTable, model) {
    if (!cxClientBp) return;

    for (const row of getRows(smartTable)) {
      const rowCtx = row.getBindingContext?.();
      if (!rowCtx) continue;

      const path = rowCtx.getPath();
      const entity = model.getObject(path) || {};
      const typeName = normalize(
        entity.LglCntntMEntityTypeName || entity.LglCntntMEntityName
      );

      if (!typeName.includes("cliente")) continue;

      let property = "";
      switch (clean(entity.LglCntntMTechEntityType)) {
        case "02":
          property = "LglCntntMEntityCustomer";
          break;
        case "06":
          property = "LglCntntMEntityBusinessPartner";
          break;
        default:
          console.warn(
            "[CX F2403 POC] Se encontró la entidad Cliente, pero su tipo técnico no está soportado para prefill automático.",
            {
              path,
              type: entity.LglCntntMEntityType,
              typeName: entity.LglCntntMEntityTypeName,
              technicalType: entity.LglCntntMTechEntityType,
              clientTypeFromCx: cxClientType
            }
          );
          continue;
      }

      if (
        populatedEntityPaths.has(path) &&
        clean(model.getProperty(property, rowCtx)) === cxClientBp
      ) {
        continue;
      }

      model.setProperty(property, cxClientBp, rowCtx);
      fireBoundValueChange(row, property, cxClientBp);
      populatedEntityPaths.add(path);

      console.info(
        "[CX F2403 POC] Cliente precargado en Entidades",
        {
          path,
          property,
          value: cxClientBp,
          technicalType: entity.LglCntntMTechEntityType
        }
      );
    }
  }

  function applyExternalContactPrefill(smartTable, model) {
    if (!cxSignerBp && !cxPrimaryContactBp) return;

    for (const row of getRows(smartTable)) {
      const rowCtx = row.getBindingContext?.();
      if (!rowCtx) continue;

      const path = rowCtx.getPath();
      const contact = model.getObject(path) || {};
      const type = clean(contact.LglCntntMExtCntctType);
      const typeName = normalize(contact.LglCntntMExtCntctTypeName);

      let value = "";
      let role = "";

      if (
        type === "0001" ||
        typeName.includes("contacto principal")
      ) {
        value = cxPrimaryContactBp;
        role = "Contacto principal";
      } else if (
        type === "0002" ||
        typeName === "firmante" ||
        typeName.includes("firmante")
      ) {
        value = cxSignerBp;
        role = "Firmante";
      }

      if (!value) continue;

      if (
        populatedExternalContactPaths.has(path) &&
        clean(model.getProperty("LglCntntMExtCntctBP", rowCtx)) === value
      ) {
        continue;
      }

      model.setProperty("LglCntntMExtCntctBP", value, rowCtx);
      fireBoundValueChange(row, "LglCntntMExtCntctBP", value);
      populatedExternalContactPaths.add(path);

      console.info(
        "[CX F2403 POC] Contacto externo precargado",
        { path, role, type, value }
      );
    }
  }

  function fireBoundValueChange(row, property, value) {
    if (!row || typeof row.findAggregatedObjects !== "function") return;

    const controls = row.findAggregatedObjects(true, (control) => {
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
      applyExtendedHeaderPrefill(model, ctx);
      schedulePartyPrefill(view, model);
      win.sap.ui.getCore().applyChanges();

      const result = model.getObject(ctx.getPath());

      console.log(
        "[CX F2403 POC] Prefill aplicado",
        {
          cxTitle,
          cxOpportunityId,
          cxDivision,
          requestedContext: requestedContext || null,
          cxContext,
          cxAmount: cxAmount || null,
          cxAmountSource: cxAmountSource || null,
          cxCurrency: cxCurrency || null,
          cxProduct: cxProduct || null,
          cxClientBp: cxClientBp || null,
          cxClientType: cxClientType || null,
          cxPrimaryContactBp: cxPrimaryContactBp || null,
          cxSignerBp: cxSignerBp || null,
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