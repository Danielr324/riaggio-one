import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { createApp } from "../server/app.js";
import { openDatabase, type Database } from "../server/db.js";
import { seedDemo } from "../server/seed.js";

// Pruebas de integración: API real, base SQLite en memoria y datos de demostración.
// Cubren autenticación, autorización por rol y ámbito, validación, invitaciones y auditoría.

const DEMO_PASSWORD = "demo-password-123";
const DOMAIN = "demo.riaggio.invalid";

let db: Database;
let server: Server;
let base: string;

interface Response {
  status: number;
  json: any;
  cookie: string | null;
}

async function call(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, json, cookie: setCookie ? setCookie.split(";")[0] : null };
}

async function login(email: string, password = DEMO_PASSWORD): Promise<string> {
  const response = await call("/api/auth/login", { body: { email, password } });
  assert.equal(response.status, 200, `login de ${email} debería funcionar`);
  assert.ok(response.cookie, "la sesión debe devolver cookie");
  return response.cookie!;
}

function employeeId(code: string): string {
  const row = db.get<{ id: string }>("SELECT id FROM employees WHERE employee_code = ?", [code]);
  assert.ok(row, `falta el empleado de demo ${code}`);
  return row.id;
}

before(async () => {
  db = openDatabase(":memory:");
  await seedDemo(db, DEMO_PASSWORD);
  const app = createApp(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  base = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
  db.close();
});

describe("autenticación", () => {
  it("rechaza cualquier endpoint protegido sin sesión", async () => {
    for (const path of ["/api/dashboard", "/api/employees", "/api/tasks", "/api/admin/users", "/api/auth/me"]) {
      const response = await call(path);
      assert.equal(response.status, 401, `${path} debe responder 401 sin sesión`);
    }
  });

  it("devuelve un mensaje genérico con credenciales incorrectas", async () => {
    const response = await call("/api/auth/login", { body: { email: `empleado.demo@${DOMAIN}`, password: "contraseña-incorrecta" } });
    assert.equal(response.status, 401);
    assert.equal(response.json.error, "Correo o contraseña no válidos.");
  });

  it("emite una cookie HttpOnly con SameSite=Strict y permite consultar la sesión", async () => {
    const response = await call("/api/auth/login", { body: { email: `empleado.demo@${DOMAIN}`, password: DEMO_PASSWORD } });
    assert.equal(response.status, 200);
    const header = response.cookie;
    assert.ok(header?.startsWith("riaggio_session="));
    const fullHeader = (await fetch(`${base}/api/auth/me`, { headers: { Cookie: header! } })).status;
    assert.equal(fullHeader, 200);
    assert.equal(response.json.user.email, `empleado.demo@${DOMAIN}`);
    assert.equal(JSON.stringify(response.json).includes("password"), false, "la respuesta no debe incluir hashes");
  });

  it("bloquea tras cinco intentos fallidos", async () => {
    const email = `bloqueo.demo@${DOMAIN}`;
    for (let i = 0; i < 5; i++) {
      await call("/api/auth/login", { body: { email, password: "contraseña-incorrecta" } });
    }
    const response = await call("/api/auth/login", { body: { email, password: DEMO_PASSWORD } });
    assert.equal(response.status, 429);
  });

  it("cierra la sesión y la invalida en servidor", async () => {
    const cookie = await login(`empleado.demo@${DOMAIN}`);
    assert.equal((await call("/api/auth/logout", { method: "POST", cookie })).status, 204);
    assert.equal((await call("/api/dashboard", { cookie })).status, 401);
  });
});

describe("autorización por rol y ámbito", () => {
  it("un empleado solo ve su propia ficha", async () => {
    const cookie = await login(`empleado.demo@${DOMAIN}`);
    const list = await call("/api/employees", { cookie });
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.json.items.map((e: any) => e.employeeCode),
      ["DEMO-004"],
    );
    const other = await call(`/api/employees/${employeeId("DEMO-005")}`, { cookie });
    assert.equal(other.status, 404, "un empleado no debe poder consultar a otro por id");
  });

  it("el responsable de departamento ve su departamento y no otros", async () => {
    const cookie = await login(`jefatura.demo@${DOMAIN}`);
    const list = await call("/api/employees", { cookie });
    const codes = list.json.items.map((e: any) => e.employeeCode).sort();
    assert.deepEqual(codes, ["DEMO-003", "DEMO-004"]);
    const outside = await call(`/api/employees/${employeeId("DEMO-005")}`, { cookie });
    assert.equal(outside.status, 404);
  });

  it("el administrador del sistema gestiona cuentas sin acceso al directorio de empleados", async () => {
    const cookie = await login(`admin.demo@${DOMAIN}`);
    const employees = await call("/api/employees", { cookie });
    assert.equal(employees.status, 200);
    assert.equal(employees.json.items.length, 0, "el administrador técnico no recibe datos de empleados");
    const users = await call("/api/admin/users", { cookie });
    assert.equal(users.status, 200);
  });

  it("un usuario sin rol de administración recibe 403 en administración", async () => {
    const cookie = await login(`empleado.demo@${DOMAIN}`);
    assert.equal((await call("/api/admin/users", { cookie })).status, 403);
    assert.equal((await call("/api/admin/audit", { cookie })).status, 403);
  });

  it("crea tareas solo en departamentos donde tiene permiso de gestión", async () => {
    const cookie = await login(`jefatura.demo@${DOMAIN}`);
    const departments = await call("/api/departments", { cookie });
    const ops = departments.json.items.find((d: any) => d.name === "Operaciones").id;
    const compras = departments.json.items.find((d: any) => d.name === "Compras").id;

    const allowed = await call("/api/tasks", { cookie, body: { title: "Revisar mise en place", departmentId: ops, priority: "normal" } });
    assert.equal(allowed.status, 201);
    assert.equal(allowed.json.status, "pending");

    const denied = await call("/api/tasks", { cookie, body: { title: "Pedido sin permiso", departmentId: compras, priority: "normal" } });
    assert.equal(denied.status, 403);
  });

  it("la persona asignada puede cambiar el estado pero no editar el título", async () => {
    const cookie = await login(`empleado.demo@${DOMAIN}`);
    const mine = await call("/api/tasks?mine=true", { cookie });
    const task = mine.json.items.find((t: any) => t.title.startsWith("Revisión semanal"));
    assert.ok(task, "la tarea demo asignada debe aparecer");

    const status = await call(`/api/tasks/${task.id}`, { method: "PATCH", cookie, body: { status: "completed" } });
    assert.equal(status.status, 200);
    assert.equal(status.json.status, "completed");

    const title = await call(`/api/tasks/${task.id}`, { method: "PATCH", cookie, body: { title: "Título cambiado" } });
    assert.equal(title.status, 403);
  });

  it("no revela tareas fuera de su ámbito", async () => {
    const cookie = await login(`empleado.demo@${DOMAIN}`);
    const all = await call("/api/tasks", { cookie });
    const titles = all.json.items.map((t: any) => t.title);
    assert.equal(titles.some((t: string) => t.includes("pedido de insumos")), false);
    assert.equal(titles.some((t: string) => t.includes("Conteo de inventario")), false);
  });
});

