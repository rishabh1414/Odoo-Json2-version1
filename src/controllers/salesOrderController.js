import {
  authOdoo,
  callOdoo,
  DB,
  PASSWORD,
  fetchOdooReportPdf,
  resolveReportNameByModel,
} from "../services/odooClient.js";

const SALES_ORDER_FIELDS = [
  "name",
  "state",
  "partner_id",
  "partner_invoice_id",
  "partner_shipping_id",
  "date_order",
  "validity_date",
  "commitment_date",
  "user_id",
  "amount_total",
  "amount_tax",
  "amount_untaxed",
  "currency_id",
  "order_line",
];

const SALES_ORDER_REPORT_CANDIDATES = [
  "sale.report_saleorder",
  "sale.report_saleorder_raw",
  "sale.report_saleorder_pro_forma",
];

function buildDownloadFilename(value, fallback) {
  const safe = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || fallback;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractLineProductRefs(line) {
  return {
    productVariantId: parsePositiveInt(
      line?.product_variant_id ?? line?.product_product_id
    ),
    productId: parsePositiveInt(line?.product_id),
    productTemplateId: parsePositiveInt(
      line?.product_template_id ?? line?.product_tmpl_id
    ),
  };
}

async function resolveSalesOrderLineProductIds(uid, lines) {
  const refs = lines.map((line) => extractLineProductRefs(line));

  const variantProbeIds = [
    ...new Set(
      refs
        .flatMap((ref) => [ref.productVariantId, ref.productId])
        .filter((id) => id !== null)
    ),
  ];

  let variantIds = new Set();
  if (variantProbeIds.length) {
    const variantLookup = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "product.product",
          "search_read",
          [[["id", "in", variantProbeIds]]],
          { fields: ["id"], limit: variantProbeIds.length },
        ],
      },
      id: Date.now(),
    });

    if (variantLookup.error) {
      return { error: variantLookup.error };
    }

    variantIds = new Set(
      (variantLookup.result ?? [])
        .map((variant) => parsePositiveInt(variant.id))
        .filter((id) => id !== null)
    );
  }

  const templateProbeIds = [
    ...new Set(
      refs
        .flatMap((ref) => [
          ref.productTemplateId,
          ref.productId && !variantIds.has(ref.productId) ? ref.productId : null,
        ])
        .filter((id) => id !== null)
    ),
  ];

  let templateToVariant = new Map();
  if (templateProbeIds.length) {
    const templateVariantLookup = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "product.product",
          "search_read",
          [[["product_tmpl_id", "in", templateProbeIds]]],
          {
            fields: ["id", "product_tmpl_id"],
            limit: Math.max(100, templateProbeIds.length * 10),
          },
        ],
      },
      id: Date.now(),
    });

    if (templateVariantLookup.error) {
      return { error: templateVariantLookup.error };
    }

    templateToVariant = new Map();
    for (const variant of templateVariantLookup.result ?? []) {
      const templateId = parsePositiveInt(variant?.product_tmpl_id?.[0]);
      const variantId = parsePositiveInt(variant?.id);
      if (!templateId || !variantId || templateToVariant.has(templateId)) continue;
      templateToVariant.set(templateId, variantId);
    }
  }

  const normalizedLines = [];
  const unresolved = [];
  for (const [index, line] of lines.entries()) {
    const ref = refs[index];
    let resolvedProductId = null;
    let unresolvedField = "";
    let unresolvedValue = null;

    if (ref.productVariantId) {
      if (variantIds.has(ref.productVariantId)) {
        resolvedProductId = ref.productVariantId;
      } else {
        unresolvedField = "product_variant_id";
        unresolvedValue = ref.productVariantId;
      }
    } else if (ref.productId) {
      if (variantIds.has(ref.productId)) {
        resolvedProductId = ref.productId;
      } else if (templateToVariant.has(ref.productId)) {
        resolvedProductId = templateToVariant.get(ref.productId);
      } else {
        unresolvedField = "product_id";
        unresolvedValue = ref.productId;
      }
    } else if (ref.productTemplateId) {
      if (templateToVariant.has(ref.productTemplateId)) {
        resolvedProductId = templateToVariant.get(ref.productTemplateId);
      } else {
        unresolvedField = "product_template_id";
        unresolvedValue = ref.productTemplateId;
      }
    } else {
      unresolvedField = "product_id";
      unresolvedValue = null;
    }

    if (!resolvedProductId) {
      unresolved.push({
        line: index + 1,
        field: unresolvedField,
        value: unresolvedValue,
      });
      continue;
    }

    normalizedLines.push({
      ...line,
      product_id: resolvedProductId,
    });
  }

  return {
    lines: normalizedLines,
    unresolved,
  };
}

