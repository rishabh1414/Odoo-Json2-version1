import { authOdoo, getOdooIdentity } from "../services/odooClient.js";

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