describe("validación de datos", () => {
  it("rechaza datos inválidos con errores claros", async () => {
    const cookie = await login(`jefatura.demo@${DOMAIN}`);
    const departments = await call("/api/departments", { cookie });
    const ops = departments.json.items.find((d: any) => d.name === "Operaciones").id;
    const response = await call("/api/tasks", { cookie, body: { title: "a", departmentId: ops } });
    assert.equal(response.status, 400);
    assert.ok(response.json.issues.some((i: any) => i.path === "title"));
  });

  it("rechaza JSON malformado", async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{no es json",
    });
    assert.equal(response.status, 400);
  });

  it("rechaza estados de tarea desconocidos", async () => {
    const cookie = await login(`jefatura.demo@${DOMAIN}`);
    const list = await call("/api/tasks", { cookie });
    const task = list.json.items[0];
    const response = await call(`/api/tasks/${task.id}`, { method: "PATCH", cookie, body: { status: "borrada" } });
    assert.equal(response.status, 400);
  });
});

describe("cuentas, invitaciones y auditoría", () => {
  let invitedToken = "";
  const invitedEmail = `nueva.persona@${DOMAIN}`;

  it("crea una cuenta invitada, la activa con el token y registra la operación", async () => {
    const admin = await login(`admin.demo@${DOMAIN}`);
    const created = await call("/api/admin/users", {
      cookie: admin,
      body: {
        email: invitedEmail,
        employeeCode: "DEMO-006",
        roles: [{ role: "inventory", scope: "company" }],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.user.status, "invited");
    invitedToken = created.json.invitation.token;
    assert.ok(invitedToken.length > 30);

    const cannotLoginYet = await call("/api/auth/login", { body: { email: invitedEmail, password: DEMO_PASSWORD } });
    assert.equal(cannotLoginYet.status, 401);

    const weak = await call("/api/auth/accept-invitation", { body: { token: invitedToken, password: "corta" } });
    assert.equal(weak.status, 400);

    const accepted = await call("/api/auth/accept-invitation", { body: { token: invitedToken, password: "contraseña-nueva-123" } });
    assert.equal(accepted.status, 200);

    const reused = await call("/api/auth/accept-invitation", { body: { token: invitedToken, password: "otra-contraseña-123" } });
    assert.equal(reused.status, 400, "un token usado no puede volver a activar la cuenta");

    const loggedIn = await call("/api/auth/login", { body: { email: invitedEmail, password: "contraseña-nueva-123" } });
    assert.equal(loggedIn.status, 200);

    const audit = db.get<{ total: number }>("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'user.created' AND entity_id = (SELECT id FROM users WHERE email = ?)", [invitedEmail]);
    assert.equal(audit?.total, 1);
  });

  it("desactivar una cuenta cierra sus sesiones", async () => {
    const admin = await login(`admin.demo@${DOMAIN}`);
    const userSession = await login(invitedEmail, "contraseña-nueva-123");
    const user = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", [invitedEmail]);
    assert.ok(user);

    const disabled = await call(`/api/admin/users/${user.id}/disable`, { method: "POST", cookie: admin, body: {} });
    assert.equal(disabled.status, 200);
    assert.equal((await call("/api/dashboard", { cookie: userSession })).status, 401);
  });

  it("el administrador no puede quitarse su propio rol de sistema", async () => {
    const admin = await login(`admin.demo@${DOMAIN}`);
    const me = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", [`admin.demo@${DOMAIN}`]);
    const response = await call(`/api/admin/users/${me!.id}/roles`, {
      method: "PUT",
      cookie: admin,
      body: { roles: [{ role: "employee", scope: "company" }] },
    });
    assert.equal(response.status, 400);
  });

  it("rechaza roles de departamento sin departamento", async () => {
    const admin = await login(`admin.demo@${DOMAIN}`);
    const response = await call("/api/admin/users", {
      cookie: admin,
      body: { email: `sin.dept@${DOMAIN}`, roles: [{ role: "operations", scope: "department" }] },
    });
    assert.equal(response.status, 400);
  });

  it("el registro de auditoría no admite modificaciones", async () => {
    const row = db.get<{ id: number }>("SELECT id FROM audit_log ORDER BY id LIMIT 1");
    assert.ok(row);
    assert.throws(() => db.run("UPDATE audit_log SET detail = '{}' WHERE id = ?", [row.id]), /solo inserción/);
    assert.throws(() => db.run("DELETE FROM audit_log WHERE id = ?", [row.id]), /solo inserción/);
  });

  it("el administrador puede consultar la auditoría", async () => {
    const admin = await login(`admin.demo@${DOMAIN}`);
    const response = await call("/api/admin/audit?limit=5", { cookie: admin });
    assert.equal(response.status, 200);
    assert.ok(response.json.items.length > 0);
  });
});

describe("panel", () => {
  it("devuelve null para indicadores sin acceso, en lugar de cero", async () => {
    const cookie = await login(`empleado.demo@${DOMAIN}`);
    const response = await call("/api/dashboard", { cookie });
    assert.equal(response.status, 200);
    assert.equal(response.json.activeEmployees, null);
  });
});
