import type { ReactNode } from "react";

export function Loading({ label = "Cargando…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="panel stack" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${70 + ((i * 13) % 30)}%` }} aria-hidden="true" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      <strong>No se pudo cargar la información</strong>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button secondary" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function AccessDenied() {
  return (
    <EmptyState title="Acceso denegado">
      <p>Tu cuenta no tiene permiso para ver esta sección. Si lo necesitas, pide acceso a Administración.</p>
    </EmptyState>
  );
}

export function Notice({ kind, children }: { kind: "success" | "error"; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={tone === "neutral" ? "badge" : `badge ${tone}`}>{children}</span>;
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
