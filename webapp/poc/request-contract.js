(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  const cxTitle = clean(params.get("cxTitle"));
  const cxSourceType = clean(params.get("cxSourceType")).toUpperCase() ||
    "OPPORTUNITY";
  const cxOpportunityId = clean(params.get("cxOpportunityId"));
  const cxServiceOrderUuid = clean(params.get("cxServiceOrderUuid"));
  const cxServiceOrderDisplayId = clean(
    params.get("cxServiceOrderDisplayId")
  );
  const cxServiceOrderExternalId = clean(
    params.get("cxServiceOrderExternalId")
  );
  const cxCaseUuid = clean(params.get("cxCaseUuid"));
  const cxCaseDisplayId = clean(params.get("cxCaseDisplayId"));
  const cxCaseType = clean(params.get("cxCaseType")).toUpperCase();
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
  const cxStartDate = clean(params.get("cxStartDate"));
  const cxEndDate = clean(params.get("cxEndDate"));
  const cxClientBp = clean(params.get("cxClientBp"));
  const cxClientName = clean(params.get("cxClientName"));
  const cxSalesOrganization = clean(
    params.get("cxSalesOrganization")
  );
  const cxSalesOrganizationName = clean(
    params.get("cxSalesOrganizationName")
  );
  const cxPrimaryContactBp = clean(params.get("cxPrimaryContactBp"));
  const cxPrimaryContactName = clean(params.get("cxPrimaryContactName"));
  const cxPrimaryContactEmail = clean(params.get("cxPrimaryContactEmail"));
  const cxSignerBp = clean(params.get("cxSignerBp"));
  const cxLegalContactBp = clean(params.get("cxLegalContactBp"));
  const cxTechnicalLocation = clean(params.get("cxTechnicalLocation")) ||
    (cxSourceType !== "CASE" ? cxProduct : "");
  const cxPep = parseOptionalBoolean(params.get("cxPep"));
  // Case and Service Order sources share the case-type driven context rules.
  const isCaseContextSource =
    cxSourceType === "CASE" || cxSourceType === "SERVICE_ORDER";

  /*
   * La división proviene de la Opportunity en CX.
   * El value help vivo de F2403 confirmó para división 70:
   * - 20125: Intercambio publicitario (flujo estándar)
   * - 20099: Licitaciones GDL (override explícito desde CX)
   * El ID histórico 20012 no se usa porque F2403 no logra inicializarlo.
   */
  const contextByDivision = Object.freeze({
    "11": "20096",
    "60": "20107",
    "70": "20125"
  });
  const contextByCaseType = Object.freeze({
    Z001: "20141",
    Z006: "20142"
  });

  const cxContext = resolveContext(
    cxDivision,
    requestedContext,
    cxSalesCycle,
    cxSalesCycleDescription
  );
  const iframe = document.getElementById("fiori");
  if (params.get("cxTitleFormat") === "v1") iframe.style.visibility = "hidden";
  const status = document.getElementById("status");

  let prefillApplied = false;
  let creationObserverAttached = false;
  let creationNotified = false;
  let approvalModelListenerAttached = false;
  let templateActionObserver = null;
  let entityModelListenerAttached = false;
  let entityPrefillInFlight = false;
  const entityPrefillTables = new WeakSet();
  const populatedEntityPaths = new Set();
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

  function scheduleTemplateCreationRemoval(win, view) {
    const labels = new Set([
      "crear a partir de plantilla",
      "create from template"
    ]);

    const isTemplateAction = (value) => labels.has(normalize(value));
    const hideUi5Action = () => {
      const controls = typeof view?.findAggregatedObjects === "function"
        ? view.findAggregatedObjects(true)
        : [];

      for (const control of controls) {
        const labelsToCheck = [
          control?.getText?.(),
          control?.getTitle?.(),
          control?.getTooltip_AsString?.()
        ];
        if (
          labelsToCheck.some(isTemplateAction) &&
          typeof control?.setVisible === "function"
        ) {
          control.setVisible(false);
        }
      }
    };

    const hideDomAction = () => {
      const doc = win?.document;
      if (!doc) return;

      for (const node of doc.querySelectorAll(
        '[role="menuitem"], .sapMMenuListItem, .sapMMenuItem'
      )) {
        if (!isTemplateAction(node.textContent)) continue;
        node.hidden = true;
        node.setAttribute("aria-hidden", "true");
        node.style.display = "none";
      }
    };

    const apply = () => {
      hideUi5Action();
      hideDomAction();
      win?.sap?.ui?.getCore?.().applyChanges();
    };

    [0, 250, 750, 1500, 3000, 5000].forEach(
      (delay) => window.setTimeout(apply, delay)
    );

    if (!templateActionObserver && win?.MutationObserver && win?.document) {
      templateActionObserver = new win.MutationObserver(apply);
      templateActionObserver.observe(win.document.documentElement, {
        childList: true,
        subtree: true
      });
      win.document.addEventListener("click", (event) => {
        const item = event.target?.closest?.(
          '[role="menuitem"], .sapMMenuListItem, .sapMMenuItem'
        );
        if (!item || !isTemplateAction(item.textContent)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
  }

  function resolveContext(
    division,
    override,
    salesCycle,
    salesCycleDescription
  ) {
    if (isCaseContextSource) {
      const expectedContext = contextByCaseType[cxCaseType];
      if (!expectedContext) {
        console.error(
          "[CX F2403 POC] Tipo de caso no habilitado.",
          { caseType: cxCaseType || null, supportedCaseTypes: ["Z001", "Z006"] }
        );
        return "";
      }
      if (!override || override === expectedContext) return expectedContext;

      console.error(
        "[CX F2403 POC] El contexto no corresponde al tipo de caso.",
        { caseType: cxCaseType, override, expectedContext }
      );
      return "";
    }

    if (division === "10") {
      const realEstateContexts = ["20150", "20151", "20152", "20153"];
      if (realEstateContexts.includes(override)) {
        return override;
      }
      if (override) {
        console.error(
          "[CX F2403 POC] Contexto inmobiliario no permitido.",
          { division, override }
        );
      }
      return "";
    }

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
    if (cxSourceType !== "CASE" && cxAmount) {
      model.setProperty("ZZ1_MontoAprobacin_LTH", cxAmount, ctx);
      model.setProperty("ZZ1_MONTO_LTH", cxAmount, ctx);
      fireBoundValueChange(view, "ZZ1_MONTO_LTH", cxAmount);
    }

    if (cxSourceType !== "CASE" && cxCurrency) {
      model.setProperty("ZZ1_MontoAprobacin_LTHC", cxCurrency, ctx);
      model.setProperty("ZZ1_MonedaMonto_LTH", cxCurrency, ctx);
      fireBoundValueChange(view, "ZZ1_MonedaMonto_LTH", cxCurrency);
    }

    if (cxSourceType !== "CASE" && (cxAmount || cxCurrency)) {
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

    if (cxSourceType !== "CASE" && cxPep !== null) {
      model.setProperty("ZZ1_PersonaespecialPEP_LTH", cxPep, ctx);
    }

    if (cxTechnicalLocation) {
      model.setProperty(
        "ZZ1_UbicacionTecnica_LTH",
        cxTechnicalLocation,
        ctx
      );
      fireBoundValueChange(
        view,
        "ZZ1_UbicacionTecnica_LTH",
        cxTechnicalLocation
      );
      console.info(
        "[CX F2403 POC] Ubicación técnica precargada",
        {
          source: cxSourceType === "CASE"
            ? "caseTechnicalLocation"
            : "opportunityProduct",
          value: cxTechnicalLocation
        }
      );
    }

    if (!isCaseContextSource && cxProduct) {
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

    if (
      cxSourceType !== "CASE" &&
      cxAmountSource === "opportunityFallback"
    ) {
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

      return paths.some((path) =>
        clean(path).split("/").filter(Boolean).pop() === property
      );
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

  function scheduleEntityPrefill(view, model) {
    if (!cxClientBp && !cxSalesOrganization) return;

    const apply = async (reason) => {
      if (entityPrefillInFlight) return;
      entityPrefillInFlight = true;
      try {
        await applyEntityPrefill(view, model, reason);
      } catch (error) {
        console.warn(
          "[CX F2403 POC] Falló el prefill asíncrono de Entidades.",
          { reason, error }
        );
      } finally {
        entityPrefillInFlight = false;
      }
    };

    const attachTableListeners = () => {
      const controls = typeof view?.findAggregatedObjects === "function"
        ? view.findAggregatedObjects(true)
        : [];

      for (const control of controls) {
        if (
          !control ||
          entityPrefillTables.has(control) ||
          typeof control.getTable !== "function" ||
          typeof control.attachDataReceived !== "function"
        ) {
          continue;
        }

        control.attachDataReceived(() => apply("table-data-received"));
        entityPrefillTables.add(control);
      }
    };

    if (
      !entityModelListenerAttached &&
      typeof model.attachRequestCompleted === "function"
    ) {
      model.attachRequestCompleted(() => {
        attachTableListeners();
        apply("model-request-completed");
      });
      entityModelListenerAttached = true;
    }

    /*
     * F2403 crea las filas de Entidades al materializar el paso Partes.
     * Los listeners cubren ese momento aunque ocurra mucho después de abrir
     * el formulario; los reintentos cubren filas ya presentes en el cache.
     */
    [0, 250, 750, 1500, 3000, 5000, 8000, 12000, 20000, 30000, 60000]
      .forEach((delay) => window.setTimeout(() => {
        attachTableListeners();
        apply(`retry-${delay}`);
      }, delay));
  }

  async function applyEntityPrefill(view, model, reason) {
    const requestedEntities = [
      {
        type: "0002",
        label: "Cliente",
        value: cxClientBp,
        property: "LglCntntMEntityCustomer",
        nameProperty: "BusinessPartnerName",
        fallbackName: cxClientName,
        valueHelpPath:
          `/C_LCMContactsOfCustomerVH(Customer='${escapeODataString(cxClientBp)}',CompanyCode='${escapeODataString(cxSalesOrganization)}')`
      },
      {
        type: "0004",
        label: "Organización de ventas",
        value: cxSalesOrganization,
        property: "LglCntntMEntitySlsOrg",
        nameProperty: "SalesOrganization_Text",
        fallbackName: cxSalesOrganizationName,
        valueHelpPath:
          `/C_LCMSalesOrganizationVH('${escapeODataString(cxSalesOrganization)}')`
      }
    ].filter((entity) => entity.value);

    if (!requestedEntities.length) return;

    /*
     * Las entidades de Partes son registros transitorios separados de la
     * cabecera. Después de GET_STEP_SEQUENCE aparecen directamente en el
     * cache OData como C_LegalTransactionEntity(...). Según el contexto,
     * pueden aparecer recién cuando el usuario entra al paso Partes.
     */
    const entityRows = Object.entries(model.oData || {}).filter(
      ([key, row]) =>
        key.startsWith("C_LegalTransactionEntity(") &&
        row &&
        row.LglCntntMEntityType
    );

    for (const requested of requestedEntities) {
      const match = entityRows.find(([, row]) =>
        clean(row.LglCntntMEntityType).padStart(4, "0") ===
          requested.type
      );
      if (!match) continue;

      const rowPath = `/${match[0].replace(/^\/+/, "")}`;
      const currentValue = clean(
        model.getProperty(`${rowPath}/${requested.property}`)
      );

      if (
        populatedEntityPaths.has(rowPath) &&
        currentValue === requested.value
      ) {
        continue;
      }

      /*
       * El ID es el dato funcional y no debe depender de que el value help
       * responda. El nombre descriptivo se completa después, si está
       * disponible, sin bloquear Cliente u Organización de ventas.
       */
      const applied = model.setProperty(
        `${rowPath}/${requested.property}`,
        requested.value
      );
      if (applied === false) continue;

      populatedEntityPaths.add(rowPath);

      if (requested.fallbackName) {
        model.setProperty(
          `${rowPath}/LglCntntMEntityName`,
          requested.fallbackName
        );
      }

      validateEntityWhenControlIsReady(view, rowPath, requested);

      try {
        const valueHelp = await readODataEntity(
          model,
          requested.valueHelpPath
        );
        const entityName = clean(
          valueHelp?.[requested.nameProperty]
        ) || requested.fallbackName;
        if (entityName) {
          model.setProperty(
            `${rowPath}/LglCntntMEntityName`,
            entityName
          );
        }
      } catch (error) {
        console.warn(
          `[CX F2403 POC] ${requested.label} fue precargado por ID, pero no fue posible resolver su nombre en el value help.`,
          { path: requested.valueHelpPath, error }
        );
      }

      console.info(
        `[CX F2403 POC] ${requested.label} precargado`,
        { reason, rowPath, value: requested.value }
      );
    }
  }

  function escapeODataString(value) {
    return clean(value).replace(/'/g, "''");
  }

  function readODataEntity(model, path) {
    return new Promise((resolve, reject) => {
      model.read(path, {
        success: resolve,
        error: reject
      });
    });
  }

  function queryExternalContactByFilter(
    model,
    filterExpression,
    extraParameters = {}
  ) {
    return new Promise((resolve, reject) => {
      model.read("/C_LglCntntMExtContactByBPVH", {
        urlParameters: { $filter: filterExpression, ...extraParameters },
        success: resolve,
        error: reject
      });
    });
  }

  const contactNameTitles = new Set([
    "dr", "dra", "sr", "sra", "srta", "lic", "licda",
    "ing", "mr", "mrs", "ms", "miss"
  ]);

  function normalizeContactName(value) {
    return normalize(value)
      .replace(/[.,]/g, " ")
      .split(/\s+/)
      .filter((word) => word && !contactNameTitles.has(word))
      .join(" ");
  }

  function contactNamesMatch(expected, candidateName) {
    const candidate = normalizeContactName(candidateName);
    if (!expected || !candidate) return false;
    if (expected === candidate) return true;
    return (
      expected.length >= 3 &&
      candidate.length >= 3 &&
      (candidate.includes(expected) || expected.includes(candidate))
    );
  }

  /*
   * CX no entrega el BP S/4 del contacto de una organización (solo su
   * displayId visible de CX, que no es una clave válida). Se resuelve la
   * persona dentro de las relaciones de la empresa cliente comparando primero
   * por correo y luego por nombre normalizado. Si no hay un único candidato,
   * el campo queda manual en vez de adivinar.
   */
  async function resolveExternalContactByCompany(model, clientBp, hints) {
    const filter =
      `BusinessPartnerCompany eq '${escapeODataString(clientBp)}'`;
    const response = await queryExternalContactByFilter(model, filter, {
      $top: 200
    });
    const candidates = Array.isArray(response?.results)
      ? response.results
      : [];
    const emailKey = normalize(hints.email);
    const nameKey = normalizeContactName(hints.name);
    const uniquePersons = (rows) =>
      rows.filter(
        (row, index) =>
          rows.findIndex(
            (other) =>
              other.BusinessPartnerPerson === row.BusinessPartnerPerson
          ) === index
      );

    let matches = emailKey
      ? uniquePersons(
          candidates.filter(
            (row) => normalize(row.EmailAddress) === emailKey
          )
        )
      : [];

    if (matches.length !== 1 && nameKey) {
      const pool = matches.length ? matches : uniquePersons(candidates);
      const byName = pool.filter((row) =>
        contactNamesMatch(nameKey, row.BusinessPartnerName)
      );
      if (byName.length) matches = byName;
    }

    if (matches.length === 1) return matches[0];

    console.warn(
      matches.length
        ? "[CX F2403 POC] Contacto Externo ambiguo por nombre/correo dentro de la empresa cliente; se deja manual."
        : "[CX F2403 POC] No se encontró el contacto por nombre/correo dentro de la empresa cliente; se deja manual.",
      {
        clientBp,
        hints,
        candidates: (matches.length ? matches : candidates).map((row) => ({
          BusinessPartnerPerson: row.BusinessPartnerPerson,
          BusinessPartnerName: row.BusinessPartnerName,
          EmailAddress: row.EmailAddress
        }))
      }
    );
    return null;
  }

  /*
   * A diferencia de C_LCMContactsOfCustomerVH (clave compuesta predecible),
   * este value help es una colección que hay que filtrar. Primero intentamos
   * BusinessPartnerPerson + BusinessPartnerCompany (relación exacta con el
   * cliente); si no hay match, hacemos fallback a filtrar solo por
   * BusinessPartnerPerson y tomamos el primer resultado, dejando un
   * console.warn visible para detectar el fallback en el ambiente real.
   */
  async function resolveExternalContact(model, bp, clientBp) {
    if (clientBp) {
      const combinedFilter =
        `BusinessPartnerPerson eq '${escapeODataString(bp)}' and BusinessPartnerCompany eq '${escapeODataString(clientBp)}'`;

      try {
        const combined = await queryExternalContactByFilter(
          model,
          combinedFilter
        );
        const combinedResults = Array.isArray(combined?.results)
          ? combined.results
          : [];
        if (combinedResults.length) return combinedResults[0];
      } catch (error) {
        console.warn(
          "[CX F2403 POC] Falló el filtro BusinessPartnerPerson + BusinessPartnerCompany en C_LglCntntMExtContactByBPVH; se intentará el fallback.",
          { bp, clientBp, error }
        );
      }
    }

    const fallbackFilter = `BusinessPartnerPerson eq '${escapeODataString(bp)}'`;
    const fallback = await queryExternalContactByFilter(
      model,
      fallbackFilter
    );
    const fallbackResults = Array.isArray(fallback?.results)
      ? fallback.results
      : [];

    if (fallbackResults.length) {
      console.warn(
        "[CX F2403 POC] Contacto Externo resuelto por fallback: filtrando solo por BusinessPartnerPerson (sin match de BusinessPartnerCompany, o cxClientBp no disponible). Verificar en el ambiente real.",
        { bp, clientBp: clientBp || null, filter: fallbackFilter }
      );
      return fallbackResults[0];
    }

    return null;
  }

  /*
   * El nombre de la propiedad "display name" en la fila de Contacto Externo
   * no está confirmado contra el metadata real (a diferencia de
   * LglCntntMEntityName en Entidades). Se descubre heurísticamente, igual
   * que findProductProperty: si no aparece, se deja solo el BP y se avisa
   * con console.warn en vez de asumir un nombre no verificado.
   */
  function findExternalContactNameProperty(model, rowPath) {
    const rowObject = model.getObject(rowPath) || {};
    const candidate = Object.keys(rowObject).find(
      (name) =>
        name.startsWith("LglCntntMExtCntct") &&
        normalize(name).includes("name")
    );

    if (!candidate) {
      console.warn(
        "[CX F2403 POC] No se encontró una propiedad de nombre reconocible (LglCntntMExtCntct*Name) en la fila de Contacto Externo; se deja solo el BP.",
        { rowPath, availableProperties: Object.keys(rowObject) }
      );
    }

    return candidate || "";
  }

  async function applyExternalContactPrefill(view, model) {
    const lookupHints = {
      name: cxPrimaryContactName,
      email: cxPrimaryContactEmail
    };
    const canLookupByCompany = Boolean(
      cxClientBp && (lookupHints.name || lookupHints.email)
    );
    let pendingContacts = [
      {
        type: "0001",
        label: "Contacto principal",
        bp: cxPrimaryContactBp
      },
      {
        type: "0002",
        label: "Firmante",
        bp: cxSignerBp
      },
      {
        type: "0003",
        label: "Contacto legal",
        bp: cxLegalContactBp
      }
    ].filter((contact) => contact.bp || canLookupByCompany);

    if (!pendingContacts.length) return;

    /*
     * Cada contacto se resuelve una sola vez (Promise cacheada); Firmante y
     * Contacto principal comparten la misma búsqueda por empresa. Si la
     * resolución falla, el contacto se descarta en vez de reintentar 40 veces.
     */
    const resolutions = new Map();
    const resolvedBps = {};
    const resolveOnce = (requested) => {
      const key = requested.bp
        ? `bp:${requested.bp}`
        : `company:${cxClientBp}`;
      if (!resolutions.has(key)) {
        const lookup = requested.bp
          ? resolveExternalContact(model, requested.bp, cxClientBp)
          : resolveExternalContactByCompany(model, cxClientBp, lookupHints);
        resolutions.set(
          key,
          lookup.catch((error) => {
            console.warn(
              "[CX F2403 POC] No fue posible consultar C_LglCntntMExtContactByBPVH.",
              { bp: requested.bp || null, clientBp: cxClientBp, error }
            );
            return null;
          })
        );
      }
      return resolutions.get(key);
    };

    /*
     * Los Contactos Externos son registros transitorios de Partes, igual que
     * Cliente/Organización de ventas (ver applyEntityPrefill). Aparecen en el
     * cache OData como C_LegalTransactionExtContact(...), confirmado contra
     * F2403 en vivo. Los códigos de tipo (0001 Contacto Principal,
     * 0002 Firmante) vienen del código previo a la regresión del 2/sep.
     */
    for (let attempt = 0; attempt < 40; attempt++) {
      const contactRows = Object.entries(model.oData || {}).filter(
        ([key, row]) =>
          key.startsWith("C_LegalTransactionExtContact(") &&
          row &&
          row.LglCntntMExtCntctType
      );
      const nextPending = [];

      for (const requested of pendingContacts) {
        const match = contactRows.find(([, row]) => {
          const type = clean(row.LglCntntMExtCntctType).padStart(4, "0");
          const typeName = normalize(row.LglCntntMExtCntctTypeName);
          if (requested.type === "0001") {
            return type === "0001" || typeName.includes("contacto principal");
          }
          if (requested.type === "0002") {
            return type === "0002" || typeName.includes("firmante");
          }
          return type === "0003" || typeName.includes("contacto legal");
        });

        if (!match) {
          nextPending.push(requested);
          continue;
        }

        const rowPath = `/${match[0].replace(/^\/+/, "")}`;
        const contactRecord = await resolveOnce(requested);
        const resolvedBp = clean(contactRecord?.BusinessPartnerPerson);

        if (!resolvedBp) {
          console.warn(
            `[CX F2403 POC] ${requested.label} no se pudo resolver en C_LglCntntMExtContactByBPVH; se deja manual.`,
            { bp: requested.bp || null, clientBp: cxClientBp || null }
          );
          continue;
        }

        let applied = model.setProperty(
          `${rowPath}/LglCntntMExtCntctBP`,
          resolvedBp
        );

        const nameProperty = findExternalContactNameProperty(
          model,
          rowPath
        );
        if (applied && nameProperty) {
          const displayName = clean(
            contactRecord.BusinessPartnerName ||
              contactRecord.BusinessPartnerFullName
          );
          if (displayName) {
            applied =
              model.setProperty(`${rowPath}/${nameProperty}`, displayName) &&
              applied;
          }
        }

        if (!applied) {
          nextPending.push(requested);
          continue;
        }

        resolvedBps[requested.type] = resolvedBp;
        validateEntityWhenControlIsReady(view, rowPath, {
          label: requested.label,
          property: "LglCntntMExtCntctBP",
          value: resolvedBp
        });
      }

      pendingContacts = nextPending;

      if (!pendingContacts.length) {
        if (Object.keys(resolvedBps).length) {
          console.info("[CX F2403 POC] Contactos externos precargados", {
            primaryContact: resolvedBps["0001"] || null,
            signer: resolvedBps["0002"] || null,
            legalContact: resolvedBps["0003"] || null
          });
        }
        return;
      }

      await sleep(250);
    }

    console.warn(
      "[CX F2403 POC] No se encontraron a tiempo las filas de Contactos Externos para completar el prefill.",
      {
        primaryContact: cxPrimaryContactBp || null,
        signer: cxSignerBp || null,
        legalContact: cxLegalContactBp || null
      }
    );
  }

  async function validateEntityWhenControlIsReady(
    view,
    rowPath,
    requested
  ) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const control = boundValueControls(
        view,
        requested.property
      ).find((candidate) =>
        candidate.getBindingContext?.()?.getPath() === rowPath
      );

      if (!control) {
        await sleep(250);
        continue;
      }

      try {
        if (typeof control.fireChangeModelValue === "function") {
          control.fireChangeModelValue();
        } else if (typeof control.fireChange === "function") {
          control.fireChange({
            value: requested.value,
            newValue: requested.value
          });
        } else if (typeof control.fireEvent === "function") {
          control.fireEvent("change", {
            value: requested.value,
            newValue: requested.value
          });
        }
      } catch (error) {
        console.warn(
          `[CX F2403 POC] ${requested.label} se escribió, pero no se pudo disparar su validación.`,
          error
        );
      }
      return;
    }

    console.warn(
      `[CX F2403 POC] ${requested.label} fue escrito en el modelo; su control aún no estaba disponible para disparar la validación.`,
      { rowPath, value: requested.value }
    );
  }

  // Ver odd/tasks/restore-f2403-auto-return.md (GPC-CreacionSolicitudContrato):
  // F2403 no expone un evento propio de "guardado"; detectamos la creación
  // real mirando las llamadas batch completadas hasta encontrar GET_ACTIVE_LT
  // con el LegalTransaction recién creado, y se lo avisamos al padre (BFF)
  // vía CustomEvent, que frame-unlock.js traduce en postMessage.
  function attachCreationObserver(model, ctx) {
    if (
      creationObserverAttached ||
      typeof model?.attachBatchRequestCompleted !== "function"
    ) {
      return;
    }

    creationObserverAttached = true;

    const onBatchCompleted = (event) => {
      if (creationNotified || event.getParameter?.("success") === false) {
        return;
      }

      const requests = event.getParameter?.("requests") || [];
      const legalTransactionId = extractCreatedLegalTransactionId(
        requests
      );

      if (!legalTransactionId) return;

      creationNotified = true;
      if (typeof model.detachBatchRequestCompleted === "function") {
        model.detachBatchRequestCompleted(onBatchCompleted);
      }

      const sourceDisplayId = cxSourceType === "CASE"
        ? cxCaseDisplayId
        : cxOpportunityId;
      const detail = {
        legalTransactionId,
        sourceType: cxSourceType,
        sourceDisplayId,
        title: clean(
          model.getProperty?.("LegalTransactionTitle", ctx)
        ) || undefined
      };

      console.info(
        "[CX F2403 POC] Transacción legal creada; notificando al monitor.",
        detail
      );
      window.dispatchEvent(
        new CustomEvent("gpc:legal-transaction-created", { detail })
      );
    };

    model.attachBatchRequestCompleted(onBatchCompleted);
  }

  function extractCreatedLegalTransactionId(requests = []) {
    for (const request of requests) {
      if (request?.success === false) continue;

      const statusCode = Number(
        request?.response?.statusCode || request?.response?.status || 0
      );
      if (statusCode >= 400) continue;

      const raw = [
        request?.url,
        request?.requestUri,
        request?.response?.requestUri,
        request?.response?.body
      ].filter(Boolean).join(" ");
      let decoded = raw;

      try {
        decoded = decodeURIComponent(raw);
      } catch (_error) {
        // Algunas versiones de UI5 entregan el URL parcialmente decodificado.
      }

      const match = decoded.match(
        /GET_ACTIVE_LT[^\s]*[?&]LegalTransaction\s*=\s*'?([0-9]+)'?/i
      );
      if (match) return match[1];
    }

    return "";
  }

  async function applyPrefill() {
    if (prefillApplied) {
      return;
    }

    try {
      setStatus("Inicializando solicitud de contrato...");

      if (!cxTitle) {
        throw new Error(
          "CX no envió el título del objeto origen (cxTitle)."
        );
      }

      if (!isCaseContextSource && !cxDivision) {
        throw new Error(
          "CX no envió la división del objeto origen (cxDivision)."
        );
      }

      if (!cxContext) {
        throw new Error(
          cxSourceType === "CASE"
            ? "El tipo de caso CX no tiene un contexto S/4 válido."
            : cxDivision === "10"
            ? "CX no envió uno de los contextos inmobiliarios válidos (20150-20153)."
            : "La división CX " + cxDivision +
              " no tiene un contexto S/4 válido para los parámetros recibidos."
        );
      }

      if (cxSourceType === "CASE" && !cxCaseDisplayId) {
        throw new Error(
          "CX no envió el número visible del caso (cxCaseDisplayId)."
        );
      }

      if (cxSourceType === "OPPORTUNITY" && !cxOpportunityId) {
        console.warn(
          "[CX F2403 POC] CX no envió cxOpportunityId."
        );
      }
      if (
        cxSourceType === "SERVICE_ORDER" &&
        !cxServiceOrderUuid &&
        !cxServiceOrderExternalId &&
        !cxServiceOrderDisplayId
      ) {
        console.warn(
          "[CX F2403 POC] CX no envió un identificador de Service Order."
        );
      }

      const {
        win,
        view,
        controller,
        model,
        ctx
      } = await waitForF2403();

      attachCreationObserver(model, ctx);
      scheduleTemplateCreationRemoval(win, view);

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
      /*
       * La vista no debe quedar oculta esperando a que el paso Partes se
       * materialice. El retry continúa en segundo plano mientras el usuario
       * revisa los primeros pasos.
       */
      scheduleEntityPrefill(view, model);
      applyExternalContactPrefill(view, model).catch((error) => {
        console.warn(
          "[CX F2403 POC] Falló el prefill asíncrono de Contactos Externos.",
          error
        );
      });
      win.sap.ui.getCore().applyChanges();

      if (params.get("cxTitleFormat") === "v1") {
        const sourceDisplayId = cxSourceType === "CASE"
          ? cxCaseDisplayId
          : cxOpportunityId;
        const title = buildContractTitle(params.get("cxCompanyInitials"), params.get("cxClientName"),
          model.getProperty("LglCntntMContextTitle", ctx), sourceDisplayId);
        model.setProperty("LegalTransactionTitle", title, ctx);
        // El título identifica la oportunidad: se mantiene íntegro durante la edición.
        for (const control of boundValueControls(view, "LegalTransactionTitle")) {
          if (typeof control.setEditable === "function") control.setEditable(false);
        }
        if (typeof model.attachPropertyChange === "function") model.attachPropertyChange(() => {
          if (model.getProperty("LegalTransactionTitle", ctx) !== title) {
            model.setProperty("LegalTransactionTitle", title, ctx);
          }
        });
        win.sap.ui.getCore().applyChanges();
      }

      const result = model.getObject(ctx.getPath());

      console.log(
        "[CX F2403 POC] Prefill aplicado",
        {
          cxTitle,
          cxSourceType,
          cxOpportunityId,
          cxServiceOrderUuid: cxServiceOrderUuid || null,
          cxServiceOrderDisplayId: cxServiceOrderDisplayId || null,
          cxServiceOrderExternalId: cxServiceOrderExternalId || null,
          cxCaseUuid: cxCaseUuid || null,
          cxCaseDisplayId: cxCaseDisplayId || null,
          cxCaseType: cxCaseType || null,
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
          parties: {
            client: cxClientBp || "manual",
            salesOrganization:
              cxSalesOrganization || "manual",
            primaryContact: cxPrimaryContactBp || "manual",
            signer: cxSignerBp || "manual",
            legalContact: cxLegalContactBp || "manual"
          },
          cxTechnicalLocation: cxTechnicalLocation || null,
          cxStartDate: cxStartDate || null,
          cxEndDate: cxEndDate || null,
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

      iframe.style.visibility = "visible";
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

function buildContractTitle(initials, client, context, id) {
  const cleanPart = value => String(value || '').trim().replace(/\s+/g, ' ');
  const parts = [initials, client, context].map(cleanPart);
  if (parts.some(part => !part) || !/^\d+$/.test(String(id))) {
    throw new Error('Faltan siglas de sociedad, cliente, contexto o ID de referencia CX para el título.');
  }
  const suffix = `. CX${id}`;
  const title = `${parts[0]}. ${parts[1]}. CONTRATO ${parts[2]}${suffix}`;
  if (title.length > 128) throw new Error('El título supera 128 caracteres. Debe acordarse una abreviatura de sociedad, cliente o contexto; el ID de referencia CX no se recorta.');
  return title;
}
