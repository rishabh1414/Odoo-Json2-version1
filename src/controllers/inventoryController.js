import { authOdoo, callOdoo, DB, PASSWORD } from "../services/odooClient.js";

export async function listInventory(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const domain = [];
    const fields = ["product_id", "location_id", "quantity", "available_quantity", "reserved_quantity", "company_id"];

    const response = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "stock.quant", "search_read", [domain], { fields, limit: 500 }],
      },
      id: Date.now(),
    });

    if (response.error) return res.status(400).json({ error: response.error });

    res.json({ success: true, count: response.result.length, quants: response.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function listLocations(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const fields = ["name", "complete_name", "usage", "location_id", "company_id"];
    const domain = [
      ["usage", "=", "internal"],
      ["company_id", "=", 2],
    ];
    const response = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "stock.location", "search_read", [domain], { fields, limit: 500 }],
      },
      id: Date.now(),
    });

    if (response.error) return res.status(400).json({ error: response.error });

    res.json({ success: true, count: response.result.length, locations: response.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function listLocationProducts(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const locationId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(locationId)) {
      return res.status(400).json({ error: "Invalid location id" });
    }

    const domain = [["location_id", "child_of", locationId]];
    const fields = [
      "product_id",
      "location_id",
      "quantity",
      "available_quantity",
      "reserved_quantity",
      "company_id",
    ];

    const response = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "stock.quant", "search_read", [domain], { fields, limit: 500 }],
      },
      id: Date.now(),
    });

    if (response.error) return res.status(400).json({ error: response.error });

    const quants = response.result ?? [];
    const variantIds = [
      ...new Set(
        quants
          .map((quant) =>
            Array.isArray(quant.product_id) ? quant.product_id[0] : null,
          )
          .filter((id) => Number.isFinite(id)),
      ),
    ];

    let templateByVariant = new Map();
    if (variantIds.length) {
      const variantsResponse = await callOdoo({
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
            [[["id", "in", variantIds]]],
            { fields: ["id", "product_tmpl_id"], limit: variantIds.length },
          ],
        },
        id: Date.now(),
      });

      if (variantsResponse.error) {
        return res.status(400).json({ error: variantsResponse.error });
      }

      templateByVariant = new Map(
        (variantsResponse.result ?? []).map((variant) => {
          const tmpl = Array.isArray(variant.product_tmpl_id)
            ? variant.product_tmpl_id
            : [];
          return [
            variant.id,
            {
              templateId: tmpl[0] ?? null,
              templateName: tmpl[1] ?? null,
            },
          ];
        }),
      );
    }

    const enriched = quants.map((quant) => {
      const variant = Array.isArray(quant.product_id)
        ? quant.product_id
        : [];
      const mapping = templateByVariant.get(variant[0]);
      const templateId = mapping?.templateId ?? null;
      const templateName = mapping?.templateName ?? null;

      return {
        ...quant,
        // Replace product_id with template id/name for client convenience
        product_id: templateId ? [templateId, templateName] : quant.product_id,
        product_variant_id: variant[0] ?? null,
        product_variant_name: variant[1] ?? null,
        product_template_id: templateId,
        product_template_name: templateName,
      };
    });

    res.json({ success: true, count: enriched.length, quants: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
