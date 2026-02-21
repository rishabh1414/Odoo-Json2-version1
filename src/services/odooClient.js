import { AsyncLocalStorage } from "node:async_hooks";
import {
  ODOO_URL,
  DB,
  ODOO_API_KEY,
  ODOO_USER_API_KEYS,
  ODOO_DEFAULT_USER_EMAIL,
  ODOO_REQUIRE_USER_EMAIL,
  ODOO_ALLOW_API_KEY_HEADER,
  ODOO_USER_EMAIL_HEADER,
  ODOO_API_KEY_HEADER,
} from "../config/odoo.js";

const odooRequestContextStorage = new AsyncLocalStorage();
const ACTING_EMAIL_KEYS = ["odoo_user_email", "user_email"];

function normalizeOdooBaseUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  let pathname = parsed.pathname.replace(/\/+$/, "");
  pathname = pathname.replace(/\/jsonrpc$/i, "");
  pathname = pathname.replace(/\/json\/2(?:\/.*)?$/i, "");
  return `${parsed.origin}${pathname}`;
}

const ODOO_BASE_URL = normalizeOdooBaseUrl(ODOO_URL);
const ODOO_JSON2_BASE_URL = `${ODOO_BASE_URL}/json/2`;

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const setCookie = headers.get("set-cookie");
  return setCookie ? [setCookie] : [];
}

function readHeader(req, headerName) {
  if (!req) return "";
  if (typeof req.get === "function") {
    const value = req.get(headerName);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const raw = req.headers?.[headerName] ?? req.headers?.[headerName.toLowerCase()];
  if (Array.isArray(raw)) {
    return String(raw[0] || "").trim();
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function readRequestKey(source, key) {
  if (!source || typeof source !== "object") return "";
  const value = source[key];
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value).trim();
}

function normalizeEmail(rawEmail) {
  if (!rawEmail) return "";
  return String(rawEmail).trim().toLowerCase();
}

function extractActingEmail(req) {
  const emailFromHeader =
    readHeader(req, ODOO_USER_EMAIL_HEADER) || readHeader(req, "x-odoo-user-email");
  if (emailFromHeader) return normalizeEmail(emailFromHeader);

  for (const key of ACTING_EMAIL_KEYS) {
    const queryValue = readRequestKey(req?.query, key);
    if (queryValue) return normalizeEmail(queryValue);
  }

  for (const key of ACTING_EMAIL_KEYS) {
    const bodyValue = readRequestKey(req?.body, key);
    if (bodyValue) return normalizeEmail(bodyValue);
  }

  return "";
}

function getRequestContext() {
  return odooRequestContextStorage.getStore() || null;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter(Number.isFinite);
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed)) return [parsed];
  return [];
}

function previewText(value, max = 500) {
  return String(value || "").slice(0, max);
}

function normalizeJson2Error({ status, statusText, parsedBody, rawBody }) {
  const rawMessage =
    parsedBody?.message ||
    parsedBody?.error?.message ||
    parsedBody?.description ||
    parsedBody?.name ||
    `Odoo request failed with status ${status} ${statusText}`;

  return {
    message: rawMessage,
    status,
    data: parsedBody ?? previewText(rawBody, 1200),
  };
}

function safeJsonParse(raw) {
  if (!raw || !String(raw).trim()) return null;
  return JSON.parse(raw);
}

function resolveApiKeyForRequest() {
  const context = getRequestContext();
  const requestedEmail = context?.actingEmail || "";
  const headerKey = context?.apiKeyFromHeader || "";

  if (requestedEmail) {
    const mapped = ODOO_USER_API_KEYS[requestedEmail];
    if (mapped) {
      return {
        apiKey: mapped,
        source: "email_map",
        actingEmail: requestedEmail,
        effectiveEmail: requestedEmail,
      };
    }

    if (ODOO_ALLOW_API_KEY_HEADER && headerKey) {
      return {
        apiKey: headerKey,
        source: "request_header",
        actingEmail: requestedEmail,
        effectiveEmail: requestedEmail,
      };
    }

    if (ODOO_API_KEY && ODOO_DEFAULT_USER_EMAIL) {
      return {
        apiKey: ODOO_API_KEY,
        source: "default_fallback_user",
        actingEmail: requestedEmail,
        effectiveEmail: ODOO_DEFAULT_USER_EMAIL,
      };
    }

    return {
      apiKey: "",
      source: "",
      actingEmail: requestedEmail,
      effectiveEmail: "",
      error: `No API key configured for acting user email '${requestedEmail}'.`,
    };
  }

  if (ODOO_REQUIRE_USER_EMAIL) {
    return {
      apiKey: "",
      source: "",
      actingEmail: "",
      effectiveEmail: "",
      error:
        "Missing acting user email. Pass it via header x-odoo-user-email or body/query user_email.",
    };
  }

  if (ODOO_ALLOW_API_KEY_HEADER && headerKey) {
    return {
      apiKey: headerKey,
      source: "request_header",
      actingEmail: "",
      effectiveEmail: "",
    };
  }

  if (ODOO_API_KEY && ODOO_DEFAULT_USER_EMAIL) {
    return {
      apiKey: ODOO_API_KEY,
      source: "default_env",
      actingEmail: "",
      effectiveEmail: ODOO_DEFAULT_USER_EMAIL,
    };
  }

  return {
    apiKey: "",
    source: "",
    actingEmail: "",
    effectiveEmail: "",
    error: "No API key available for this request.",
  };
}

