import { visibleDepartments, type Actor } from "./permissions.js";

// Fragmentos SQL de visibilidad. Se construyen siempre con parámetros enlazados;
// el filtro de ámbito se aplica en la consulta, nunca solo en la interfaz.
// El alias evita ambigüedad cuando la consulta une varias tablas con columnas "id".
export interface ScopeSql {
  sql: string;
  params: string[];
}

function inList(values: string[]): string {
  return values.map(() => "?").join(", ");
}

export function employeeVisibility(actor: Actor, alias: string): ScopeSql {
  const departments = visibleDepartments(actor, "employees.read");
  if (departments === "all") return { sql: "1 = 1", params: [] };

  const clauses: string[] = [];
  const params: string[] = [];
  if (departments.length > 0) {
    clauses.push(`${alias}.department_id IN (${inList(departments)})`);
    params.push(...departments);
  }
  if (actor.employeeId) {
    clauses.push(`${alias}.id = ?`);
    params.push(actor.employeeId);
  }
  return { sql: clauses.length > 0 ? clauses.join(" OR ") : "1 = 0", params };
}

// Tareas visibles: las de los departamentos con permiso, más las que el usuario
// creó o tiene asignadas.
export function taskVisibility(actor: Actor, alias: string): ScopeSql {
  const departments = visibleDepartments(actor, "tasks.read");
  if (departments === "all") return { sql: "1 = 1", params: [] };

  const clauses: string[] = [`${alias}.created_by_user_id = ?`];
  const params: string[] = [actor.userId];
  if (departments.length > 0) {
    clauses.push(`${alias}.department_id IN (${inList(departments)})`);
    params.push(...departments);
  }
  if (actor.employeeId) {
    clauses.push(`${alias}.assignee_id = ?`);
    params.push(actor.employeeId);
  }
  return { sql: clauses.join(" OR "), params };
}
