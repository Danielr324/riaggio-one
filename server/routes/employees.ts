import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { actorOf, requirePermission } from "../auth.js";
import { audit } from "../audit.js";
import type { Database } from "../db.js";
import { HttpError, route } from "../errors.js";
import { canInDepartment } from "../permissions.js";
import { employeeVisibility } from "../visibility.js";

const EMPLOYMENT_STATUSES = ["active", "on_leave", "terminated"] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Fecha no válida.");

const optionalId = z.string().min(1).max(64).nullable().optional();

const employeeFields = z.object({
  firstName: z.string().trim().min(1, "Escribe el nombre.").max(80),
  lastName: z.string().trim().min(1, "Escribe los apellidos.").max(120),
  jobTitle: z.string().trim().min(2, "Escribe el cargo.").max(120),
  departmentId: z.string().min(1, "Selecciona un departamento.").max(64),
  workCenterId: optionalId,
  managerId: optionalId,
  corporateEmail: z.string().trim().email("Correo corporativo no válido.").max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
});

const createSchema = employeeFields.extend({
  employeeCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,20}$/, "El código debe tener de 3 a 20 letras, números o guiones."),
  hireDate: isoDate,
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).default("active"),
});

const updateSchema = employeeFields.partial();

const COLUMN_BY_FIELD: Record<keyof z.infer<typeof updateSchema>, string> = {
  firstName: "first_name",
  lastName: "last_name",
  jobTitle: "job_title",
  departmentId: "department_id",
  workCenterId: "work_center_id",
  managerId: "manager_id",
  corporateEmail: "corporate_email",
  phone: "phone",
  employmentStatus: "employment_status",
};

interface EmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  job_title: string;
  department_id: string;
  department_name: string;
  work_center_id: string | null;
  work_center_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  corporate_email: string | null;
  phone: string | null;
  employment_status: string;
  hire_date: string;
  updated_at: string;
}

const EMPLOYEE_SELECT = `
  SELECT e.id, e.employee_code, e.first_name, e.last_name, e.job_title,
         e.department_id, d.name AS department_name,
         e.work_center_id, w.name AS work_center_name,
         e.manager_id, m.first_name || ' ' || m.last_name AS manager_name,
         e.corporate_email, e.phone, e.employment_status, e.hire_date, e.updated_at
    FROM employees e
    JOIN departments d ON d.id = e.department_id
    LEFT JOIN work_centers w ON w.id = e.work_center_id
    LEFT JOIN employees m ON m.id = e.manager_id`;

