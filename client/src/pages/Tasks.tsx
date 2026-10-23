import { useEffect, useState, type FormEvent } from "react";
import { Badge, EmptyState, ErrorState, Field, Loading, Notice, PageHeader } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDate, formatDateTime, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "../lib/labels";
import { useSession } from "../lib/session";
import type { Department, Employee, Task } from "../lib/types";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  pending: "neutral",
  in_progress: "info",
  blocked: "warning",
  completed: "success",
  cancelled: "neutral",
};

const OPEN_STATUSES = ["pending", "in_progress", "blocked"];

const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descripción",
  status: "Estado",
  priority: "Prioridad",
  assigneeId: "Responsable",
  dueDate: "Fecha límite",
};

interface TaskChange {
  field: string;
  from: unknown;
  to: unknown;
}

function readChanges(detail: Record<string, unknown>): TaskChange[] {
  return Array.isArray(detail.changes) ? (detail.changes as TaskChange[]) : [];
}

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "status") return TASK_STATUS_LABELS[String(value)] ?? String(value);
  if (field === "priority") return TASK_PRIORITY_LABELS[String(value)] ?? String(value);
  if (field === "dueDate") return formatDate(String(value));
  return String(value);
}

function isOverdue(task: Task): boolean {
  return Boolean(task.dueDate && OPEN_STATUSES.includes(task.status) && task.dueDate < new Date().toISOString().slice(0, 10));
}

