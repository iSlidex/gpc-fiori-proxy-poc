(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  const cxTitle = clean(params.get("cxTitle"));
  const cxSourceType = clean(params.get("cxSourceType")).toUpperCase() ||
    "OPPORTUNITY";
  const cxOpportunityId = clean(params.get("cxOpportunityId"));
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
  const cxClientBp = clean(params.get("cxClientBp"));
  const cxClientName = clean(params.get("cxClientName"));
  const cxSalesOrganization = clean(
    params.get("cxSalesOrganization")
  );
  const cxSalesOrganizationName = clean(
    params.get("cxSalesOrganizationName")
  );
  const cxPrimaryContactBp = clean(params.get("cxPrimaryContactBp"));
  const cxSignerBp = clean(params.get("cxSignerBp"));
  const cxLegalContactBp = clean(params.get("cxLegalContactBp"));
  const cxTechnicalLocation = clean(params.get("cxTechnicalLocation"));
  const cxPep = parseOptionalBoolean(params.get("cxPep"));

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
  let approvalModelListenerAttached = false;
  let creationObserverAttached = false;
  let creationNotified = false;
  let templateActionObserver = null;
  const populatedExternalContactPaths = new Set();
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
    if (cxSourceType === "CASE") {
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

    if (cxSourceType === "CASE" && cxTechnicalLocation) {
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
    }

    if (cxSourceType !== "CASE" && cxProduct) {
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

  async function applyEntityPrefill(view, model) {
    let pendingEntities = [
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

    if (!pendingEntities.length) return;

    /*
     * Las entidades de Partes son registros transitorios separados de la
     * cabecera. Después de GET_STEP_SEQUENCE aparecen directamente en el
     * cache OData como C_LegalTransactionEntity(...), incluso antes de que
     * UI5 materialice los controles del paso Partes.
     */
    for (let attempt = 0; attempt < 40; attempt++) {
      const entityRows = Object.entries(model.oData || {}).filter(
        ([key, row]) =>
          key.startsWith("C_LegalTransactionEntity(") &&
          row &&
          row.LglCntntMEntityType
      );
      const nextPending = [];

      for (const requested of pendingEntities) {
        const match = entityRows.find(([, row]) =>
          clean(row.LglCntntMEntityType).padStart(4, "0") ===
            requested.type
        );

        if (!match) {
          nextPending.push(requested);
          continue;
        }

        const rowPath = `/${match[0].replace(/^\/+/, "")}`;
        let valueHelp = {};

        try {
          valueHelp = await readODataEntity(
            model,
            requested.valueHelpPath
          );
        } catch (error) {
          if (!requested.fallbackName) {
            console.warn(
              `[CX F2403 POC] No fue posible resolver ${requested.label} en su value help.`,
              { path: requested.valueHelpPath, error }
            );
            nextPending.push(requested);
            continue;
          }
        }

        const entityName = clean(
          valueHelp?.[requested.nameProperty]
        ) || requested.fallbackName;
        const applied =
          model.setProperty(
            `${rowPath}/${requested.property}`,
            requested.value
          ) &&
          model.setProperty(
            `${rowPath}/LglCntntMEntityName`,
            entityName
          );

        if (!applied) {
          nextPending.push(requested);
          continue;
        }

        validateEntityWhenControlIsReady(
          view,
          rowPath,
          requested
        );
      }

      pendingEntities = nextPending;

      if (!pendingEntities.length) {
        console.info("[CX F2403 POC] Entidades precargadas", {
          client: cxClientBp || null,
          salesOrganization: cxSalesOrganization || null
        });
        return;
      }

      await sleep(250);
    }

    console.warn(
      "[CX F2403 POC] No se encontraron a tiempo las filas de Partes para completar el prefill.",
      {
        client: cxClientBp || null,
        salesOrganization: cxSalesOrganization || null
      }
    );
  }

  function scheduleExternalContactPrefill(view, model) {
    if (
      !cxPrimaryContactBp &&
      !cxSignerBp &&
      !cxLegalContactBp
    ) {
      return;
    }

    const smartTable = view.byId("extContactsSmartTable");
    const apply = () => applyExternalContactPrefill(
      view,
      model,
      smartTable
    );

    if (
      smartTable &&
      typeof smartTable.attachDataReceived === "function"
    ) {
      smartTable.attachDataReceived(apply);
    }

    /*
     * Las filas de contactos externos se materializan al entrar al paso
     * Partes. dataReceived cubre ese momento; los reintentos cubren los
     * casos en que F2403 ya cargó las filas antes de enlazar el listener.
     */
    [0, 250, 750, 1500, 3000, 5000, 8000, 12000, 20000].forEach(
      (delay) => window.setTimeout(apply, delay)
    );
  }

  function applyExternalContactPrefill(view, model, smartTable) {
    const requestedByType = {
      "0001": {
        label: "Contacto principal",
        value: cxPrimaryContactBp
      },
      "0002": {
        label: "Firmante",
        value: cxSignerBp
      },
      "0003": {
        label: "Contacto legal",
        value: cxLegalContactBp
      }
    };

    const rowsByPath = new Map(
      getSmartTableRows(smartTable).map((row) => [
        row.getBindingContext?.()?.getPath(),
        row
      ])
    );

    for (const [key, contact] of Object.entries(model.oData || {})) {
      if (
        !key.startsWith("C_LegalTransactionExtContact(") ||
        !contact
      ) {
        continue;
      }

      const type = clean(contact.LglCntntMExtCntctType).padStart(4, "0");
      const requested = requestedByType[type];
      if (!requested?.value) continue;

      const path = `/${key.replace(/^\/+/, "")}`;
      if (
        populatedExternalContactPaths.has(path) &&
        clean(model.getProperty(`${path}/LglCntntMExtCntctBP`)) ===
          requested.value
      ) {
        continue;
      }

      const applied = model.setProperty(
        `${path}/LglCntntMExtCntctBP`,
        requested.value
      );
      if (!applied) continue;

      const row = rowsByPath.get(path);
      if (row) {
        fireBoundValueChange(
          row,
          "LglCntntMExtCntctBP",
          requested.value
        );
      }

      populatedExternalContactPaths.add(path);
      console.info(
        "[CX F2403 POC] Contacto externo precargado",
        {
          path,
          role: requested.label,
          type,
          value: requested.value
        }
      );
    }

  }

  function getSmartTableRows(smartTable) {
    if (!smartTable || typeof smartTable.getTable !== "function") {
      return [];
    }

    const table = smartTable.getTable();
    if (typeof table?.getItems === "function") return table.getItems();
    if (typeof table?.getRows === "function") return table.getRows();
    return [];
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
          "CX no envió el título de la Opportunity (cxTitle)."
        );
      }

      if (cxSourceType !== "CASE" && !cxDivision) {
        throw new Error(
          "CX no envió la división de la Opportunity (cxDivision)."
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

      if (cxSourceType !== "CASE" && !cxOpportunityId) {
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
      applyEntityPrefill(view, model).catch((error) => {
        console.warn(
          "[CX F2403 POC] Falló el prefill asíncrono de Partes.",
          error
        );
      });
      scheduleExternalContactPrefill(view, model);
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
