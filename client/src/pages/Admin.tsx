import { useEffect, useState, type FormEvent } from "react";
import { AccessDenied, Badge, EmptyState, ErrorState, Field, Loading, Notice, PageHeader } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { formatDateTime, ROLE_LABELS, roleSummary, SCOPE_LABELS, USER_STATUS_LABELS } from "../lib/labels";
import { useSession } from "../lib/session";
import type { AuditItem, Department, Invitation, RoleAssignment, UserAccount } from "../lib/types";

interface RoleDraft {
  role: string;
  scope: "company" | "department";
  departmentId: string;
}

const EMPTY_ROLE: RoleDraft = { role: "employee", scope: "company", departmentId: "" };

function toDrafts(roles: RoleAssignment[]): RoleDraft[] {
  return roles.map((r) => ({ role: r.role, scope: r.scope, departmentId: r.departmentId ?? "" }));
}

function toPayload(drafts: RoleDraft[]) {
  return drafts.map((d) => ({
    role: d.role,
    scope: d.scope,
    departmentId: d.scope === "department" ? d.departmentId || null : null,
  }));
}

function RoleEditor({
  drafts,
  departments,
  onChange,
  idPrefix,
}: {
  drafts: RoleDraft[];
  departments: Department[];
  onChange: (next: RoleDraft[]) => void;
  idPrefix: string;
}) {
  function update(index: number, patch: Partial<RoleDraft>) {
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }
  return (
    <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
      <legend className="field-label" style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>
        Roles y ámbito
      </legend>
      {drafts.map((draft, index) => (
        <div className="role-row" key={index}>
          <Field id={`${idPrefix}-role-${index}`} label="Rol">
            <select id={`${idPrefix}-role-${index}`} value={draft.role} onChange={(e) => update(index, { role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${idPrefix}-scope-${index}`} label="Ámbito">
            <select
              id={`${idPrefix}-scope-${index}`}
              value={draft.scope}
              onChange={(e) => update(index, { scope: e.target.value as RoleDraft["scope"], departmentId: "" })}
            >
              {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${idPrefix}-dept-${index}`} label="Departamento">
            <select
              id={`${idPrefix}-dept-${index}`}
              value={draft.departmentId}
              disabled={draft.scope !== "department"}
              onChange={(e) => update(index, { departmentId: e.target.value })}
            >
              <option value="">{draft.scope === "department" ? "Selecciona…" : "No aplica"}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="button secondary small"
            onClick={() => onChange(drafts.filter((_, i) => i !== index))}
            disabled={drafts.length === 1}
          >
            Quitar
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="button secondary small" onClick={() => onChange([...drafts, { ...EMPTY_ROLE }])}>
          Añadir rol
        </button>
      </div>
    </fieldset>
  );
}

function InvitationNotice({ invitation, email }: { invitation: Invitation; email: string }) {
  const link = `${window.location.origin}/activar#${invitation.token}`;
  return (
    <Notice kind="success">
      <p style={{ margin: "0 0 var(--space-2)" }}>
        Invitación para <strong>{email}</strong>. Caduca el {formatDateTime(invitation.expiresAt)}. Compártela una sola vez por un canal
        seguro; no se envía por correo.
      </p>
      <label htmlFor="invite-link" className="field-label" style={{ fontWeight: 600 }}>
        Enlace de activación
      </label>
      <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="mono" />
    </Notice>
  );
}

export function Admin() {
  const { can } = useSession();
  if (!can("users.manage")) {
    return (
      <>
        <PageHeader title="Administración" />
        <AccessDenied />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Administración" description="Cuentas, roles y registro de auditoría." />
      <AdminTabs />
    </>
  );
}

function AdminTabs() {
  const [tab, setTab] = useState<"accounts" | "audit">("accounts");
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Secciones de administración">
        <button type="button" role="tab" id="tab-accounts" aria-selected={tab === "accounts"} aria-controls="panel-accounts" onClick={() => setTab("accounts")}>
          Cuentas
        </button>
        <button type="button" role="tab" id="tab-audit" aria-selected={tab === "audit"} aria-controls="panel-audit" onClick={() => setTab("audit")}>
          Auditoría
        </button>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="stack">
        {tab === "accounts" ? <Accounts /> : <AuditLog />}
      </div>
    </>
  );
}

function Accounts() {
  const [users, setUsers] = useState<UserAccount[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [invitation, setInvitation] = useState<{ invitation: Invitation; email: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDrafts, setEditDrafts] = useState<RoleDraft[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Department[] }>("/departments").then((r) => setDepartments(r.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setError(null);
    api<{ items: UserAccount[] }>("/admin/users")
      .then((r) => setUsers(r.items))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [reloadKey]);

  const deptNames = new Map(departments.map((d) => [d.id, d.name]));

  async function runAction(id: string, action: () => Promise<unknown>, success: string) {
    setBusyId(id);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: success });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {invitation && <InvitationNotice invitation={invitation.invitation} email={invitation.email} />}

      <CreateAccount
        departments={departments}
        onCreated={(user, issued) => {
          setInvitation({ invitation: issued, email: user.email });
          setNotice({ kind: "success", text: `Cuenta creada para ${user.email}.` });
          setReloadKey((k) => k + 1);
        }}
        onError={(text) => setNotice({ kind: "error", text })}
      />

      <section className="stack" aria-labelledby="cuentas">
        <h2 id="cuentas">Cuentas</h2>
        {error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : users === null ? (
          <Loading label="Cargando cuentas…" rows={4} />
        ) : users.length === 0 ? (
          <EmptyState title="No hay cuentas">
            <p>Crea la primera invitación con el formulario de arriba.</p>
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="visually-hidden">Cuentas de usuario</caption>
              <thead>
                <tr>
                  <th scope="col">Correo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Empleado</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>
                      <Badge tone={u.status === "active" ? "success" : u.status === "disabled" ? "danger" : "warning"}>
                        {USER_STATUS_LABELS[u.status]}
                      </Badge>
                    </td>
                    <td>{u.employeeName ?? "—"}</td>
                    <td>{roleSummary(u.roles, deptNames)}</td>
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          className="button secondary small"
                          disabled={busyId === u.id}
                          onClick={() => {
                            setEditingId(u.id);
                            setEditDrafts(toDrafts(u.roles).length ? toDrafts(u.roles) : [{ ...EMPTY_ROLE }]);
                          }}
                        >
                          Editar roles
                        </button>
                        {u.status === "invited" && (
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={busyId === u.id}
                            onClick={() =>
                              runAction(
                                u.id,
                                async () => {
                                  const issued = await api<{ invitation: Invitation }>(`/admin/users/${u.id}/invitation`, { body: {} });
                                  setInvitation({ invitation: issued.invitation, email: u.email });
                                },
                                "Nueva invitación generada.",
                              )
                            }
                          >
                            Nueva invitación
                          </button>
                        )}
                        {u.status === "disabled" ? (
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={busyId === u.id}
                            onClick={() => runAction(u.id, () => api(`/admin/users/${u.id}/enable`, { body: {} }), "Cuenta reactivada.")}
                          >
                            Reactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button danger small"
                            disabled={busyId === u.id}
                            onClick={() => {
                              if (window.confirm(`¿Desactivar la cuenta de ${u.email}? Se cerrarán sus sesiones.`)) {
                                runAction(u.id, () => api(`/admin/users/${u.id}/disable`, { body: {} }), "Cuenta desactivada.");
                              }
                            }}
                          >
                            Desactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingId && (
        <section className="panel form" aria-labelledby="editar-roles">
          <h2 id="editar-roles">Editar roles de {users?.find((u) => u.id === editingId)?.email}</h2>
          <RoleEditor drafts={editDrafts} departments={departments} onChange={setEditDrafts} idPrefix="edit" />
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={busyId === editingId}
              onClick={() => {
                const id = editingId;
                runAction(id, () => api(`/admin/users/${id}/roles`, { method: "PUT", body: { roles: toPayload(editDrafts) } }), "Roles actualizados.").then(() =>
                  setEditingId(null),
                );
              }}
            >
              Guardar roles
            </button>
            <button type="button" className="button secondary" onClick={() => setEditingId(null)}>
              Cancelar
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function CreateAccount({
  departments,
  onCreated,
  onError,
}: {
  departments: Department[];
  onCreated: (user: UserAccount, invitation: Invitation) => void;
  onError: (text: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [drafts, setDrafts] = useState<RoleDraft[]>([{ ...EMPTY_ROLE }]);
  const [errors, setErrors] = useState<{ email?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const next: { email?: string } = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Correo no válido.";
    setErrors(next);
    if (next.email) return;

    setSubmitting(true);
    try {
      const created = await api<{ user: UserAccount; invitation: Invitation }>("/admin/users", {
        body: {
          email: email.trim(),
          employeeCode: employeeCode.trim() || null,
          roles: toPayload(drafts),
        },
      });
      setEmail("");
      setEmployeeCode("");
      setDrafts([{ ...EMPTY_ROLE }]);
      onCreated(created.user, created.invitation);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel form" onSubmit={onSubmit} noValidate aria-labelledby="nueva-cuenta">
      <h2 id="nueva-cuenta">Invitar a una persona</h2>
      <div className="form-row">
        <Field id="new-email" label="Correo corporativo" error={errors.email}>
          <input id="new-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} />
        </Field>
        <Field id="new-employee" label="Código de empleado (opcional)" hint="Vincula la cuenta con su ficha de empleado.">
          <input id="new-employee" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
        </Field>
      </div>
      <RoleEditor drafts={drafts} departments={departments} onChange={setDrafts} idPrefix="new" />
      <div className="actions">
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Creando…" : "Crear invitación"}
        </button>
      </div>
    </form>
  );
}

function AuditLog() {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    api<{ items: AuditItem[] }>("/admin/audit?limit=100")
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [reloadKey]);

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (items === null) return <Loading label="Cargando auditoría…" rows={5} />;
  if (items.length === 0) return <EmptyState title="Sin registros todavía" />;

  return (
    <div className="table-wrap">
      <table>
        <caption className="visually-hidden">Últimas operaciones registradas</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Acción</th>
            <th scope="col">Actor</th>
            <th scope="col">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.createdAt)}</td>
              <td className="mono">{item.action}</td>
              <td>{item.actorEmail ?? "Sistema"}</td>
              <td className="mono">{JSON.stringify(item.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