export function Tasks() {
  const { session, can, departmentsFor } = useSession();
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Task | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const writable = departmentsFor("tasks.write");
  const writableDepartments = writable === "all" ? departments : departments.filter((d) => Array.isArray(writable) && writable.includes(d.id));
  const canCreate = writableDepartments.length > 0;
  const canManage = (departmentId: string) => writable === "all" || (Array.isArray(writable) && writable.includes(departmentId));

  useEffect(() => {
    api<{ items: Department[] }>("/departments").then((r) => setDepartments(r.items)).catch(() => undefined);
    if (can("employees.read")) {
      api<{ items: Employee[] }>("/employees").then((r) => setEmployees(r.items)).catch(() => undefined);
    }
  }, [can]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (departmentFilter) params.set("departmentId", departmentFilter);
    if (mineOnly) params.set("mine", "true");
    setListError(null);
    api<{ items: Task[] }>(`/tasks?${params.toString()}`)
      .then((r) => setTasks(r.items))
      .catch((err: unknown) => setListError(errorMessage(err)));
  }, [statusFilter, departmentFilter, mineOnly, reloadKey]);

  useEffect(() => {
    setDetailError(null);
    setNotice(null);
    if (!selectedId) {
      setDetail(null);
      return;
    }
    api<Task>(`/tasks/${selectedId}`)
      .then(setDetail)
      .catch((err: unknown) => {
        setDetail(null);
        setDetailError(errorMessage(err));
      });
  }, [selectedId]);

  async function changeStatus(status: string) {
    if (!detail || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      await api<Task>(`/tasks/${detail.id}`, { method: "PATCH", body: { status } });
      // Se vuelve a leer para que el historial incluya el cambio recién guardado.
      setDetail(await api<Task>(`/tasks/${detail.id}`));
      setNotice("Estado actualizado.");
      setReloadKey((k) => k + 1);
    } catch (err) {
      setDetailError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const canEditDetail = detail !== null && (canManage(detail.departmentId) || (detail.assigneeId !== null && detail.assigneeId === session?.employee?.id));

  return (
    <>
      <PageHeader
        title="Tareas"
        description="Tareas que creaste, que tienes asignadas o de los departamentos en tu ámbito."
        actions={
          canCreate ? (
            <button type="button" className="button" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate}>
              {showCreate ? "Cerrar formulario" : "Nueva tarea"}
            </button>
          ) : undefined
        }
      />

      {notice && <Notice kind="success">{notice}</Notice>}
      {showCreate && canCreate && (
        <TaskCreateForm
          departments={writableDepartments}
          employees={employees}
          onCreated={(task) => {
            setShowCreate(false);
            setNotice(`Tarea «${task.title}» creada.`);
            setReloadKey((k) => k + 1);
            setSelectedId(task.id);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className="split">
        <section className="stack" aria-labelledby="lista-tareas">
          <h2 id="lista-tareas" className="visually-hidden">
            Listado de tareas
          </h2>
          <div className="toolbar panel" role="search">
            <Field id="status-filter" label="Estado">
              <select id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="dept-filter" label="Departamento">
              <select id="dept-filter" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
                <option value="">Todos</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            {session?.employee && (
              <label className="actions" style={{ minHeight: 42 }}>
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} style={{ width: "auto", minHeight: "auto" }} />
                Solo mis tareas
              </label>
            )}
          </div>

          {listError ? (
            <ErrorState message={listError} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : tasks === null ? (
            <Loading label="Cargando tareas…" rows={5} />
          ) : tasks.length === 0 ? (
            <EmptyState title="No hay tareas con estos filtros">
              <p>Cuando se creen tareas en tu ámbito aparecerán aquí.</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="visually-hidden">Tareas visibles para tu cuenta</caption>
                <thead>
                  <tr>
                    <th scope="col">Tarea</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Prioridad</th>
                    <th scope="col">Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id} className="clickable" aria-selected={task.id === selectedId} onClick={() => setSelectedId(task.id)}>
                      <td>
                        <button type="button" className="button secondary small" onClick={(e) => { e.stopPropagation(); setSelectedId(task.id); }}>
                          {task.title}
                        </button>
                        <div className="hint">
                          {task.departmentName}
                          {task.assigneeName ? ` · ${task.assigneeName}` : " · Sin asignar"}
                        </div>
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
                      </td>
                      <td>{TASK_PRIORITY_LABELS[task.priority]}</td>
                      <td>
                        {task.dueDate ? formatDate(task.dueDate) : "—"}
                        {isOverdue(task) && (
                          <div>
                            <Badge tone="danger">Vencida</Badge>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel stack" aria-labelledby="detalle-tarea">
          <h2 id="detalle-tarea">Detalle</h2>
          {detailError && <Notice kind="error">{detailError}</Notice>}
          {!selectedId ? (
            <EmptyState title="Selecciona una tarea">
              <p>Verás aquí su estado y su historial.</p>
            </EmptyState>
          ) : !detail ? (
            detailError ? null : <Loading label="Cargando tarea…" rows={3} />
          ) : (
            <>
              <h3>{detail.title}</h3>
              {detail.description && <p>{detail.description}</p>}
              <dl className="definition">
                <dt>Departamento</dt>
                <dd>{detail.departmentName}</dd>
                <dt>Responsable</dt>
                <dd>{detail.assigneeName ?? "Sin asignar"}</dd>
                <dt>Prioridad</dt>
                <dd>{TASK_PRIORITY_LABELS[detail.priority]}</dd>
                <dt>Vence</dt>
                <dd>{detail.dueDate ? formatDate(detail.dueDate) : "—"}</dd>
                <dt>Actualizada</dt>
                <dd>{formatDateTime(detail.updatedAt)}</dd>
              </dl>
              {canEditDetail ? (
                <Field id="task-status" label="Cambiar estado">
                  <select id="task-status" value={detail.status} disabled={saving} onChange={(e) => changeStatus(e.target.value)}>
                    {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <p className="hint">Solo puedes consultar esta tarea. Pide a un responsable del departamento que la actualice.</p>
              )}
              <h3>Historial</h3>
              {detail.events && detail.events.length > 0 ? (
                <ul className="event-list">
                  {detail.events.map((ev, i) => {
                    const changes = readChanges(ev.detail);
                    return (
                    <li key={`${ev.createdAt}-${i}`}>
                      <strong>{ev.type === "created" ? "Creada" : "Actualizada"}</strong> por {ev.actorEmail} ·{" "}
                      {formatDateTime(ev.createdAt)}
                      {changes.length > 0 && (
                        <ul>
                          {changes.map((c) => (
                            <li key={c.field}>
                              {FIELD_LABELS[c.field] ?? c.field}: {formatValue(c.field, c.from)} → {formatValue(c.field, c.to)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="hint">Sin movimientos registrados.</p>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function TaskCreateForm({
  departments,
  employees,
  onCreated,
  onCancel,
}: {
  departments: Department[];
  employees: Employee[];
  onCreated: (task: Task) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const next: Record<string, string> = {};
    if (title.trim().length < 3) next.title = "El título necesita al menos 3 caracteres.";
    if (!departmentId) next.departmentId = "Selecciona un departamento.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const task = await api<Task>("/tasks", {
        body: {
          title: title.trim(),
          description: description.trim(),
          departmentId,
          assigneeId: assigneeId || null,
          priority,
          dueDate: dueDate || null,
        },
      });
      onCreated(task);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel form" onSubmit={onSubmit} noValidate aria-labelledby="nueva-tarea">
      <h2 id="nueva-tarea">Nueva tarea</h2>
      {formError && <Notice kind="error">{formError}</Notice>}
      <div className="form-row">
        <Field id="task-title" label="Título" error={errors.title}>
          <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={Boolean(errors.title)} />
        </Field>
        <Field id="task-dept" label="Departamento" error={errors.departmentId}>
          <select id="task-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="task-assignee" label="Responsable">
          <select id="task-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Sin asignar</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field id="task-priority" label="Prioridad">
          <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="task-due" label="Fecha límite">
          <input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <Field id="task-desc" label="Descripción">
        <textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
      </Field>
      <div className="actions">
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Creando…" : "Crear tarea"}
        </button>
        <button type="button" className="button secondary" onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
