import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { hashPassword } from "./security.js";

// DATOS DE DEMOSTRACIÓN FICTICIOS. Nunca son datos reales de Grupo Riaggio.
// Los correos usan el dominio reservado .invalid (RFC 2606) y los nombres son genéricos.

const DEMO_DEPARTMENTS = ["Dirección General", "Recursos Humanos", "Operaciones", "Compras", "Inventario"];
const DEMO_WORK_CENTERS = [
  { name: "Centro Demo Norte", timezone: "UTC" },
  { name: "Centro Demo Sur", timezone: "UTC" },
];

export interface DemoSeedResult {
  password: string;
  accounts: Array<{ email: string; roles: string }>;
}

export async function seedDemo(db: Database, demoPassword: string): Promise<DemoSeedResult> {
  const now = new Date().toISOString();
  const existing = db.get<{ total: number }>("SELECT COUNT(*) AS total FROM departments");
  if (Number(existing?.total ?? 0) > 0) {
    throw new Error("La base de datos ya tiene datos. El seed de demostración solo se ejecuta en una base vacía.");
  }

  const departmentIds = new Map<string, string>();
  for (const name of DEMO_DEPARTMENTS) {
    const id = randomUUID();
    departmentIds.set(name, id);
    db.run("INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)", [id, name, now]);
  }
  const centerIds: string[] = [];
  for (const center of DEMO_WORK_CENTERS) {
    const id = randomUUID();
    centerIds.push(id);
    db.run("INSERT INTO work_centers (id, name, timezone, created_at) VALUES (?, ?, ?, ?)", [id, center.name, center.timezone, now]);
  }

  const employees = [
    { code: "DEMO-001", first: "Ana", last: "Demo Dirección", title: "Directora General", dept: "Dirección General", manager: null },
    { code: "DEMO-002", first: "Bruno", last: "Demo RRHH", title: "Responsable de RR. HH.", dept: "Recursos Humanos", manager: "DEMO-001" },
    { code: "DEMO-003", first: "Carla", last: "Demo Operaciones", title: "Responsable de Operaciones", dept: "Operaciones", manager: "DEMO-001" },
    { code: "DEMO-004", first: "Diego", last: "Demo Operaciones", title: "Operario de sala", dept: "Operaciones", manager: "DEMO-003" },
    { code: "DEMO-005", first: "Elena", last: "Demo Compras", title: "Analista de compras", dept: "Compras", manager: "DEMO-001" },
    { code: "DEMO-006", first: "Fabio", last: "Demo Inventario", title: "Encargado de inventario", dept: "Inventario", manager: "DEMO-001" },
  ];
  const employeeIds = new Map<string, string>();
  for (const [index, e] of employees.entries()) {
    const id = randomUUID();
    employeeIds.set(e.code, id);
    db.run(
      `INSERT INTO employees (id, employee_code, first_name, last_name, job_title, department_id, work_center_id,
                              manager_id, corporate_email, phone, employment_status, hire_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '2024-01-15', ?, ?)`,
      [
        id,
        e.code,
        e.first,
        e.last,
        e.title,
        departmentIds.get(e.dept) ?? null,
        centerIds[index % centerIds.length],
        e.manager ? (employeeIds.get(e.manager) ?? null) : null,
        `${e.first.toLowerCase()}.demo@demo.riaggio.invalid`,
        null,
        now,
        now,
      ],
    );
  }

  const passwordHash = await hashPassword(demoPassword);
  const accounts: DemoSeedResult["accounts"] = [];
  const demoUsers: Array<{ email: string; employee: string | null; roles: Array<{ role: string; scope: "company" | "department"; dept?: string }> }> = [
    { email: "admin.demo@demo.riaggio.invalid", employee: null, roles: [{ role: "system_admin", scope: "company" }] },
    { email: "direccion.demo@demo.riaggio.invalid", employee: "DEMO-001", roles: [{ role: "direction", scope: "company" }] },
    { email: "rrhh.demo@demo.riaggio.invalid", employee: "DEMO-002", roles: [{ role: "hr", scope: "company" }] },
    { email: "jefatura.demo@demo.riaggio.invalid", employee: "DEMO-003", roles: [{ role: "department_manager", scope: "department", dept: "Operaciones" }, { role: "employee", scope: "company" }] },
    { email: "empleado.demo@demo.riaggio.invalid", employee: "DEMO-004", roles: [{ role: "employee", scope: "company" }] },
  ];
  for (const user of demoUsers) {
    const id = randomUUID();
    db.run(
      "INSERT INTO users (id, email, password_hash, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      [id, user.email, passwordHash, user.employee ? (employeeIds.get(user.employee) ?? null) : null, now, now],
    );
    for (const role of user.roles) {
      db.run("INSERT INTO user_roles (id, user_id, role, scope, department_id) VALUES (?, ?, ?, ?, ?)", [
        randomUUID(),
        id,
        role.role,
        role.scope,
        role.dept ? (departmentIds.get(role.dept) ?? null) : null,
      ]);
    }
    accounts.push({ email: user.email, roles: user.roles.map((r) => r.role).join(", ") });
  }

  const adminId = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", ["admin.demo@demo.riaggio.invalid"])?.id ?? "";
  const opsDept = departmentIds.get("Operaciones") ?? null;
  const tasks = [
    { title: "Revisión semanal de turnos (demo)", dept: "Operaciones", assignee: "DEMO-004", status: "in_progress", priority: "normal", due: "2099-01-31" },
    { title: "Pedido de insumos de cocina (demo)", dept: "Compras", assignee: "DEMO-005", status: "pending", priority: "high", due: "2099-02-15" },
    { title: "Conteo de inventario mensual (demo)", dept: "Inventario", assignee: "DEMO-006", status: "blocked", priority: "urgent", due: "2000-01-01" },
  ];
  for (const task of tasks) {
    const id = randomUUID();
    db.run(
      `INSERT INTO tasks (id, title, description, status, priority, department_id, assignee_id, created_by_user_id, due_date, created_at, updated_at)
       VALUES (?, ?, 'Tarea de demostración.', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.title,
        task.status,
        task.priority,
        departmentIds.get(task.dept) ?? opsDept,
        employeeIds.get(task.assignee) ?? null,
        adminId,
        task.due,
        now,
        now,
      ],
    );
    db.run("INSERT INTO task_events (id, task_id, actor_user_id, type, detail, created_at) VALUES (?, ?, ?, 'created', '{}', ?)", [
      randomUUID(),
      id,
      adminId,
      now,
    ]);
  }

  return { password: demoPassword, accounts };
}
