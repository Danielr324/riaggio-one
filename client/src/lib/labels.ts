export const ROLE_LABELS: Record<string, string> = {
  system_admin: "Administrador del sistema",
  direction: "Dirección",
  hr: "Recursos Humanos",
  department_manager: "Responsable de departamento",
  operations: "Operaciones",
  purchasing: "Compras",
  inventory: "Inventario",
  employee: "Empleado",
};

export const SCOPE_LABELS: Record<string, string> = {
  company: "Empresa",
  department: "Departamento",
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  blocked: "Bloqueada",
  completed: "Completada",
  cancelled: "Cancelada",
};

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const EMPLOYMENT_LABELS: Record<string, string> = {
  active: "Activo",
  on_leave: "De baja temporal",
  terminated: "Baja definitiva",
};

export const USER_STATUS_LABELS: Record<string, string> = {
  invited: "Pendiente de activar",
  active: "Activa",
  disabled: "Desactivada",
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function roleSummary(roles: Array<{ role: string; scope: string; departmentId: string | null }>, departments: Map<string, string>): string {
  if (roles.length === 0) return "Sin roles";
  return roles
    .map((r) => {
      const base = ROLE_LABELS[r.role] ?? r.role;
      if (r.scope === "company") return base;
      return `${base} (${departments.get(r.departmentId ?? "") ?? "departamento"})`;
    })
    .join(" · ");
}