function cacheResolvedAuthInfo(info) {
  const context = getRequestContext();
  if (!context) return;
  context.apiKeySource = info.source || context.apiKeySource || null;
  context.effectiveEmail =
    info.effectiveEmail || context.effectiveEmail || context.actingEmail || null;
}

function buildJson2Headers(apiKey) {
  const headers = {
    Authorization: `bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (DB) {
    headers["X-Odoo-Database"] = DB;
  }

  return headers;
}

async function callJson2Endpoint({ model, method, params = {} }) {
  const auth = resolveApiKeyForRequest();
  if (!auth.apiKey) {
    return {
      error: {
        message: auth.error || "Odoo authentication failed",
        status: 401,
      },
    };
  }

  cacheResolvedAuthInfo(auth);

  const endpoint = `${ODOO_JSON2_BASE_URL}/${encodeURIComponent(model)}/${encodeURIComponent(method)}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: buildJson2Headers(auth.apiKey),
    body: JSON.stringify(isPlainObject(params) ? params : {}),
  });

  const bodyText = await res.text();
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  let parsedBody = null;

  if (isJson) {
    try {
      parsedBody = safeJsonParse(bodyText);
    } catch (err) {
      throw new Error(
        `Unable to parse Odoo JSON-2 response: ${err.message}. Response: ${previewText(
          bodyText
        )}`
      );
    }
  }

  if (!res.ok) {
    return {
      error: normalizeJson2Error({
        status: res.status,
        statusText: res.statusText,
        parsedBody,
        rawBody: bodyText,
      }),
    };
  }

  if (!isJson) {
    throw new Error(
      `Odoo JSON-2 response is not JSON (${contentType || "unknown"}): ${previewText(
        bodyText
      )}`
    );
  }

  return { result: parsedBody };
}

function translateExecuteKwToJson2Params(method, methodArgs = [], kwargs = {}) {
  const params = isPlainObject(kwargs) ? { ...kwargs } : {};
  const args = Array.isArray(methodArgs) ? methodArgs : [];

  switch (method) {
    case "search":
      if (args[0] !== undefined && params.domain === undefined) params.domain = args[0];
      if (args[1] !== undefined && params.offset === undefined) params.offset = args[1];
      if (args[2] !== undefined && params.limit === undefined) params.limit = args[2];
      if (args[3] !== undefined && params.order === undefined) params.order = args[3];
      return params;

    case "search_read":
      if (args[0] !== undefined && params.domain === undefined) params.domain = args[0];
      if (args[1] !== undefined && params.fields === undefined) params.fields = args[1];
      if (args[2] !== undefined && params.offset === undefined) params.offset = args[2];
      if (args[3] !== undefined && params.limit === undefined) params.limit = args[3];
      if (args[4] !== undefined && params.order === undefined) params.order = args[4];
      return params;

    case "fields_get":
      if (args[0] !== undefined && params.allfields === undefined) {
        params.allfields = args[0];
      }
      return params;

    case "create":
      if (args[0] !== undefined && params.vals_list === undefined) {
        params.vals_list = args[0];
      }
      return params;

    case "write":
      if (args[0] !== undefined && params.ids === undefined) {
        params.ids = normalizeIds(args[0]);
      }
      if (args[1] !== undefined && params.vals === undefined) {
        params.vals = args[1];
      }
      return params;

    case "unlink":
      if (args[0] !== undefined && params.ids === undefined) {
        params.ids = normalizeIds(args[0]);
      }
      return params;

    case "read":
      if (args[0] !== undefined && params.ids === undefined) {
        params.ids = normalizeIds(args[0]);
      }
      if (args[1] !== undefined && params.fields === undefined) {
        params.fields = args[1];
      }
      return params;

    default:
      if (args.length && params.args === undefined) {
        params.args = args;
      }
      return params;
  }
}

function parseLegacyPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Odoo payload");
  }

  if (payload.model && payload.method) {
    return {
      model: payload.model,
      method: payload.method,
      methodArgs: Array.isArray(payload.args) ? payload.args : [],
      kwargs: isPlainObject(payload.kwargs) ? payload.kwargs : {},
    };
  }

  const service = payload.params?.service;
  const rpcMethod = payload.params?.method;
  if (service !== "object" || rpcMethod !== "execute_kw") {
    throw new Error(
      "Unsupported Odoo payload. Expected execute_kw call shape or {model, method, ...}."
    );
  }

  const args = payload.params?.args;
  if (!Array.isArray(args) || args.length < 5) {
    throw new Error("Invalid execute_kw payload: missing required arguments");
  }

  const model = args[3];
  const method = args[4];
  const methodArgs = Array.isArray(args[5]) ? args[5] : [];
  const kwargs = isPlainObject(args[6]) ? args[6] : {};

  if (!model || !method) {
    throw new Error("Invalid execute_kw payload: missing model or method");
  }

  return { model, method, methodArgs, kwargs };
}

async function resolveUserByEmail(actingEmail) {
  if (!actingEmail) return null;

  const userLookup = await callJson2Endpoint({
    model: "res.users",
    method: "search_read",
    params: {
      domain: [
        "|",
        ["login", "=", actingEmail],
        ["email", "=", actingEmail],
      ],
      fields: ["id", "name", "login", "email"],
      limit: 1,
    },
  });

  if (userLookup.error) return null;
  const user = userLookup.result?.[0];
  return user || null;
}

async function resolveCurrentUserFromContext() {
  const contextResponse = await callJson2Endpoint({
    model: "res.users",
    method: "context_get",
    params: {},
  });
  if (!contextResponse.error && isPlainObject(contextResponse.result)) {
    const contextResult = contextResponse.result;
    const uidRaw =
      contextResult.uid ??
      (Array.isArray(contextResult.user_id) ? contextResult.user_id[0] : contextResult.user_id);
    const uid = Number(uidRaw);
    if (Number.isInteger(uid) && uid > 0) {
      const userRead = await callJson2Endpoint({
        model: "res.users",
        method: "read",
        params: {
          ids: [uid],
          fields: ["id", "name", "login", "email"],
          limit: 1,
        },
      });

      if (userRead.error) {
        return { id: uid };
      }

      return userRead.result?.[0] || { id: uid };
    }
  }

  // Fallback when context_get does not provide uid in this Odoo setup.
  const fallback = await callJson2Endpoint({
    model: "res.users",
    method: "search_read",
    params: {
      domain: [],
      fields: ["id", "name", "login", "email"],
      limit: 1,
    },
  });

  if (fallback.error) return null;
  return fallback.result?.[0] || null;
}

function resolveSessionCredentials() {
  const context = getRequestContext();
  const auth = resolveApiKeyForRequest();
  const login =
    context?.effectiveEmail ||
    context?.actingEmail ||
    context?.user?.login ||
    context?.user?.email ||
    auth?.effectiveEmail ||
    "";

  if (auth.apiKey && login) {
    return {
      login,
      password: auth.apiKey,
    };
  }

  return null;
}

export function odooRequestContextMiddleware(req, res, next) {
  const actingEmail = extractActingEmail(req);
  const apiKeyFromHeader = ODOO_ALLOW_API_KEY_HEADER
    ? readHeader(req, ODOO_API_KEY_HEADER) || readHeader(req, "x-odoo-api-key")
    : "";

  const context = {
    actingEmail,
    effectiveEmail: null,
    apiKeyFromHeader,
    apiKeySource: null,
    uid: null,
    user: null,
  };

  odooRequestContextStorage.run(context, next);
}

export async function callOdoo(payload) {
  const parsed = parseLegacyPayload(payload);
  const params = translateExecuteKwToJson2Params(
    parsed.method,
    parsed.methodArgs,
    parsed.kwargs
  );
  return await callJson2Endpoint({
    model: parsed.model,
    method: parsed.method,
    params,
  });
}

