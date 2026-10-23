// Modelo de permisos de Riaggio One.
// Los permisos se conceden por rol y se limitan por ámbito:
//   - company:    aplica a todos los departamentos.
//   - department: aplica solo al departamento asignado.
// Además, cada empleado siempre puede ver su propio registro y sus tareas
// (regla "propio"), sin necesidad de un rol adicional.

export const ROLES = [
  "system_admin",
  "direction",
  "hr",
  "department_manager",
  "operations",
  "purchasing",
  "inventory",
  "employee",
] as const;
export type Role = (typeof ROLES)[number];

export const SCOPES = ["company", "department"] as const;
export type Scope = (typeof SCOPES)[number];

export const PERMISSIONS = [
  "dashboard.read",
  "employees.read",
  "employees.write",
  "tasks.read",
  "tasks.write",
  "users.manage",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Administrador del sistema: gestiona cuentas, pero NO recibe acceso a datos de
// empleados, nómina ni documentación personal. Esos accesos requieren roles explícitos.
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  system_admin: ["dashboard.read", "users.manage", "audit.read"],
  direction: ["dashboard.read", "employees.read", "tasks.read"],
  hr: ["dashboard.read", "employees.read", "employees.write"],
  department_manager: ["dashboard.read", "employees.read", "tasks.read", "tasks.write"],
  operations: ["dashboard.read", "tasks.read", "tasks.write"],
  purchasing: ["dashboard.read"],
  inventory: ["dashboard.read"],
  employee: ["dashboard.read"],
};

export interface Assignment {
  role: Role;
  scope: Scope;
  departmentId: string | null;
}

export interface Actor {
  userId: string;
  email: string;
  employeeId: string | null;
  assignments: Assignment[];
}

function grantingAssignments(actor: Actor, permission: Permission): Assignment[] {
  return actor.assignments.filter((a) => ROLE_PERMISSIONS[a.role].includes(permission));
}

// ¿Tiene el actor el permiso en algún ámbito? Úsese solo como puerta de entrada;
// cada objeto debe comprobarse con canInDepartment o con los filtros de visibilidad.
export function hasPermission(actor: Actor, permission: Permission): boolean {
  return grantingAssignments(actor, permission).length > 0;
}

export function canInDepartment(actor: Actor, permission: Permission, departmentId: string): boolean {
  return grantingAssignments(actor, permission).some(
    (a) => a.scope === "company" || a.departmentId === departmentId,
  );
}

export function hasCompanyScope(actor: Actor, permission: Permission): boolean {
  return grantingAssignments(actor, permission).some((a) => a.scope === "company");
}

// Departamentos visibles para un permiso: "all" o la lista concreta.
export function visibleDepartments(actor: Actor, permission: Permission): "all" | string[] {
  const grants = grantingAssignments(actor, permission);
  if (grants.some((a) => a.scope === "company")) return "all";
  return [...new Set(grants.map((a) => a.departmentId).filter((id): id is string => id !== null))];
}
