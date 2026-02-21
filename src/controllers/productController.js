import { ODOO_URL } from "../config/odoo.js";
import { authOdoo, callOdoo, DB, PASSWORD } from "../services/odooClient.js";

// Map of website-facing field names to Odoo model field names
const WEBSITE_TO_ODOO_FIELD = {
  sku: "x_studio_sku",
  name: "name",
  product_name: "name",
  description: "description_purchase",
  ecommerce_description: "description_ecommerce",
  rating: "x_studio_product_rating",
  price: "list_price",
  sales_price: "list_price",
  stock_quantity: "x_studio_stock_quantity",
  image_1920: "image_1920",
  image_1024: "image_1024",
  image_512: "image_512",
  image_256: "image_256",
  image_128: "image_128",
  is_custom: "x_studio_is_custom",
  special_order: "x_studio_is_custom",
  category: "x_studio_selection_field_75k_1jcm2f0o4",
  fiber_count: "x_studio_fiber_count",
  cable_type: "x_studio_cable_type",
  jacket_color: "x_studio_jacket_color",
  length_available: "x_studio_length_available",
  product_type: "type",
  track_inventory: "type",
  invoicing_policy: "invoice_policy",
  map_price: "x_studio_map_minimum_advertised_price",
  minimum_order_quantity_moq: "x_studio_moq_minimum_order_quantity",
  ship_ups_or_freight: "x_studio_ship_ups_or_freight",
  country_of_origin: "x_studio_country_of_origin",
  warranty: "x_studio_warranty",
  length_inches: "x_studio_length_inches",
  width_inches: "x_studio_width_inches",
  height_inches: "x_studio_height_inches",
  quantity_on_hand: "qty_available",
  distributor_cost: "x_studio_distributor_cost",
  upc_code: "x_studio_upc_code",
  barcode: "barcode",
  datasheet_url: "x_studio_data_sheet_pdf",
  // Direct Odoo field names accepted by some client
  type: "type",
  invoice_policy: "invoice_policy",
  list_price: "list_price",
  description_ecommerce: "description_ecommerce",
  is_storable: "is_storable",
  qty_available: "qty_available",
  categ_id: "categ_id",
  category_id: "categ_id",
  x_studio_map_price: "x_studio_map_minimum_advertised_price",
  x_studio_minimum_order_quantity_moq: "x_studio_moq_minimum_order_quantity",
  x_studio_ship_ups_or_freight: "x_studio_ship_ups_or_freight",
  x_studio_special_order: "x_studio_is_custom",
  x_studio_country_of_origin: "x_studio_country_of_origin",
  x_studio_warranty: "x_studio_warranty",
  x_studio_length_inches: "x_studio_length_inches",
  x_studio_width_inches: "x_studio_width_inches",
  x_studio_height_inches: "x_studio_height_inches",
  x_studio_distributor_cost: "x_studio_distributor_cost",
  x_studio_upc_code: "x_studio_upc_code",
  x_studio_datasheet_url: "x_studio_data_sheet_pdf",
};
const IMAGE_FIELDS = new Set([
  "image_1920",
  "image_1024",
  "image_512",
  "image_256",
  "image_128",
]);

function getOdooBaseUrl() {
  return ODOO_URL.replace(/\/jsonrpc\/?$/i, "").replace(/\/json\/2(?:\/.*)?$/i, "");
}

function parseCompanyIds(query) {
  const raw = query.company_ids ?? query.company_id;
  if (raw === undefined) return { companyIds: [] };

  const rawValues = Array.isArray(raw) ? raw : String(raw).split(",");
  const companyIds = [];

  for (const value of rawValues) {
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        error: "Invalid company_id(s). Use comma-separated positive integers.",
      };
    }
    companyIds.push(parsed);
  }

  if (companyIds.length === 0) {
    return {
      error: "Invalid company_id(s). Use comma-separated positive integers.",
    };
  }

  return { companyIds };
}

function buildCompanyDomain(companyIds) {
  if (!companyIds.length) return [];
  return ["|", ["company_id", "=", false], ["company_id", "in", companyIds]];
}

function buildCompanyContext(companyIds) {
  if (!companyIds.length) return undefined;
  return { allowed_company_ids: companyIds };
}

async function findCategoryByName(uid, name) {
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
        [[["name", "ilike", name]]],
        { fields: ["id", "name"], limit: 5 },
      ],
    },
    id: Date.now(),
  });

  if (response.error) {
    throw new Error(response.error?.data?.message || response.error?.message);
  }

  const categories = response.result || [];
  const lower = name.toLowerCase();
  const exactMatch = categories.find(
    (category) =>
      typeof category.name === "string" &&
      category.name.toLowerCase() === lower,
  );

  return exactMatch || categories[0] || null;
}

async function findOrCreateCategory(uid, name) {
  const existing = await findCategoryByName(uid, name);
  if (existing?.id) return existing.id;

  const created = await callOdoo({
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [DB, uid, PASSWORD, "product.category", "create", [{ name }]],
    },
    id: Date.now(),
  });

  if (created.error) {
    throw new Error(created.error?.data?.message || created.error?.message);
  }

  return created.result;
}

