import { randomUUID } from "node:crypto";
import { Router } from "express";

import { z } from "zod";
import { actorOf, deleteSessionsForUser, requirePermission } from "../auth.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import type { Database } from "../db.js";
import { HttpError, route } from "../errors.js";
import { hasCompanyScope, ROLES, SCOPES, type Actor } from "../permissions.js";
import { hashToken, newToken } from "../security.js";

const roleAssignmentSchema = z
  .object({
    role: z.enum(ROLES, { errorMap: () => ({ message: "Rol no válido." }) }),
    scope: z.enum(SCOPES, { errorMap: () => ({ message: "Ámbito no válido." }) }),
    departmentId: z.string().min(1).max(64).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "department" && !value.departmentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["departmentId"], message: "Indica el departamento del rol." });
    }
    if (value.scope === "company" && value.departmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["departmentId"],
        message: "El ámbito de empresa no admite departamento.",
      });
    }
  });

const rolesSchema = z
  .array(roleAssignmentSchema)
  .min(1, "Asigna al menos un rol.")
  .max(20)
  .superRefine((items, ctx) => {
    const keys = items.map((i) => `${i.role}|${i.scope}|${i.departmentId ?? ""}`);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Hay roles repetidos." });
    }
  });

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Correo no válido.").max(254),
  employeeCode: z.string().trim().max(20).nullable().optional(),
  roles: rolesSchema,
});

const updateRolesSchema = z.object({ roles: rolesSchema });

interface UserRow {
  id: string;
  email: string;
  status: string;
  employee_id: string | null;
  employee_name: string | null;
  password_hash: string | null;
  created_at: string;
}

interface RoleRow {
  user_id: string;
  role: string;
  scope: string;
  department_id: string | null;
}

function requireCompanyUserAdmin(actor: Actor): void {
  if (!hasCompanyScope(actor, "users.manage")) {
    throw new HttpError(403, "Solo la administración del sistema puede gestionar cuentas.");
  }
}

function loadRoles(db: Database, userId: string): RoleRow[] {
  return db.all<RoleRow>("SELECT user_id, role, scope, department_id FROM user_roles WHERE user_id = ?", [userId]);
}

function replaceRoles(db: Database, userId: string, roles: z.infer<typeof rolesSchema>): void {
  db.run("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  for (const role of roles) {
    db.run("INSERT INTO user_roles (id, user_id, role, scope, department_id) VALUES (?, ?, ?, ?, ?)", [
      randomUUID(),
      userId,
      role.role,
      role.scope,
      role.scope === "department" ? (role.departmentId ?? null) : null,
    ]);
  }
}

function assertDepartments(db: Database, roles: z.infer<typeof rolesSchema>): void {
  for (const role of roles) {
    if (role.departmentId && !db.get("SELECT id FROM departments WHERE id = ?", [role.departmentId])) {
      throw new HttpError(400, "Un departamento indicado en los roles no existe.");
    }
  }
}

function userView(user: UserRow, roles: RoleRow[]) {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    employeeId: user.employee_id,
    employeeName: user.employee_name,
    createdAt: user.created_at,
    roles: roles.map((r) => ({ role: r.role, scope: r.scope, departmentId: r.department_id })),
  };
}

const USER_SELECT = `
  SELECT u.id, u.email, u.status, u.employee_id, u.password_hash, u.created_at,
         e.first_name || ' ' || e.last_name AS employee_name
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id`;

function findUser(db: Database, id: string): UserRow {
  const user = db.get<UserRow>(`${USER_SELECT} WHERE u.id = ?`, [id]);
  if (!user) throw new HttpError(404, "Usuario no encontrado.");
  return user;
}

function issueInvitation(db: Database, userId: string): { token: string; expiresAt: string } {
  const token = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + config.invitationTtlHours * 3_600_000).toISOString();
  // Invalida invitaciones anteriores no usadas para que solo cuente la última.
  db.run("DELETE FROM invitations WHERE user_id = ? AND used_at IS NULL", [userId]);
  db.run("INSERT INTO invitations (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", [
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    expiresAt,
  ]);
  return { token, expiresAt };
}

