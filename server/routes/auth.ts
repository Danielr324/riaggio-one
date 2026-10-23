import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import type { Database } from "../db.js";
import {
  actorOf,
  clearLoginFailures,
  createSession,
  clearSessionCookie,
  loadActor,
  loginAllowed,
  recordLoginFailure,
  requireAuth,
  SESSION_COOKIE,
  sessionCookie,
} from "../auth.js";
import { HttpError, route } from "../errors.js";
import { hasPermission, PERMISSIONS, visibleDepartments, type Actor, type Permission } from "../permissions.js";
import { hashPassword, hashToken, MIN_PASSWORD_LENGTH, verifyPassword } from "../security.js";

const loginSchema = z.object({
  email: z.string().trim().email("Correo no válido.").max(254),
  password: z.string().min(1, "Escribe tu contraseña.").max(1024),
});

const acceptSchema = z.object({
  token: z.string().min(20, "La invitación no es válida.").max(200),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    .max(256),
});

interface EmployeeSummaryRow {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string;
  department_id: string;
  department_name: string;
}

// Vista de sesión para la interfaz. No contiene datos sensibles ni hashes.
export function sessionView(db: Database, actor: Actor) {
  const employee = actor.employeeId
    ? db.get<EmployeeSummaryRow>(
        `SELECT e.id, e.first_name, e.last_name, e.job_title, e.department_id, d.name AS department_name
           FROM employees e JOIN departments d ON d.id = e.department_id
          WHERE e.id = ?`,
        [actor.employeeId],
      )
    : undefined;
  return {
    user: { id: actor.userId, email: actor.email },
    employee: employee
      ? {
          id: employee.id,
          fullName: `${employee.first_name} ${employee.last_name}`,
          jobTitle: employee.job_title,
          departmentId: employee.department_id,
          departmentName: employee.department_name,
        }
      : null,
    assignments: actor.assignments,
    permissions: PERMISSIONS.filter((p) => hasPermission(actor, p)),
    // Departamentos sobre los que aplica cada permiso: "all" o lista de ids.
    departmentScopes: Object.fromEntries(
      PERMISSIONS.filter((p) => hasPermission(actor, p)).map((p: Permission) => [p, visibleDepartments(actor, p)]),
    ),
  };
}

export function authRouter(db: Database): Router {
  const router = Router();

  // Mensaje genérico para no revelar si una cuenta existe o está desactivada.
  router.post(
    "/login",
    route(async (req, res) => {
      const body = loginSchema.parse(req.body);
      const email = body.email.toLowerCase();
      const limitKey = `${req.ip}|${email}`;
      if (!loginAllowed(limitKey)) {
        throw new HttpError(429, "Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.");
      }

      const user = db.get<{ id: string; password_hash: string | null; status: string }>(
        "SELECT id, password_hash, status FROM users WHERE email = ?",
        [email],
      );
      const passwordOk = await verifyPassword(body.password, user?.password_hash ?? null);
      if (!user || user.status !== "active" || !passwordOk) {
        recordLoginFailure(limitKey);
        audit(db, user?.id ?? null, "auth.login_failed", "user", user?.id ?? null);
        throw new HttpError(401, "Correo o contraseña no válidos.");
      }

      clearLoginFailures(limitKey);
      const token = createSession(db, user.id);
      audit(db, user.id, "auth.login", "user", user.id);
      res.setHeader("Set-Cookie", sessionCookie(token));
      res.json(sessionView(db, loadActor(db, user.id) as Actor));
    }),
  );

  router.post(
    "/logout",
    route((req, res) => {
      const cookie = req.headers.cookie?.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      if (cookie) {
        const token = cookie.slice(SESSION_COOKIE.length + 1);
        db.run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
      }
      res.setHeader("Set-Cookie", clearSessionCookie());
      res.status(204).end();
    }),
  );

  router.get(
    "/me",
    requireAuth(db),
    route((_req, res) => {
      res.json(sessionView(db, actorOf(res)));
    }),
  );

  // Activación de cuenta con el token entregado por un administrador.
  router.post(
    "/accept-invitation",
    route(async (req, res) => {
      const body = acceptSchema.parse(req.body);
      const invitation = db.get<{ user_id: string }>(
        `SELECT i.user_id FROM invitations i JOIN users u ON u.id = i.user_id
          WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ? AND u.status = 'invited'`,
        [hashToken(body.token), new Date().toISOString()],
      );
      if (!invitation) {
        throw new HttpError(400, "La invitación no es válida o ha caducado. Pide una nueva a Administración.");
      }

      const passwordHash = await hashPassword(body.password);
      const now = new Date().toISOString();
      db.transaction(() => {
        // La condición used_at IS NULL evita activar dos veces con el mismo token.
        const consumed = db.run(
          "UPDATE invitations SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
          [now, hashToken(body.token)],
        );
        if (consumed === 0) throw new HttpError(400, "La invitación ya fue utilizada.");
        db.run("UPDATE users SET password_hash = ?, status = 'active', updated_at = ? WHERE id = ?", [
          passwordHash,
          now,
          invitation.user_id,
        ]);
        audit(db, invitation.user_id, "user.activated", "user", invitation.user_id);
      });
      res.status(200).json({ ok: true });
    }),
  );

  return router;
}
