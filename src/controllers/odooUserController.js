import { authOdoo, callOdoo, DB, getOdooIdentity, PASSWORD } from "../services/odooClient.js";

const SALES_GROUP_XML_IDS = [
  { module: "sales_team", name: "group_sale_salesman" },
  { module: "sales_team", name: "group_sale_salesman_all_leads" },
  { module: "sales_team", name: "group_sale_manager" },
  { module: "sale", name: "group_sale_salesman" },
  { module: "sale", name: "group_sale_manager" },
];

function parseBooleanQuery(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

async function getModelFieldNames(uid, model) {
  const fields = await callOdoo({
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [DB, uid, PASSWORD, model, "fields_get", []],
    },
    id: Date.now(),
  });

  if (fields.error || !fields.result) return new Set();
  return new Set(Object.keys(fields.result));
}

async function resolveSalesGroupIds(uid) {
  const modules = [...new Set(SALES_GROUP_XML_IDS.map((item) => item.module))];
  const names = [...new Set(SALES_GROUP_XML_IDS.map((item) => item.name))];

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
        "ir.model.data",
        "search_read",
        [[["module", "in", modules], ["name", "in", names]]],
        { fields: ["module", "name", "res_id"], limit: 50 },
      ],
    },
    id: Date.now(),
  });

  if (lookup.error) return [];

  return [
    ...new Set(
      (lookup.result || [])
        .map((item) => parsePositiveInt(item.res_id))
        .filter((id) => id !== null),
    ),
  ];
}

export async function listSalespersons(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) {
      return res.status(401).json({
        error:
          "Unable to resolve Odoo user. Provide x-odoo-user-email with a configured API key for that email.",
      });
    }

    const salesOnly = parseBooleanQuery(req.query.sales_only, true);
    const activeOnly = parseBooleanQuery(req.query.active_only, true);
    const limit = parsePositiveInt(req.query.limit) || 500;

    const availableFields = await getModelFieldNames(uid, "res.users");
    const fields = ["id", "name", "login"];
    for (const optionalField of ["email", "active", "share", "sale_team_id"]) {
      if (availableFields.has(optionalField)) fields.push(optionalField);
    }

    const domain = [];
    if (availableFields.has("share")) domain.push(["share", "=", false]);
    if (activeOnly && availableFields.has("active")) {
      domain.push(["active", "=", true]);
    }

    if (salesOnly) {
      const salesGroupIds = await resolveSalesGroupIds(uid);
      if (salesGroupIds.length && availableFields.has("groups_id")) {
        domain.push(["groups_id", "in", salesGroupIds]);
      } else if (availableFields.has("sale_team_id")) {
        domain.push(["sale_team_id", "!=", false]);
      }
    }

    const users = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "res.users",
          "search_read",
          [domain],
          { fields, limit, order: "name asc" },
        ],
      },
      id: Date.now(),
    });

    if (users.error) {
      return res.status(400).json({ error: users.error });
    }

    const salespersons = (users.result || []).map((user) => ({
      id: user.id,
      name: user.name,
      login: user.login || null,
      email: user.email || null,
      active: user.active ?? true,
      sale_team_id: Array.isArray(user.sale_team_id) ? user.sale_team_id[0] : null,
      sale_team_name: Array.isArray(user.sale_team_id) ? user.sale_team_id[1] : null,
    }));

    res.json({
      success: true,
      count: salespersons.length,
      salespersons,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function resolveOdooUser(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) {
      return res.status(401).json({
        error:
          "Unable to resolve Odoo user. Provide x-odoo-user-email with a configured API key for that email.",
      });
    }

    const identity = getOdooIdentity();
    res.json({
      success: true,
      uid,
      acting_email: identity.acting_email,
      effective_email: identity.effective_email,
      api_key_source: identity.api_key_source,
      user: identity.user,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