export async function getSalesOrderFields(req, res) {
  const uid = await authOdoo();
  if (!uid) return res.status(401).json({ error: "Auth failed" });

  const fields = await callOdoo({
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [
        DB,
        uid,
        PASSWORD,
        "sale.order",
        "fields_get",
        [],
        { attributes: ["string", "type", "required"] },
      ],
    },
    id: 300,
  });

  res.json(fields.result);
}

export async function listSalesOrders(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const state = req.query.state;
    const domain = state ? [["state", "=", state]] : [];

    const response = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "sale.order",
          "search_read",
          [domain],
          { fields: SALES_ORDER_FIELDS, limit: 500 },
        ],
      },
      id: Date.now(),
    });

    if (response.error) {
      return res.status(400).json({ error: response.error });
    }

    res.json({
      success: true,
      count: response.result.length,
      sales_orders: response.result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSalesOrderById(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const rawId = String(req.params.id || "").trim();
    if (!rawId) {
      return res.status(400).json({ error: "Missing sales order identifier" });
    }

    const isNumericId = /^\d+$/.test(rawId);
    const domain = isNumericId ? [["id", "=", Number(rawId)]] : [["name", "=", rawId]];

    const response = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "sale.order",
          "search_read",
          [domain],
          { fields: SALES_ORDER_FIELDS, limit: 1 },
        ],
      },
      id: Date.now(),
    });

    if (response.error) {
      return res.status(400).json({ error: response.error });
    }

    const salesOrder = response.result?.[0];
    if (!salesOrder) {
      return res.status(404).json({ error: "Sales order not found" });
    }

    res.json({ success: true, sales_order: salesOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateSalesOrderState(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const rawId = String(req.params.id || "").trim();
    if (!rawId) {
      return res.status(400).json({ error: "Missing sales order identifier" });
    }

    const rawTargetState = String(req.body?.state || "").trim();
    if (!rawTargetState) {
      return res
        .status(400)
        .json({ error: "Missing state. Pass body: {\"state\":\"...\"}" });
    }

    const targetState = rawTargetState.toLowerCase();

    const isNumericId = /^\d+$/.test(rawId);
    const domain = isNumericId
      ? [["id", "=", Number(rawId)]]
      : [["name", "=", rawId]];

    const stateMeta = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "sale.order",
          "fields_get",
          [["state"]],
          { attributes: ["selection"] },
        ],
      },
      id: Date.now(),
    });

    if (stateMeta.error) {
      return res.status(400).json({ error: stateMeta.error });
    }

    const allowedStates = (stateMeta.result?.state?.selection || [])
      .map((item) => item?.[0])
      .filter(Boolean);

    if (!allowedStates.includes(targetState)) {
      return res.status(400).json({
        error: `Invalid state '${rawTargetState}'`,
        allowed_states: allowedStates,
      });
    }

    const lookup = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "sale.order",
          "search_read",
          [domain],
          { fields: ["id", "name", "state"], limit: 1 },
        ],
      },
      id: Date.now(),
    });

    if (lookup.error) {
      return res.status(400).json({ error: lookup.error });
    }

    const salesOrder = lookup.result?.[0];
    if (!salesOrder) {
      return res.status(404).json({ error: "Sales order not found" });
    }

    if (salesOrder.state === targetState) {
      return res.json({
        success: true,
        updated: false,
        sales_order_id: salesOrder.id,
        previous_state: salesOrder.state,
        new_state: targetState,
        transition_method: "none",
      });
    }

    const previousState = salesOrder.state;
    const transition = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "sale.order",
          "write",
          [[salesOrder.id], { state: targetState }],
        ],
      },
      id: Date.now(),
    });

    if (transition.error) {
      return res.status(400).json({ error: transition.error });
    }

    const refreshed = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "sale.order",
          "search_read",
          [[["id", "=", salesOrder.id]]],
          { fields: SALES_ORDER_FIELDS, limit: 1 },
        ],
      },
      id: Date.now(),
    });

    if (refreshed.error) {
      return res.status(400).json({ error: refreshed.error });
    }

    const updatedOrder = refreshed.result?.[0];

    res.json({
      success: true,
      updated: true,
      sales_order_id: salesOrder.id,
      previous_state: previousState,
      new_state: updatedOrder?.state || targetState,
      transition_method: "write",
      sales_order: updatedOrder,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function downloadSalesOrderPdf(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const rawId = String(req.params.id || "").trim();
    if (!rawId) {
      return res.status(400).json({ error: "Missing sales order identifier" });
    }

    const isNumericId = /^\d+$/.test(rawId);
    const domain = isNumericId ? [["id", "=", Number(rawId)]] : [["name", "=", rawId]];

    const lookup = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "sale.order",
          "search_read",
          [domain],
          { fields: ["id", "name", "company_id"], limit: 1 },
        ],
      },
      id: Date.now(),
    });

    if (lookup.error) {
      return res.status(400).json({ error: lookup.error });
    }

    const salesOrder = lookup.result?.[0];
    if (!salesOrder) {
      return res.status(404).json({ error: "Sales order not found" });
    }

    const primaryReportName = await resolveReportNameByModel({
      uid,
      model: "sale.order",
      preferred: SALES_ORDER_REPORT_CANDIDATES,
    });
    if (!primaryReportName) {
      return res.status(500).json({
        error: "Unable to resolve a quotation report for sale.order",
      });
    }

    const companyId = salesOrder.company_id?.[0];
    const reportContext = Number.isInteger(companyId)
      ? { allowed_company_ids: [companyId] }
      : undefined;

    const orderedCandidates = [
      primaryReportName,
      ...SALES_ORDER_REPORT_CANDIDATES.filter(
        (name) => name !== primaryReportName
      ),
    ];

    let pdf = null;
    const errors = [];
    for (const reportName of orderedCandidates) {
      try {
        pdf = await fetchOdooReportPdf({
          reportName,
          documentIds: [salesOrder.id],
          reportContext,
        });
        break;
      } catch (err) {
        errors.push(`${reportName}: ${err.message}`);
      }
    }

    if (!pdf) {
      return res.status(502).json({
        error:
          "Unable to generate quotation PDF from Odoo. Tried available sale.order reports.",
        details: errors,
      });
    }

    const filename = `${buildDownloadFilename(
      salesOrder.name,
      `sales-order-${salesOrder.id}`
    )}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createSalesOrder(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const input = req.body;

    let normalizedLines;
    if (Array.isArray(input.lines)) {
      const resolved = await resolveSalesOrderLineProductIds(uid, input.lines);
      if (resolved.error) {
        return res.status(400).json({ error: resolved.error });
      }

      if (resolved.unresolved.length) {
        return res.status(400).json({
          error:
            "Invalid line product references. Pass a valid product variant id in product_id, or a valid product template id in product_template_id.",
          details: resolved.unresolved,
        });
      }

      normalizedLines = resolved.lines.map((line) => [
        0,
        0,
        {
          product_id: line.product_id,
          product_uom_qty: line.quantity ?? 1,
          price_unit: line.price_unit ?? 0,
          name: line.description || line.name || "Line",
          tax_id: line.tax_id,
          discount: line.discount,
        },
      ]);
    }

    const data = {
      partner_id: input.partner_id,
      partner_invoice_id: input.partner_invoice_id,
      partner_shipping_id: input.partner_shipping_id,
      date_order: input.date_order,
      validity_date: input.validity_date,
      commitment_date: input.commitment_date,
      user_id: input.user_id,
      currency_id: input.currency_id,
      client_order_ref: input.client_order_ref,
      origin: input.origin,
      note: input.note,
      order_line: input.order_line || normalizedLines,
    };

    for (const key of Object.keys(data)) {
      if (data[key] === undefined || data[key] === null) delete data[key];
    }

    const created = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "sale.order", "create", [data]],
      },
      id: Date.now(),
    });

    if (created.error) {
      return res.status(400).json({ error: created.error });
    }

    res.json({ success: true, sales_order_id: created.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
