import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, EmptyState, ErrorState, Loading, PageHeader } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "../lib/labels";
import { useSession } from "../lib/session";
import type { DashboardData, Task } from "../lib/types";

export function Dashboard() {
  const { session } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api<DashboardData>("/dashboard"), api<{ items: Task[] }>("/tasks?mine=true")])
      .then(([dashboard, mine]) => {
        setData(dashboard);
        setTasks(mine.items.filter((t) => t.status !== "completed" && t.status !== "cancelled").slice(0, 5));
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data || !tasks) return <Loading label="Cargando tu panel…" rows={4} />;

  const counts = data.tasksByStatus;
  const metrics = [
    { label: "Tareas pendientes", value: counts.pending ?? 0 },
    { label: "En curso", value: counts.in_progress ?? 0 },
    { label: "Bloqueadas", value: counts.blocked ?? 0 },
    { label: "Vencidas", value: data.overdueTasks },
    { label: "Mis tareas abiertas", value: data.myOpenTasks },
  ];

  return (
    <>
      <PageHeader
        title={session?.employee ? `Hola, ${session.employee.fullName.split(" ")[0]}` : "Inicio"}
        description={`Resumen al ${formatDate(data.today)}. Solo incluye datos de tu ámbito.`}
      />

      <section aria-labelledby="metricas" className="grid-cards">
        <h2 id="metricas" className="visually-hidden">
          Indicadores
        </h2>
        {metrics.map((m) => (
          <div className="panel" key={m.label}>
            <div className="metric-value">{m.value}</div>
            <div className="metric-label">{m.label}</div>
          </div>
        ))}
        <div className="panel">
          {data.activeEmployees === null ? (
            <>
              <div className="metric-value" aria-label="Sin acceso">
                —
              </div>
              <div className="metric-label">Empleados activos (sin acceso a este dato)</div>
            </>
          ) : (
            <>
              <div className="metric-value">{data.activeEmployees}</div>
              <div className="metric-label">Empleados activos en tu ámbito</div>
            </>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="mis-tareas">
        <div className="page-header">
          <h2 id="mis-tareas">Mis tareas abiertas</h2>
          <Link to="/tareas">Ver todas las tareas</Link>
        </div>
        {tasks.length === 0 ? (
          <EmptyState title="No tienes tareas abiertas">
            <p>Cuando te asignen una tarea aparecerá aquí.</p>
          </EmptyState>
        ) : (
          <ul className="event-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link to="/tareas">{task.title}</Link>{" "}
                <Badge tone={task.priority === "urgent" ? "danger" : "neutral"}>{TASK_PRIORITY_LABELS[task.priority]}</Badge>{" "}
                <Badge tone={task.status === "blocked" ? "warning" : "info"}>{TASK_STATUS_LABELS[task.status]}</Badge>
                {task.dueDate && <span className="hint"> · vence {formatDate(task.dueDate)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
