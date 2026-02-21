# Odoo JSON-2 Migration Guide

This project now uses Odoo JSON-2 (`/json/2/<model>/<method>`) instead of legacy external RPC endpoints.

## 1) Odoo setup you must do

1. In Odoo, create API keys for each real user that should perform actions from your frontend.
2. Use minimum required permissions for each user.
3. Keep login as email-based users (the backend resolves users by email/login).

## 2) Environment variables

Use `.env` like this:

```env
# Odoo host (base URL, /jsonrpc, or /json/2 all work)
ODOO_URL=https://your-company.odoo.com
ODOO_DB=your-company-odoo-db

# Optional fallback API key when user_email is not passed
ODOO_API_KEY=default_api_key_here
ODOO_DEFAULT_USER_EMAIL=appmanagent@technicalservices.us

# Required for per-user attribution (email -> api key map)
ODOO_USER_API_KEYS={"alice@example.com":"key_for_alice","bob@example.com":"key_for_bob"}

# Required in this codebase by default
ODOO_REQUIRE_USER_EMAIL=true

# Optional: allow frontend to pass API key in header (usually keep false)
ODOO_ALLOW_API_KEY_HEADER=false
ODOO_USER_EMAIL_HEADER=x-odoo-user-email
ODOO_API_KEY_HEADER=x-odoo-api-key
```

Notes:
- If `ODOO_REQUIRE_USER_EMAIL=true`, requests must include `x-odoo-user-email` (or `user_email`).
- If email exists in `ODOO_USER_API_KEYS`, request runs as that user.
- If email is not mapped, request falls back to `ODOO_DEFAULT_USER_EMAIL` + `ODOO_API_KEY`.
- `ODOO_USER` and `ODOO_PASSWORD` are no longer used by this backend.

## 3) Frontend usage

Pass the acting user email with every API call:

```http
X-Odoo-User-Email: alice@example.com
```

Example:

```bash
curl -X POST http://localhost:3000/invoices \
  -H "Content-Type: application/json" \
  -H "X-Odoo-User-Email: alice@example.com" \
  -d '{"partner_id":123,"lines":[{"product_id":45,"quantity":1,"price_unit":99}]}'
```

## 4) User resolve endpoint for frontend login

Use this endpoint when a user logs in to your frontend:

- `GET /odoo/users/resolve?user_email=<email>`
- `POST /odoo/users/resolve` with `{ "user_email": "<email>" }`

Or pass header:

```http
X-Odoo-User-Email: alice@example.com
```

Response includes resolved `uid`, `user`, and `acting_email`.

## 5) PDF report endpoints

Invoice and sales-order PDF download endpoints still use Odoo web report routes (`/report/pdf/...`) with a web session, authenticated using the same acting user email + API key.