async function resolveCategoryId(uid, raw) {
  if (raw === undefined || raw === null) return null;

  if (Array.isArray(raw)) {
    const [first, second] = raw;
    const parsed = Number(first);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    if (typeof second === "string" && second.trim()) {
      return await findOrCreateCategory(uid, second.trim());
    }
    return null;
  }

  if (typeof raw === "number") {
    return Number.isInteger(raw) ? raw : null;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    return await findOrCreateCategory(uid, trimmed);
  }

  if (typeof raw === "object") {
    const parsed = Number(raw.id);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    if (typeof raw.name === "string" && raw.name.trim()) {
      return await findOrCreateCategory(uid, raw.name.trim());
    }
  }

  return null;
}

function buildImageUrl(baseUrl, productId) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("web/image", normalizedBaseUrl);
  url.searchParams.set("model", "product.template");
  url.searchParams.set("id", String(productId));
  url.searchParams.set("field", "image_1920");
  return url.toString();
}

function stripDataUrl(value) {
  if (typeof value !== "string") return value;
  const match = value.trim().match(/^data:.*;base64,(.*)$/i);
  return match ? match[1] : value;
}

async function toBase64IfUrl(value, fieldLabel = "image") {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://"))
    return value;

  const res = await fetch(trimmed);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${fieldLabel} from URL (${res.status} ${res.statusText})`,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.toString("base64");
}

async function normalizeImageValue(value, fieldLabel) {
  if (value === undefined || value === null) return value;
  const stripped = stripDataUrl(value);
  return await toBase64IfUrl(stripped, fieldLabel);
}

async function buildProductData(
  input,
  availableFields,
  { includeDefaults = false, uid } = {},
) {
  const data = {};
  const imageInputs = {};
  const skippedKeys = new Set();

  if (availableFields.includes("categ_id")) {
    const directCategoryInput = input.categ_id ?? input.category_id;
    if (directCategoryInput !== undefined && uid) {
      const resolved = await resolveCategoryId(uid, directCategoryInput);
      if (resolved) data.categ_id = resolved;
      skippedKeys.add("categ_id");
      skippedKeys.add("category_id");
    }

    if (data.categ_id === undefined && input.category !== undefined && uid) {
      const resolved = await resolveCategoryId(uid, input.category);
      if (resolved) data.categ_id = resolved;
      skippedKeys.add("category");
    }
  }

  const normalizeProductType = (value) => {
    if (typeof value === "boolean") return value ? "product" : "consu";
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (
      ["goods", "product", "stockable", "stockable product"].includes(
        normalized,
      )
    )
      return "product";
    if (["consumable", "consu"].includes(normalized)) return "consu";
    if (["service", "services"].includes(normalized)) return "service";
    return value;
  };

  const normalizeInvoicePolicy = (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (["ordered quantities", "order", "ordered"].includes(normalized))
      return "order";
    if (["delivered quantities", "delivery", "delivered"].includes(normalized))
      return "delivery";
    return value;
  };

  const normalizeBoolean = (value) => {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (["yes", "true", "1"].includes(normalized)) return true;
    if (["no", "false", "0"].includes(normalized)) return false;
    return value;
  };

  for (const [inputKey, odooField] of Object.entries(WEBSITE_TO_ODOO_FIELD)) {
    if (skippedKeys.has(inputKey)) continue;
    const value = input[inputKey];
    if (value === undefined || value === null) continue;
    if (!availableFields.includes(odooField)) continue;
    if (IMAGE_FIELDS.has(odooField)) {
      imageInputs[odooField] = value;
      continue;
    }
    if (odooField === "type") {
      data[odooField] = normalizeProductType(value);
      continue;
    }
    if (odooField === "invoice_policy") {
      data[odooField] = normalizeInvoicePolicy(value);
      continue;
    }
    if (odooField === "x_studio_is_custom") {
      data[odooField] = normalizeBoolean(value);
      continue;
    }
    data[odooField] = value;
  }

  const preferredImage =
    imageInputs.image_1920 ??
    imageInputs.image_1024 ??
    imageInputs.image_512 ??
    imageInputs.image_256 ??
    imageInputs.image_128;
  if (preferredImage !== undefined && availableFields.includes("image_1920")) {
    data.image_1920 = await normalizeImageValue(preferredImage, "image_1920");
  }

  if (includeDefaults) {
    data.type = data.type || "consu";
    data.website_published = data.website_published ?? true;
  }

  return data;
}

async function fetchProductFieldNames(uid) {
  const fields = await callOdoo({
    jsonrpc: "2.0",
    method: "call",
    params: {
      service: "object",
      method: "execute_kw",
      args: [DB, uid, PASSWORD, "product.template", "fields_get", []],
    },
    id: 11,
  });

  return fields?.result ? Object.keys(fields.result) : [];
}

export async function getProductFields(req, res) {
  try {
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
          "product.template",
          "fields_get",
          [],
          { attributes: ["string", "type", "required"] },
        ],
      },
      id: 2,
    });

    res.json(fields.result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createProduct(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid)
      return res.status(401).json({ error: "Odoo authentication failed" });

    const input = req.body;

    const availableFields = await fetchProductFieldNames(uid);
    const data = await buildProductData(input, availableFields, {
      includeDefaults: true,
      uid,
    });

    const created = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "product.template", "create", [data]],
      },
      id: Date.now(),
    });

    if (created.error) {
      return res.status(400).json({ error: created.error });
    }

    res.json({ success: true, product_id: created.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateProduct(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid)
      return res.status(401).json({ error: "Odoo authentication failed" });

    const productId = parseInt(req.params.id, 10);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const input = req.body;
    const availableFields = await fetchProductFieldNames(uid);
    const data = await buildProductData(input, availableFields, { uid });

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const updated = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "product.template",
          "write",
          [[productId], data],
        ],
      },
      id: Date.now(),
    });

    if (updated.error) {
      return res.status(400).json({ error: updated.error });
    }

    res.json({ success: true, updated: updated.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteProduct(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const productId = parseInt(req.params.id, 10);

    const result = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "product.template", "unlink", [[productId]]],
      },
      id: 4,
    });

    res.json({ deleted: result.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getProductTypeValues(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const fields = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "product.template", "fields_get", ["type"]],
      },
      id: 99,
    });

    res.json(fields.result.type.selection);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function listProducts(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid)
      return res.status(401).json({ error: "Odoo authentication failed" });

    const { companyIds, error } = parseCompanyIds(req.query);
    if (error) return res.status(400).json({ error });

    const availableFields = await fetchProductFieldNames(uid);
    const fields =
      availableFields.length > 0 ? availableFields : ["id", "name"];
    const filteredFields = fields.filter(
      (field) => !field.startsWith("image_"),
    );
    if (!filteredFields.includes("id")) filteredFields.unshift("id");

    const domain = buildCompanyDomain(companyIds);
    const context = buildCompanyContext(companyIds);

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
          "product.template",
          "search_read",
          [domain],
          {
            fields: filteredFields,
            limit: 2000,
            ...(context ? { context } : {}),
          },
        ],
      },
      id: Date.now(),
    });

    if (response.error) {
      return res.status(400).json({ error: response.error });
    }

    const baseUrl = getOdooBaseUrl();
    const products = response.result.map((product) => ({
      ...product,
      image_1920: buildImageUrl(baseUrl, product.id),
    }));

    res.json({
      success: true,
      count: response.result.length,
      products,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getProductById(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid)
      return res.status(401).json({ error: "Odoo authentication failed" });

    const productId = parseInt(req.params.id, 10);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    const { companyIds, error } = parseCompanyIds(req.query);
    if (error) return res.status(400).json({ error });

    const availableFields = await fetchProductFieldNames(uid);
    const fields =
      availableFields.length > 0 ? availableFields : ["id", "name"];
    const filteredFields = fields.filter(
      (field) => !field.startsWith("image_"),
    );
    if (!filteredFields.includes("id")) filteredFields.unshift("id");

    const domain = [["id", "=", productId]];
    const companyDomain = buildCompanyDomain(companyIds);
    if (companyDomain.length) domain.push(...companyDomain);
    const context = buildCompanyContext(companyIds);

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
          "product.template",
          "search_read",
          [domain],
          { fields: filteredFields, limit: 1, ...(context ? { context } : {}) },
        ],
      },
      id: Date.now(),
    });

    if (response.error) {
      return res.status(400).json({ error: response.error });
    }

    const product = response.result?.[0];
    const baseUrl = getOdooBaseUrl();

    if (product) {
      return res.json({
        success: true,
        product: {
          ...product,
          image_1920: buildImageUrl(baseUrl, productId),
        },
      });
    }

    // Fallback: treat the id as a product variant (product.product) and resolve its template
    const variantResponse = await callOdoo({
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
          [[["id", "=", productId]]],
          {
            fields: ["id", "product_tmpl_id"],
            limit: 1,
            ...(context ? { context } : {}),
          },
        ],
      },
      id: Date.now(),
    });

    if (variantResponse.error) {
      return res.status(400).json({ error: variantResponse.error });
    }

    const variant = variantResponse.result?.[0];
    const templateId = Array.isArray(variant?.product_tmpl_id)
      ? variant.product_tmpl_id[0]
      : null;

    if (!templateId) {
      return res.status(404).json({ error: "Product not found" });
    }

    const templateResponse = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          uid,
          PASSWORD,
          "product.template",
          "search_read",
          [[["id", "=", templateId], ...companyDomain]],
          { fields: filteredFields, limit: 1, ...(context ? { context } : {}) },
        ],
      },
      id: Date.now(),
    });

    if (templateResponse.error) {
      return res.status(400).json({ error: templateResponse.error });
    }

    const resolved = templateResponse.result?.[0];
    if (!resolved) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({
      success: true,
      product: {
        ...resolved,
        image_1920: buildImageUrl(baseUrl, templateId),
        variant_id: variant.id,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