export async function authOdoo() {
  const context = getRequestContext();
  if (context?.uid) return context.uid;

  const auth = resolveApiKeyForRequest();
  if (!auth.apiKey) return null;
  cacheResolvedAuthInfo(auth);

  const effectiveEmail = context?.effectiveEmail || auth.effectiveEmail || "";
  const user = effectiveEmail
    ? await resolveUserByEmail(effectiveEmail)
    : await resolveCurrentUserFromContext();
  if (!user) return null;

  if (context) {
    context.uid = user.id || null;
    context.user = user;
    context.apiKeySource = auth.source || context.apiKeySource;
    context.effectiveEmail =
      context.effectiveEmail ||
      normalizeEmail(user.login) ||
      normalizeEmail(user.email) ||
      null;
  }

  return user.id || null;
}

export function getOdooIdentity() {
  const context = getRequestContext();
  return {
    acting_email: context?.actingEmail || null,
    effective_email: context?.effectiveEmail || null,
    api_key_source: context?.apiKeySource || null,
    uid: context?.uid || null,
    user: context?.user || null,
  };
}

async function createOdooSessionCookie() {
  const credentials = resolveSessionCredentials();
  if (!credentials?.login || !credentials?.password) {
    throw new Error(
      "Unable to authenticate Odoo web session for report generation. Configure user email + API key mapping."
    );
  }

  const authUrl = `${ODOO_BASE_URL}/web/session/authenticate`;
  const headers = { "Content-Type": "application/json" };
  if (DB) {
    headers["X-Odoo-Database"] = DB;
  }

  const res = await fetch(authUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: {
        ...(DB ? { db: DB } : {}),
        login: credentials.login,
        password: credentials.password,
      },
      id: Date.now(),
    }),
  });

  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();
  const preview = bodyText.slice(0, 500);

  if (!res.ok) {
    throw new Error(
      `Odoo session auth failed with status ${res.status} ${res.statusText}: ${preview}`
    );
  }

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Odoo session auth responded with non-JSON content (${
        contentType || "unknown"
      }): ${preview}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(
      `Unable to parse Odoo session auth JSON response: ${err.message}. Response: ${preview}`
    );
  }

  if (parsed.error || !parsed.result?.uid) {
    throw new Error(
      `Odoo session auth did not return a valid session: ${JSON.stringify(
        parsed.error || parsed.result
      )}`
    );
  }

  const cookies = getSetCookies(res.headers)
    .map((cookie) => String(cookie).split(";")[0])
    .filter(Boolean);
  const sessionCookie = cookies.find((cookie) => cookie.startsWith("session_id="));

  if (!sessionCookie) {
    throw new Error("Odoo session auth succeeded but no session_id cookie was returned");
  }

  return sessionCookie;
}

export async function fetchOdooReportPdf({ reportName, documentIds, reportContext }) {
  if (!reportName) throw new Error("Missing report name");
  if (!Array.isArray(documentIds) || !documentIds.length) {
    throw new Error("Missing report document IDs");
  }

  const normalizedIds = documentIds
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!normalizedIds.length) {
    throw new Error("Invalid report document IDs");
  }

  const sessionCookie = await createOdooSessionCookie();
  const reportPath = reportName.split("/").map(encodeURIComponent).join("/");
  const reportUrl = new URL(
    `${ODOO_BASE_URL}/report/pdf/${reportPath}/${normalizedIds.join(",")}`
  );
  if (reportContext && Object.keys(reportContext).length) {
    reportUrl.searchParams.set("context", JSON.stringify(reportContext));
  }

  const res = await fetch(reportUrl, {
    method: "GET",
    headers: {
      Accept: "application/pdf",
      Cookie: sessionCookie,
    },
  });

  const body = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "";
  const preview = body.toString("utf8", 0, 500);

  if (!res.ok) {
    throw new Error(
      `Odoo report request failed with status ${res.status} ${res.statusText}: ${preview}`
    );
  }

  if (!contentType.includes("application/pdf")) {
    throw new Error(
      `Odoo report response is not PDF (${contentType || "unknown"}): ${preview}`
    );
  }

  return body;
}

export async function resolveReportNameByModel({ model, preferred = [] }) {
  const fallback = preferred.find(Boolean) || null;
  if (!model) return fallback;

  try {
    const response = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [
          DB,
          1,
          "",
          "ir.actions.report",
          "search_read",
          [[["model", "=", model], ["report_type", "=", "qweb-pdf"]]],
          { fields: ["report_name"], limit: 50 },
        ],
      },
      id: Date.now(),
    });

    if (response.error) return fallback;

    const available = (response.result || [])
      .map((record) => record?.report_name)
      .filter(Boolean);

    for (const candidate of preferred) {
      if (available.includes(candidate)) return candidate;
    }

    return available[0] || fallback;
  } catch {
    return fallback;
  }
}

export const PASSWORD = "";
export { DB };
