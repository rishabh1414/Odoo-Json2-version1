import { authOdoo, callOdoo, DB, PASSWORD } from "../services/odooClient.js";

const TASK_FIELDS = [
  "id",
  "name",
  "display_name",
  "description",
  "project_id",
  "user_id",
  "stage_id",
  "kanban_state",
  "priority",
  "date_deadline",
  "date_start",
  "date_end",
  "planned_hours",
  "remaining_hours",
  "progress",
  "partner_id",
  "company_id",
  "parent_id",
  "tag_ids",
  "sequence",
  "active",
  "create_date",
  "write_date",
];

async function getTaskFieldSet(uid) {
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
        "project.task",
        "fields_get",
        [],
        { attributes: ["string", "type", "required"] },
      ],
    },
    id: 700,
  });

  if (fields.error) return { error: fields.error };

  const keys = Object.keys(fields.result || {});
  return { fieldSet: new Set(keys) };
}

function parseOptionalInt(value, label, { allowZero = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || (!allowZero && parsed <= 0)) {
    return { error: `Invalid ${label}` };
  }

  return { value: parsed };
}

function normalizeTagIds(raw) {
  if (!Array.isArray(raw)) return raw;
  if (raw.length === 0) return raw;
  const numeric = raw.every((value) => Number.isInteger(Number(value)));
  if (!numeric) return raw;
  const ids = raw.map((value) => Number(value));
  return [[6, 0, ids]];
}

function buildTaskPayload(input, fieldSet) {
  const data = {
    name: input.name,
    description: input.description,
    project_id: input.project_id,
    user_id: input.user_id,
    stage_id: input.stage_id,
    kanban_state: input.kanban_state,
    priority: input.priority,
    date_deadline: input.date_deadline,
    date_start: input.date_start,
    date_end: input.date_end,
    planned_hours: input.planned_hours,
    remaining_hours: input.remaining_hours,
    progress: input.progress,
    partner_id: input.partner_id,
    company_id: input.company_id,
    parent_id: input.parent_id,
    tag_ids: normalizeTagIds(input.tag_ids),
    sequence: input.sequence,
    active: input.active,
  };

  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (!fieldSet.has(key)) continue;
    filtered[key] = value;
  }

  return filtered;
}

export async function listTasks(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const { fieldSet, error } = await getTaskFieldSet(uid);
    if (error) return res.status(400).json({ error });

    const { value: projectId, error: projectError } = parseOptionalInt(
      req.query.project_id,
      "project_id",
    );
    if (projectError) return res.status(400).json({ error: projectError });

    const { value: userId, error: userError } = parseOptionalInt(
      req.query.user_id,
      "user_id",
    );
    if (userError) return res.status(400).json({ error: userError });

    const { value: stageId, error: stageError } = parseOptionalInt(
      req.query.stage_id,
      "stage_id",
    );
    if (stageError) return res.status(400).json({ error: stageError });

    const { value: companyId, error: companyError } = parseOptionalInt(
      req.query.company_id,
      "company_id",
    );
    if (companyError) return res.status(400).json({ error: companyError });

    const { value: limit, error: limitError } = parseOptionalInt(
      req.query.limit,
      "limit",
      { allowZero: true },
    );
    if (limitError) return res.status(400).json({ error: limitError });

    const { value: offset, error: offsetError } = parseOptionalInt(
      req.query.offset,
      "offset",
      { allowZero: true },
    );
    if (offsetError) return res.status(400).json({ error: offsetError });

    const domain = [];
    if (projectId) domain.push(["project_id", "=", projectId]);
    if (userId) domain.push(["user_id", "=", userId]);
    if (stageId) domain.push(["stage_id", "=", stageId]);
    if (companyId) domain.push(["company_id", "=", companyId]);

    if (typeof req.query.active !== "undefined") {
      const active =
        String(req.query.active).toLowerCase() === "true" ||
        String(req.query.active) === "1";
      domain.push(["active", "=", active]);
    }

    if (req.query.search) {
      domain.push(["name", "ilike", String(req.query.search)]);
    }

    const fields = TASK_FIELDS.filter((field) => fieldSet.has(field));
    if (!fields.includes("id")) fields.unshift("id");

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
          "project.task",
          "search_read",
          [domain],
          {
            fields,
            limit: limit ?? 500,
            offset: offset ?? 0,
            ...(req.query.order ? { order: String(req.query.order) } : {}),
          },
        ],
      },
      id: Date.now(),
    });

    if (response.error) return res.status(400).json({ error: response.error });

    res.json({ success: true, count: response.result.length, tasks: response.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getTaskById(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const taskId = parseInt(req.params.id, 10);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const { fieldSet, error } = await getTaskFieldSet(uid);
    if (error) return res.status(400).json({ error });

    const fields = TASK_FIELDS.filter((field) => fieldSet.has(field));
    if (!fields.includes("id")) fields.unshift("id");

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
          "project.task",
          "search_read",
          [[["id", "=", taskId]]],
          { fields, limit: 1 },
        ],
      },
      id: Date.now(),
    });

    if (response.error) return res.status(400).json({ error: response.error });

    const task = response.result?.[0];
    if (!task) return res.status(404).json({ error: "Task not found" });

    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createTask(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const { fieldSet, error } = await getTaskFieldSet(uid);
    if (error) return res.status(400).json({ error });

    const data = buildTaskPayload(req.body || {}, fieldSet);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid task fields provided" });
    }

    const created = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "project.task", "create", [data]],
      },
      id: Date.now(),
    });

    if (created.error) return res.status(400).json({ error: created.error });

    res.json({ success: true, task_id: created.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateTask(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const taskId = parseInt(req.params.id, 10);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const { fieldSet, error } = await getTaskFieldSet(uid);
    if (error) return res.status(400).json({ error });

    const data = buildTaskPayload(req.body || {}, fieldSet);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const updated = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "project.task", "write", [[taskId], data]],
      },
      id: Date.now(),
    });

    if (updated.error) return res.status(400).json({ error: updated.error });

    res.json({ success: true, updated: updated.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteTask(req, res) {
  try {
    const uid = await authOdoo();
    if (!uid) return res.status(401).json({ error: "Auth failed" });

    const taskId = parseInt(req.params.id, 10);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const result = await callOdoo({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [DB, uid, PASSWORD, "project.task", "unlink", [[taskId]]],
      },
      id: Date.now(),
    });

    if (result.error) return res.status(400).json({ error: result.error });

    res.json({ success: true, deleted: result.result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
