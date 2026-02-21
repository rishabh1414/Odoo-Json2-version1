import "dotenv/config";

const required = ["ODOO_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(
    `Missing required environment variables: ${missing.join(
      ", ",
    )}. Check your .env or deployment environment.`,
  );
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseUserApiKeys(raw) {
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid ODOO_USER_API_KEYS JSON: ${err.message}. Example: {"alice@example.com":"api_key_here"}`
    );
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(
      "Invalid ODOO_USER_API_KEYS. Expected a JSON object keyed by user email."
    );
  }

  const normalized = {};
  for (const [email, key] of Object.entries(parsed)) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    if (!normalizedEmail || !normalizedKey) continue;
    normalized[normalizedEmail] = normalizedKey;
  }

  return normalized;
}

export const ODOO_URL = process.env.ODOO_URL;
export const DB = process.env.ODOO_DB || "";
export const ODOO_API_KEY = (process.env.ODOO_API_KEY || "").trim();
export const ODOO_USER_API_KEYS = parseUserApiKeys(process.env.ODOO_USER_API_KEYS);
export const ODOO_DEFAULT_USER_EMAIL = (
  process.env.ODOO_DEFAULT_USER_EMAIL || ""
)
  .trim()
  .toLowerCase();
export const ODOO_REQUIRE_USER_EMAIL = parseBoolean(
  process.env.ODOO_REQUIRE_USER_EMAIL,
  true
);
export const ODOO_ALLOW_API_KEY_HEADER = parseBoolean(
  process.env.ODOO_ALLOW_API_KEY_HEADER,
  false
);
export const ODOO_USER_EMAIL_HEADER = (
  process.env.ODOO_USER_EMAIL_HEADER || "x-odoo-user-email"
).toLowerCase();
export const ODOO_API_KEY_HEADER = (
  process.env.ODOO_API_KEY_HEADER || "x-odoo-api-key"
).toLowerCase();

if (
  !ODOO_API_KEY &&
  !Object.keys(ODOO_USER_API_KEYS).length &&
  !ODOO_ALLOW_API_KEY_HEADER
) {
  throw new Error(
    "Missing API key configuration. Set ODOO_API_KEY and/or ODOO_USER_API_KEYS."
  );
}

if (ODOO_API_KEY && !ODOO_DEFAULT_USER_EMAIL) {
  throw new Error(
    "Missing ODOO_DEFAULT_USER_EMAIL. Set the email for the default fallback API key user."
  );
}
