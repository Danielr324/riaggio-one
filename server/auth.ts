import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import type { Database } from "./db.js";
import { HttpError } from "./errors.js";
import { hasPermission, type Actor, type Permission, type Role, type Scope } from "./permissions.js";
import { hashToken, newToken } from "./security.js";

export const SESSION_COOKIE = "riaggio_session";

export function createSession(db: Database, userId: string): string {
  const token = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + config.sessionTtlHours * 3_600_000);
  db.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", [
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    expiresAt.toISOString(),
  ]);
  return token;
}

export function deleteSessionsForUser(db: Database, userId: string): void {
  db.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

function cookieAttributes(maxAgeSeconds: number): string {
  const secure = config.env === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${cookieAttributes(config.sessionTtlHours * 3600)}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

interface UserRow {
  id: string;
  email: string;
  employee_id: string | null;
  status: string;
}

interface AssignmentRow {
  role: string;
  scope: string;
  department_id: string | null;
}

// Carga el actor (usuario activo + roles) desde la base de datos en cada petición.
// Así, un cambio de roles o una desactivación surte efecto de inmediato.
export function loadActor(db: Database, userId: string): Actor | null {
  const user = db.get<UserRow>("SELECT id, email, employee_id, status FROM users WHERE id = ?", [userId]);
  if (!user || user.status !== "active") return null;
  const rows = db.all<AssignmentRow>("SELECT role, scope, department_id FROM user_roles WHERE user_id = ?", [userId]);
  return {
    userId: user.id,
    email: user.email,
    employeeId: user.employee_id,
    assignments: rows.map((r) => ({
      role: r.role as Role,
      scope: r.scope as Scope,
      departmentId: r.department_id,
    })),
  };
}

// Deniega por defecto: sin sesión válida la petición termina con 401.
export function requireAuth(db: Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      next(new HttpError(401, "Debes iniciar sesión."));
      return;
    }
    const session = db.get<{ user_id: string }>(
      "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
      [hashToken(token), new Date().toISOString()],
    );
    const actor = session ? loadActor(db, session.user_id) : null;
    if (!actor) {
      next(new HttpError(401, "Tu sesión ha caducado. Inicia sesión de nuevo."));
      return;
    }
    res.locals.actor = actor;
    next();
  };
}

export function actorOf(res: Response): Actor {
  return res.locals.actor as Actor;
}

// Puerta por permiso para una acción. Los datos concretos se filtran después
// con las reglas de ámbito de cada módulo.
export function requirePermission(permission: Permission) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (hasPermission(actorOf(res), permission)) {
      next();
      return;
    }
    next(new HttpError(403, "No tienes permiso para realizar esta acción."));
  };
}

// Limitador de intentos fallidos de inicio de sesión (en memoria, un proceso).
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; windowStart: number }>();

export function loginAllowed(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return true;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    failures.delete(key);
    return true;
  }
  return entry.count < MAX_FAILURES;
}

export function recordLoginFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    failures.set(key, { count: 1, windowStart: Date.now() });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}