export function adminRouter(db: Database): Router {
  const router = Router();
  router.use(requirePermission("users.manage"));

  router.get(
    "/users",
    route((_req, res) => {
      requireCompanyUserAdmin(actorOf(res));
      const users = db.all<UserRow>(`${USER_SELECT} ORDER BY u.email`);
      const roles = db.all<RoleRow>("SELECT user_id, role, scope, department_id FROM user_roles");
      res.json({
        items: users.map((u) => userView(u, roles.filter((r) => r.user_id === u.id))),
      });
    }),
  );

  // Crea la cuenta en estado "invited" y devuelve el token de activación una sola vez.
  // No se envía correo: el entorno no tiene un servicio de correo configurado.
  router.post(
    "/users",
    route((req, res) => {
      const actor = actorOf(res);
      requireCompanyUserAdmin(actor);
      const body = createUserSchema.parse(req.body);
      assertDepartments(db, body.roles);

      if (db.get("SELECT id FROM users WHERE email = ?", [body.email])) {
        throw new HttpError(409, "Ya existe una cuenta con ese correo.");
      }
      // El administrador vincula por código; no necesita leer el directorio de empleados.
      let employeeId: string | null = null;
      if (body.employeeCode) {
        const employee = db.get<{ id: string }>("SELECT id FROM employees WHERE employee_code = ?", [body.employeeCode]);
        if (!employee) throw new HttpError(400, "No existe un empleado con ese código.");
        if (db.get("SELECT id FROM users WHERE employee_id = ?", [employee.id])) {
          throw new HttpError(409, "Ese empleado ya tiene una cuenta.");
        }
        employeeId = employee.id;
      }

      const userId = randomUUID();
      const now = new Date().toISOString();
      const invitation = db.transaction(() => {
        db.run(
          "INSERT INTO users (id, email, password_hash, employee_id, status, created_at, updated_at) VALUES (?, ?, NULL, ?, 'invited', ?, ?)",
          [userId, body.email, employeeId, now, now],
        );
        replaceRoles(db, userId, body.roles);
        const issued = issueInvitation(db, userId);
        audit(db, actor.userId, "user.created", "user", userId, {
          roles: body.roles.map((r) => `${r.role}@${r.scope}${r.departmentId ? `:${r.departmentId}` : ""}`),
        });
        return issued;
      });
      res.status(201).json({ user: userView(findUser(db, userId), loadRoles(db, userId)), invitation });
    }),
  );

  router.put(
    "/users/:id/roles",
    route((req, res) => {
      const actor = actorOf(res);
      requireCompanyUserAdmin(actor);
      const target = findUser(db, req.params.id);
      const body = updateRolesSchema.parse(req.body);
      assertDepartments(db, body.roles);

      const keepsAdmin = body.roles.some((r) => r.role === "system_admin" && r.scope === "company");
      if (target.id === actor.userId && !keepsAdmin) {
        throw new HttpError(400, "No puedes quitarte tu propio rol de administrador del sistema.");
      }

      const before = loadRoles(db, target.id).map((r) => `${r.role}@${r.scope}${r.department_id ? `:${r.department_id}` : ""}`);
      db.transaction(() => {
        replaceRoles(db, target.id, body.roles);
        audit(db, actor.userId, "user.roles_changed", "user", target.id, {
          before,
          after: body.roles.map((r) => `${r.role}@${r.scope}${r.departmentId ? `:${r.departmentId}` : ""}`),
        });
      });
      // Las sesiones existentes conservan la identidad, pero los permisos se leen
      // en cada petición, así que el cambio aplica de inmediato.
      res.json(userView(findUser(db, target.id), loadRoles(db, target.id)));
    }),
  );

  router.post(
    "/users/:id/disable",
    route((req, res) => {
      const actor = actorOf(res);
      requireCompanyUserAdmin(actor);
      const target = findUser(db, req.params.id);
      if (target.id === actor.userId) throw new HttpError(400, "No puedes desactivar tu propia cuenta.");
      db.transaction(() => {
        db.run("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?", [new Date().toISOString(), target.id]);
        deleteSessionsForUser(db, target.id);
        audit(db, actor.userId, "user.disabled", "user", target.id);
      });
      res.json(userView(findUser(db, target.id), loadRoles(db, target.id)));
    }),
  );

  router.post(
    "/users/:id/enable",
    route((req, res) => {
      const actor = actorOf(res);
      requireCompanyUserAdmin(actor);
      const target = findUser(db, req.params.id);
      if (target.status !== "disabled") throw new HttpError(400, "La cuenta no está desactivada.");
      const nextStatus = target.password_hash ? "active" : "invited";
      db.transaction(() => {
        db.run("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", [nextStatus, new Date().toISOString(), target.id]);
        audit(db, actor.userId, "user.enabled", "user", target.id, { status: nextStatus });
      });
      res.json(userView(findUser(db, target.id), loadRoles(db, target.id)));
    }),
  );

  router.post(
    "/users/:id/invitation",
    route((req, res) => {
      const actor = actorOf(res);
      requireCompanyUserAdmin(actor);
      const target = findUser(db, req.params.id);
      if (target.status !== "invited") throw new HttpError(400, "Solo se puede reenviar la invitación de cuentas pendientes.");
      const invitation = db.transaction(() => {
        const issued = issueInvitation(db, target.id);
        audit(db, actor.userId, "user.invitation_reissued", "user", target.id);
        return issued;
      });
      res.status(201).json({ invitation });
    }),
  );

  // Registro de auditoría: solo lectura, limitado a la administración del sistema.
  router.get(
    "/audit",
    route((req, res) => {
      const actor = actorOf(res);
      if (!hasCompanyScope(actor, "audit.read")) throw new HttpError(403, "No tienes acceso al registro de auditoría.");
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 500);
      const rows = db.all<{
        id: number;
        action: string;
        entity: string;
        entity_id: string | null;
        detail: string;
        created_at: string;
        actor_email: string | null;
      }>(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.email AS actor_email
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
          ORDER BY a.id DESC LIMIT ?`,
        [limit],
      );
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          action: r.action,
          entity: r.entity,
          entityId: r.entity_id,
          detail: JSON.parse(r.detail) as unknown,
          createdAt: r.created_at,
          actorEmail: r.actor_email,
        })),
      });
    }),
  );

  return router;
}
