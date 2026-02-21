import { authOdoo, callOdoo, DB, PASSWORD } from "../services/odooClient.js";

function parseCategoryId(idParam) {
  const parsed = Number(idParam);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function listCategories(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid)
      return res.status(401).json({ error: "Odoo authentication failed" });

    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 2000;

    const domain = [];
    if (query) {
      domain.push(["name", "ilike", query]);
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
          "product.category",
          "search_read",
          [domain],
          { fields: ["id", "name", "parent_id", "complete_name"], limit },
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
      categories: response.result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getCategoryById(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid)
      return res.status(401).json({ error: "Odoo authentication failed" });

    const categoryId = parseCategoryId(req.params.id);
    if (!categoryId) {
      return res.status(400).json({ error: "Invalid category id" });
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
          "product.category",
          "search_read",
          [[["id", "=", categoryId]]],
          { fields: ["id", "name", "parent_id", "complete_name"], limit: 1 },
        ],
      },
      id: Date.now(),
    });

    if (response.error) {
      return res.status(400).json({ error: response.error });
    }

    const category = response.result?.[0];
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json({ success: true, category });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createCategory(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid)
      return res.status(401).json({ error: "Odoo authentication failed" });

    const rawName =
      req.body?.name ??
      req.body?.category ??
      req.body?.category_name ??
      req.body?.label;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }

    const parentId =
      req.body?.parent_id !== undefined ? Number(req.body.parent_id) : null;
    const data = { name };
    if (Number.isInteger(parentId) && parentId > 0) {
      data.parent_id = parentId;
    }

    const created = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "product.category", "create", [data]],
      },
      id: Date.now(),
    });

    if (created.error) {
      return res.status(400).json({ error: created.error });
    }

    res.json({ success: true, category_id: created.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
