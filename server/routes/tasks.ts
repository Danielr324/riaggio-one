import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { actorOf } from "../auth.js";
import type { Database } from "../db.js";
import { HttpError, route } from "../errors.js";
import { canInDepartment, type Actor } from "../permissions.js";
import { taskVisibility } from "../visibility.js";

const STATUSES = ["pending", "in_progress", "blocked", "completed", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Fecha no válida.");

const createSchema = z.object({
  title: z.string().trim().min(3, "El título necesita al menos 3 caracteres.").max(160),
  description: z.string().trim().max(4000).default(""),
  departmentId: z.string().min(1, "Selecciona un departamento.").max(64),
  assigneeId: z.string().min(1).max(64).nullable().optional(),
  priority: z.enum(PRIORITIES).default("normal"),
  dueDate: isoDate.nullable().optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(3, "El título necesita al menos 3 caracteres.").max(160).optional(),
    description: z.string().trim().max(4000).optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeId: z.string().min(1).max(64).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No hay cambios que guardar.");

// Una persona asignada puede avanzar el estado de su tarea sin poder reasignarla
// ni editarla. Cualquier otro cambio exige permiso de gestión en el departamento.
const ASSIGNEE_FIELDS = new Set(["status"]);

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  department_id: string;
  department_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_by_user_id: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

const TASK_SELECT = `
  SELECT t.id, t.title, t.description, t.status, t.priority, t.department_id, d.name AS department_name,
         t.assignee_id, e.first_name || ' ' || e.last_name AS assignee_name,
         t.created_by_user_id, t.due_date, t.created_at, t.updated_at
    FROM tasks t
    JOIN departments d ON d.id = t.department_id
    LEFT JOIN employees e ON e.id = t.assignee_id`;

function toTask(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    departmentId: row.department_id,
    departmentName: row.department_name,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function findVisibleTask(db: Database, actor: Actor, id: string): TaskRow | undefined {
  const scope = taskVisibility(actor, "t");
  return db.get<TaskRow>(`${TASK_SELECT} WHERE (${scope.sql}) AND t.id = ?`, [...scope.params, id]);
}

function assertAssignee(db: Database, assigneeId: string | null | undefined): void {
  if (!assigneeId) return;
  if (!db.get("SELECT id FROM employees WHERE id = ?", [assigneeId])) {
    throw new HttpError(400, "La persona asignada no existe.");
  }
}

function recordEvent(db: Database, taskId: string, actorUserId: string, type: string, detail: unknown): void {
  db.run("INSERT INTO task_events (id, task_id, actor_user_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    randomUUID(),
    taskId,
    actorUserId,
    type,
    JSON.stringify(detail),
    new Date().toISOString(),
  ]);
}

export function tasksRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/",
    route((req, res) => {
      const actor = actorOf(res);
      const scope = taskVisibility(actor, "t");
      const clauses = [`(${scope.sql})`];
      const params: string[] = [...scope.params];

      const status = typeof req.query.status === "string" ? req.query.status : "";
      if (status) {
        if (!(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "Estado no válido.");
        clauses.push("t.status = ?");
        params.push(status);
      }
      const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : "";
      if (departmentId) {
        clauses.push("t.department_id = ?");
        params.push(departmentId);
      }
      if (req.query.mine === "true" && actor.employeeId) {
        clauses.push("t.assignee_id = ?");
        params.push(actor.employeeId);
      }

      const rows = db.all<TaskRow>(
        `${TASK_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY t.due_date IS NULL, t.due_date, t.created_at DESC LIMIT 500`,
        params,
      );
      res.json({ items: rows.map(toTask) });
    }),
  );

  router.get(
    "/:id",
    route((req, res) => {
      const task = findVisibleTask(db, actorOf(res), req.params.id);
      if (!task) throw new HttpError(404, "Tarea no encontrada.");
      const events = db.all<{ type: string; detail: string; actor_email: string; created_at: string }>(
        `SELECT ev.type, ev.detail, u.email AS actor_email, ev.created_at
           FROM task_events ev JOIN users u ON u.id = ev.actor_user_id
          WHERE ev.task_id = ? ORDER BY ev.created_at DESC LIMIT 200`,
        [task.id],
      );
      res.json({
        ...toTask(task),
        events: events.map((e) => ({ type: e.type, detail: JSON.parse(e.detail), actorEmail: e.actor_email, createdAt: e.created_at })),
      });
    }),
  );

  router.post(
    "/",
    route((req, res) => {
      const actor = actorOf(res);
      const body = createSchema.parse(req.body);
      if (!canInDepartment(actor, "tasks.write", body.departmentId)) {
        throw new HttpError(403, "No puedes crear tareas en ese departamento.");
      }
      const department = db.get("SELECT id FROM departments WHERE id = ?", [body.departmentId]);
      if (!department) throw new HttpError(400, "El departamento seleccionado no existe.");
      assertAssignee(db, body.assigneeId);

      const id = randomUUID();
      const now = new Date().toISOString();
      db.transaction(() => {
        db.run(
          `INSERT INTO tasks (id, title, description, status, priority, department_id, assignee_id,
                              created_by_user_id, due_date, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            body.title,
            body.description,
            body.priority,
            body.departmentId,
            body.assigneeId ?? null,
            actor.userId,
            body.dueDate ?? null,
            now,
            now,
          ],
        );
        recordEvent(db, id, actor.userId, "created", { title: body.title });
      });
      const created = findVisibleTask(db, actor, id);
      res.status(201).json(created ? toTask(created) : { id });
    }),
  );

  router.patch(
    "/:id",
    route((req, res) => {
      const actor = actorOf(res);
      const task = findVisibleTask(db, actor, req.params.id);
      if (!task) throw new HttpError(404, "Tarea no encontrada.");

      const body = updateSchema.parse(req.body);
      const canManage = canInDepartment(actor, "tasks.write", task.department_id);
      const isAssignee = actor.employeeId !== null && task.assignee_id === actor.employeeId;
      const onlyAssigneeFields = Object.keys(body).every((key) => ASSIGNEE_FIELDS.has(key));
      if (!canManage && !(isAssignee && onlyAssigneeFields)) {
        throw new HttpError(403, "No tienes permiso para modificar esta tarea.");
      }
      assertAssignee(db, body.assigneeId);

      const fields: Array<keyof typeof body> = Object.keys(body) as Array<keyof typeof body>;
      const columnFor: Record<string, string> = {
        title: "title",
        description: "description",
        status: "status",
        priority: "priority",
        assigneeId: "assignee_id",
        dueDate: "due_date",
      };
      const previousValue: Record<string, string | null> = {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assignee_id,
        dueDate: task.due_date,
      };
      db.transaction(() => {
        const assignments = fields.map((field) => `${columnFor[field]} = ?`);
        const values = fields.map((field) => (body[field] ?? null) as string | null);
        db.run(`UPDATE tasks SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`, [
          ...values,
          new Date().toISOString(),
          task.id,
        ]);
        const changes = fields.map((field) => ({
          field,
          from: previousValue[field] ?? null,
          to: body[field] ?? null,
        }));
        recordEvent(db, task.id, actor.userId, "updated", { changes });
      });
      const updated = findVisibleTask(db, actor, task.id);
      res.json(updated ? toTask(updated) : { id: task.id });
    }),
  );

  return router;
}
