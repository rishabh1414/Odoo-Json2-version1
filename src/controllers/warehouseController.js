import { authOdoo, callOdoo, DB, PASSWORD } from "../services/odooClient.js";

const DEFAULT_WAREHOUSE_FIELDS = [
  "name",
  "code",
  "active",
  "company_id",
  "partner_id",
  "view_location_id",
  "lot_stock_id",
  "reception_steps",
  "delivery_steps",
  "pick_type_id",
  "pack_type_id",
  "out_type_id",
  "in_type_id",
];

async function fetchWarehouseFieldMap(uid) {
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
        "stock.warehouse",
        "fields_get",
        [],
        { attributes: ["string", "type", "required"] },
      ],
    },
    id: Date.now(),
  });

  return fields;
}

async function fetchWarehouseFields(uid) {
  const fieldMap = await fetchWarehouseFieldMap(uid);
  if (fieldMap.error) {
    throw new Error(fieldMap.error?.data?.message || fieldMap.error?.message);
  }

  const available = Object.keys(fieldMap.result || {});
  const fields = DEFAULT_WAREHOUSE_FIELDS.filter((field) =>
    available.includes(field),
  );
  if (!fields.includes("id")) fields.unshift("id");
  return fields;
}

export async function getWarehouseFields(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const fields = await fetchWarehouseFieldMap(uid);
    if (fields.error) return res.status(400).json({ error: fields.error });

    res.json(fields.result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function listWarehouses(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const fields = await fetchWarehouseFields(uid);
    const domain = [];

    const companyId = req.query.company_id;
    if (companyId !== undefined) {
      const parsedCompanyId = Number.parseInt(companyId, 10);
      if (!Number.isFinite(parsedCompanyId)) {
        return res.status(400).json({ error: "Invalid company_id" });
      }
      domain.push(["company_id", "=", parsedCompanyId]);
    }

    if (req.query.active !== undefined) {
      const raw = String(req.query.active).trim().toLowerCase();
      if (raw !== "true" && raw !== "false") {
        return res
          .status(400)
          .json({ error: "Invalid active. Use active=true or active=false" });
      }
      domain.push(["active", "=", raw === "true"]);
    }

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
          "stock.warehouse",
          "search_read",
          [domain],
          { fields, limit: 500 },
        ],
      },
      id: Date.now(),
    });

    if (response.error) return res.status(400).json({ error: response.error });

    res.json({
      success: true,
      count: response.result.length,
      warehouses: response.result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getWarehouseById(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const rawId = String(req.params.id || "").trim();
    if (!rawId) {
      return res.status(400).json({ error: "Missing warehouse identifier" });
    }

    const fields = await fetchWarehouseFields(uid);
    const isNumericId = /^\d+$/.test(rawId);
    const domain = isNumericId
      ? [["id", "=", Number(rawId)]]
      : ["|", ["code", "=", rawId], ["name", "=", rawId]];

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
          "stock.warehouse",
          "search_read",
          [domain],
          { fields, limit: 1 },
        ],
      },
      id: Date.now(),
    });

    if (response.error) return res.status(400).json({ error: response.error });

    const warehouse = response.result?.[0];
    if (!warehouse) {
      return res.status(404).json({ error: "Warehouse not found" });
    }

    res.json({ success: true, warehouse });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