function toEmployee(row: EmployeeRow) {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`,
    jobTitle: row.job_title,
    departmentId: row.department_id,
    departmentName: row.department_name,
    workCenterId: row.work_center_id,
    workCenterName: row.work_center_name,
    managerId: row.manager_id,
    managerName: row.manager_name,
    corporateEmail: row.corporate_email,
    phone: row.phone,
    employmentStatus: row.employment_status,
    hireDate: row.hire_date,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function assertReferences(
  db: Database,
  refs: { departmentId?: string; workCenterId?: string | null; managerId?: string | null },
  selfId?: string,
): void {
  if (refs.departmentId !== undefined) {
    const found = db.get("SELECT id FROM departments WHERE id = ?", [refs.departmentId]);
    if (!found) throw new HttpError(400, "El departamento seleccionado no existe.");
  }
  if (refs.workCenterId) {
    const found = db.get("SELECT id FROM work_centers WHERE id = ?", [refs.workCenterId]);
    if (!found) throw new HttpError(400, "El centro de trabajo seleccionado no existe.");
  }
  if (refs.managerId) {
    if (refs.managerId === selfId) throw new HttpError(400, "Nadie puede ser responsable de sí mismo.");
    const found = db.get("SELECT id FROM employees WHERE id = ?", [refs.managerId]);
    if (!found) throw new HttpError(400, "El responsable seleccionado no existe.");
  }
}

export function employeesRouter(db: Database): Router {
  const router = Router();

  // Directorio: cada usuario ve solo los empleados de su ámbito y a sí mismo.
  router.get(
    "/",
    route((req, res) => {
      const actor = actorOf(res);
      const scope = employeeVisibility(actor, "e");
      const clauses = [`(${scope.sql})`];
      const params: string[] = [...scope.params];

      const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
      if (q) {
        const like = `%${escapeLike(q)}%`;
        clauses.push(
          `(e.first_name || ' ' || e.last_name LIKE ? ESCAPE '\\' OR e.employee_code LIKE ? ESCAPE '\\' OR e.job_title LIKE ? ESCAPE '\\')`,
        );
        params.push(like, like, like);
      }
      const departmentId = typeof req.query.departmentId === "string" ? req.query.departmentId : "";
      if (departmentId) {
        clauses.push("e.department_id = ?");
        params.push(departmentId);
      }
      const status = typeof req.query.status === "string" ? req.query.status : "";
      if (status) {
        if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(status)) {
          throw new HttpError(400, "Estado de empleado no válido.");
        }
        clauses.push("e.employment_status = ?");
        params.push(status);
      }

      const rows = db.all<EmployeeRow>(
        `${EMPLOYEE_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY e.last_name, e.first_name LIMIT 500`,
        params,
      );
      res.json({ items: rows.map(toEmployee) });
    }),
  );

  router.get(
    "/:id",
    route((req, res) => {
      const row = findVisibleEmployee(db, actorOf(res), req.params.id);
      if (!row) throw new HttpError(404, "Empleado no encontrado.");
      res.json(toEmployee(row));
    }),
  );

  router.post(
    "/",
    requirePermission("employees.write"),
    route((req, res) => {
      const actor = actorOf(res);
      const body = createSchema.parse(req.body);
      if (!canInDepartment(actor, "employees.write", body.departmentId)) {
        throw new HttpError(403, "No puedes registrar empleados en ese departamento.");
      }
      assertReferences(db, { departmentId: body.departmentId, workCenterId: body.workCenterId, managerId: body.managerId });
      if (db.get("SELECT id FROM employees WHERE employee_code = ?", [body.employeeCode])) {
        throw new HttpError(409, "Ya existe un empleado con ese código.");
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      db.transaction(() => {
        db.run(
          `INSERT INTO employees (id, employee_code, first_name, last_name, job_title, department_id, work_center_id,
                                  manager_id, corporate_email, phone, employment_status, hire_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            body.employeeCode,
            body.firstName,
            body.lastName,
            body.jobTitle,
            body.departmentId,
            body.workCenterId ?? null,
            body.managerId ?? null,
            body.corporateEmail ?? null,
            body.phone ?? null,
            body.employmentStatus,
            body.hireDate,
            now,
            now,
          ],
        );
        audit(db, actor.userId, "employee.created", "employee", id, {
          employeeCode: body.employeeCode,
          departmentId: body.departmentId,
        });
      });
      const created = findVisibleEmployee(db, actor, id);
      res.status(201).json(created ? toEmployee(created) : { id });
    }),
  );

  router.patch(
    "/:id",
    requirePermission("employees.write"),
    route((req, res) => {
      const actor = actorOf(res);
      const existing = findVisibleEmployee(db, actor, req.params.id);
      if (!existing) throw new HttpError(404, "Empleado no encontrado.");
      if (!canInDepartment(actor, "employees.write", existing.department_id)) {
        throw new HttpError(403, "No puedes modificar empleados de ese departamento.");
      }

      const body = updateSchema.parse(req.body);
      if (body.departmentId && !canInDepartment(actor, "employees.write", body.departmentId)) {
        throw new HttpError(403, "No puedes mover empleados a ese departamento.");
      }
      assertReferences(
        db,
        { departmentId: body.departmentId, workCenterId: body.workCenterId, managerId: body.managerId },
        existing.id,
      );

      const changedFields = (Object.keys(COLUMN_BY_FIELD) as Array<keyof typeof COLUMN_BY_FIELD>).filter(
        (field) => body[field] !== undefined,
      );
      if (changedFields.length === 0) throw new HttpError(400, "No hay cambios que guardar.");

      const assignments = changedFields.map((field) => `${COLUMN_BY_FIELD[field]} = ?`);
      const values = changedFields.map((field) => (body[field] ?? null) as string | null);
      db.transaction(() => {
        db.run(`UPDATE employees SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`, [
          ...values,
          new Date().toISOString(),
          existing.id,
        ]);
        audit(db, actor.userId, "employee.updated", "employee", existing.id, { fields: changedFields });
      });
      const updated = findVisibleEmployee(db, actor, existing.id);
      res.json(updated ? toEmployee(updated) : { id: existing.id });
    }),
  );

  return router;
}

export function findVisibleEmployee(db: Database, actor: Parameters<typeof employeeVisibility>[0], id: string) {
  const scope = employeeVisibility(actor, "e");
  return db.get<EmployeeRow>(`${EMPLOYEE_SELECT} WHERE (${scope.sql}) AND e.id = ?`, [...scope.params, id]);
}

// Catálogos de solo lectura usados por los formularios.
export function catalogsRouter(db: Database): Router {
  const router = Router();
  router.get(
    "/departments",
    route((_req, res) => {
      res.json({ items: db.all("SELECT id, name FROM departments ORDER BY name") });
    }),
  );
  router.get(
    "/work-centers",
    route((_req, res) => {
      res.json({ items: db.all("SELECT id, name, timezone FROM work_centers ORDER BY name") });
    }),
  );
  return router;
}
