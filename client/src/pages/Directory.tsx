import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, EmptyState, ErrorState, Field, Loading, Notice, PageHeader } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { EMPLOYMENT_LABELS, formatDate } from "../lib/labels";
import { useSession } from "../lib/session";
import type { Department, Employee, WorkCenter } from "../lib/types";

const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = {
  active: "success",
  on_leave: "warning",
  terminated: "danger",
};

interface EmployeeFormValues {
  employeeCode: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  departmentId: string;
  workCenterId: string;
  managerId: string;
  corporateEmail: string;
  phone: string;
  hireDate: string;
  employmentStatus: string;
}

function toFormValues(employee?: Employee): EmployeeFormValues {
  return {
    employeeCode: employee?.employeeCode ?? "",
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    jobTitle: employee?.jobTitle ?? "",
    departmentId: employee?.departmentId ?? "",
    workCenterId: employee?.workCenterId ?? "",
    managerId: employee?.managerId ?? "",
    corporateEmail: employee?.corporateEmail ?? "",
    phone: employee?.phone ?? "",
    hireDate: employee?.hireDate ?? "",
    employmentStatus: employee?.employmentStatus ?? "active",
  };
}

function EmployeeForm({
  employee,
  departmentOptions,
  workCenters,
  managers,
  onSaved,
  onCancel,
}: {
  employee?: Employee;
  departmentOptions: Department[];
  workCenters: WorkCenter[];
  managers: Employee[];
  onSaved: (saved: Employee) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(employee);
  const [values, setValues] = useState(() => toFormValues(employee));
  const [errors, setErrors] = useState<Partial<Record<keyof EmployeeFormValues, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof EmployeeFormValues>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function validate(): Partial<Record<keyof EmployeeFormValues, string>> {
    const next: Partial<Record<keyof EmployeeFormValues, string>> = {};
    if (!isEdit && !/^[A-Za-z0-9-]{3,20}$/.test(values.employeeCode)) {
      next.employeeCode = "Usa de 3 a 20 letras, números o guiones.";
    }
    if (!values.firstName.trim()) next.firstName = "Escribe el nombre.";
    if (!values.lastName.trim()) next.lastName = "Escribe los apellidos.";
    if (values.jobTitle.trim().length < 2) next.jobTitle = "Escribe el cargo.";
    if (!values.departmentId) next.departmentId = "Selecciona un departamento.";
    if (!isEdit && !/^\d{4}-\d{2}-\d{2}$/.test(values.hireDate)) next.hireDate = "Indica la fecha de alta.";
    if (values.corporateEmail && !/^\S+@\S+\.\S+$/.test(values.corporateEmail)) next.corporateEmail = "Correo no válido.";
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const next = validate();
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;

    const payload = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      jobTitle: values.jobTitle.trim(),
      departmentId: values.departmentId,
      workCenterId: values.workCenterId || null,
      managerId: values.managerId || null,
      corporateEmail: values.corporateEmail.trim() || null,
      phone: values.phone.trim() || null,
      employmentStatus: values.employmentStatus,
    };
    setSubmitting(true);
    try {
      const saved = isEdit
        ? await api<Employee>(`/employees/${employee!.id}`, { method: "PATCH", body: payload })
        : await api<Employee>("/employees", {
            body: { ...payload, employeeCode: values.employeeCode.trim(), hireDate: values.hireDate },
          });
      onSaved(saved);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate aria-label={isEdit ? "Editar empleado" : "Nuevo empleado"}>
      {formError && <Notice kind="error">{formError}</Notice>}
      <div className="form-row">
        <Field id="employeeCode" label="Código de empleado" error={errors.employeeCode} hint="Identificador interno, no editable.">
          <input
            id="employeeCode"
            value={values.employeeCode}
            onChange={(e) => set("employeeCode", e.target.value)}
            disabled={isEdit}
            aria-invalid={Boolean(errors.employeeCode)}
          />
        </Field>
        <Field id="firstName" label="Nombre" error={errors.firstName}>
          <input id="firstName" value={values.firstName} onChange={(e) => set("firstName", e.target.value)} aria-invalid={Boolean(errors.firstName)} />
        </Field>
        <Field id="lastName" label="Apellidos" error={errors.lastName}>
          <input id="lastName" value={values.lastName} onChange={(e) => set("lastName", e.target.value)} aria-invalid={Boolean(errors.lastName)} />
        </Field>
      </div>
      <div className="form-row">
        <Field id="jobTitle" label="Cargo" error={errors.jobTitle}>
          <input id="jobTitle" value={values.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} aria-invalid={Boolean(errors.jobTitle)} />
        </Field>
        <Field id="departmentId" label="Departamento" error={errors.departmentId}>
          <select id="departmentId" value={values.departmentId} onChange={(e) => set("departmentId", e.target.value)} aria-invalid={Boolean(errors.departmentId)}>
            <option value="">Selecciona…</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="managerId" label="Responsable directo">
          <select id="managerId" value={values.managerId} onChange={(e) => set("managerId", e.target.value)}>
            <option value="">Sin responsable</option>
            {managers
              .filter((m) => m.id !== employee?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="form-row">
        <Field id="workCenterId" label="Centro de trabajo">
          <select id="workCenterId" value={values.workCenterId} onChange={(e) => set("workCenterId", e.target.value)}>
            <option value="">Sin centro asignado</option>
            {workCenters.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="corporateEmail" label="Correo corporativo" error={errors.corporateEmail}>
          <input id="corporateEmail" type="email" value={values.corporateEmail} onChange={(e) => set("corporateEmail", e.target.value)} aria-invalid={Boolean(errors.corporateEmail)} />
        </Field>
        <Field id="phone" label="Teléfono">
          <input id="phone" type="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
      </div>
      <div className="form-row">
        <Field id="hireDate" label="Fecha de alta" error={errors.hireDate}>
          <input id="hireDate" type="date" value={values.hireDate} onChange={(e) => set("hireDate", e.target.value)} disabled={isEdit} aria-invalid={Boolean(errors.hireDate)} />
        </Field>
        <Field id="employmentStatus" label="Estado laboral">
          <select id="employmentStatus" value={values.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)}>
            {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Registrar empleado"}
        </button>
        <button type="button" className="button secondary" onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Directory() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const { departmentsFor } = useSession();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [detail, setDetail] = useState<Employee | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const writable = departmentsFor("employees.write");
  const canWrite = writable !== null;
  const writableDepartments = writable === "all" ? departments : departments.filter((d) => writable?.includes(d.id));
  const canEditDepartment = (departmentId: string) => writable === "all" || (Array.isArray(writable) && writable.includes(departmentId));

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    api<{ items: Department[] }>("/departments").then((r) => setDepartments(r.items)).catch(() => undefined);
    api<{ items: WorkCenter[] }>("/work-centers").then((r) => setWorkCenters(r.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (departmentFilter) params.set("departmentId", departmentFilter);
    if (statusFilter) params.set("status", statusFilter);
    setListError(null);
    api<{ items: Employee[] }>(`/employees?${params.toString()}`)
      .then((r) => setEmployees(r.items))
      .catch((err: unknown) => setListError(errorMessage(err)));
  }, [debouncedQuery, departmentFilter, statusFilter, reloadKey]);

  useEffect(() => {
    setEditing(false);
    setNotice(null);
    if (!employeeId) {
      setDetail(undefined);
      return;
    }
    setDetail(undefined);
    api<Employee>(`/employees/${employeeId}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [employeeId]);

  function handleSaved(saved: Employee) {
    setCreating(false);
    setEditing(false);
    setNotice(creating ? "Empleado registrado." : "Cambios guardados.");
    setReloadKey((k) => k + 1);
    if (!creating) setDetail(saved);
    else navigate(`/empleados/${saved.id}`);
  }

  return (
    <>
      <PageHeader
        title="Empleados"
        description="Directorio de tu ámbito. Los datos visibles dependen de tu rol y de tu departamento."
        actions={
          canWrite && !creating ? (
            <button type="button" className="button" onClick={() => { setCreating(true); navigate("/empleados"); }}>
              Nuevo empleado
            </button>
          ) : undefined
        }
      />

      {notice && <Notice kind="success">{notice}</Notice>}

      <div className="split">
        <section className="stack" aria-labelledby="listado">
          <h2 id="listado" className="visually-hidden">
            Listado de empleados
          </h2>
          {creating && canWrite && (
            <div className="panel">
              <h2>Nuevo empleado</h2>
              <EmployeeForm
                departmentOptions={writableDepartments}
                workCenters={workCenters}
                managers={employees ?? []}
                onSaved={handleSaved}
                onCancel={() => setCreating(false)}
              />
            </div>
          )}

          <div className="toolbar panel" role="search">
            <Field id="q" label="Buscar por nombre, código o cargo">
              <input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            <Field id="dept" label="Departamento">
              <select id="dept" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
                <option value="">Todos</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="status" label="Estado">
              <select id="status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {listError ? (
            <ErrorState message={listError} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : employees === null ? (
            <Loading label="Cargando empleados…" rows={5} />
          ) : employees.length === 0 ? (
            <EmptyState title="Sin resultados">
              <p>Ajusta los filtros o revisa tu ámbito de acceso.</p>
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="visually-hidden">Empleados visibles para tu cuenta</caption>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Cargo</th>
                    <th scope="col">Departamento</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr
                      key={e.id}
                      className="clickable"
                      aria-selected={e.id === employeeId}
                      onClick={() => navigate(`/empleados/${e.id}`)}
                    >
                      <td>
                        <Link to={`/empleados/${e.id}`} onClick={(ev) => ev.stopPropagation()}>
                          {e.fullName}
                        </Link>
                        <div className="hint">{e.employeeCode}</div>
                      </td>
                      <td>{e.jobTitle}</td>
                      <td>{e.departmentName}</td>
                      <td>
                        <Badge tone={STATUS_TONE[e.employmentStatus]}>{EMPLOYMENT_LABELS[e.employmentStatus]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel stack" aria-labelledby="ficha">
          {!employeeId ? (
            <EmptyState title="Selecciona un empleado">
              <p>Su ficha aparecerá aquí.</p>
            </EmptyState>
          ) : detail === undefined ? (
            <Loading label="Cargando ficha…" rows={4} />
          ) : detail === null ? (
            <EmptyState title="Empleado no encontrado">
              <p>No existe o está fuera de tu ámbito de acceso.</p>
            </EmptyState>
          ) : editing ? (
            <>
              <h2 id="ficha">Editar {detail.fullName}</h2>
              <EmployeeForm
                employee={detail}
                departmentOptions={writableDepartments.length ? writableDepartments : departments}
                workCenters={workCenters}
                managers={employees ?? []}
                onSaved={handleSaved}
                onCancel={() => setEditing(false)}
              />
            </>
          ) : (
            <>
              <h2 id="ficha">{detail.fullName}</h2>
              <p className="hint">{detail.jobTitle}</p>
              <dl className="definition">
                <dt>Código</dt>
                <dd className="mono">{detail.employeeCode}</dd>
                <dt>Departamento</dt>
                <dd>{detail.departmentName}</dd>
                <dt>Responsable</dt>
                <dd>{detail.managerName ?? "—"}</dd>
                <dt>Centro</dt>
                <dd>{detail.workCenterName ?? "—"}</dd>
                <dt>Estado</dt>
                <dd>
                  <Badge tone={STATUS_TONE[detail.employmentStatus]}>{EMPLOYMENT_LABELS[detail.employmentStatus]}</Badge>
                </dd>
                <dt>Alta</dt>
                <dd>{formatDate(detail.hireDate)}</dd>
                <dt>Correo</dt>
                <dd>{detail.corporateEmail ?? "—"}</dd>
                <dt>Teléfono</dt>
                <dd>{detail.phone ?? "—"}</dd>
              </dl>
              {canEditDepartment(detail.departmentId) ? (
                <button type="button" className="button secondary" onClick={() => setEditing(true)}>
                  Editar ficha
                </button>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
