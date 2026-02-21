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

    const normalizedLines = Array.isArray(input.lines)
      ? input.lines.map((line) => [
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
        ])
      : undefined;

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
