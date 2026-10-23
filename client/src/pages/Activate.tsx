import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { Field, Notice } from "../components/ui";

const MIN_PASSWORD_LENGTH = 12;

// El token va en el fragmento de la URL (#token), así no llega a los registros del servidor.
export function Activate() {
  const location = useLocation();
  const token = location.hash.slice(1);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <div className="auth">
        <div className="panel">
          <h1>Activar cuenta</h1>
          <Notice kind="error">El enlace de activación no es válido. Pide uno nuevo a Administración.</Notice>
        </div>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const next: typeof errors = {};
    if (password.length < MIN_PASSWORD_LENGTH) next.password = `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    if (confirm !== password) next.confirm = "Las contraseñas no coinciden.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await api("/auth/accept-invitation", { body: { token, password } });
      setDone(true);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth">
      <div className="panel">
        <header className="auth-header">
          <span className="brand">Riaggio One</span>
          <p>Crea la contraseña de tu cuenta.</p>
        </header>
        {done ? (
          <div className="stack">
            <Notice kind="success">Tu cuenta está activa. Ya puedes iniciar sesión.</Notice>
            <Link className="button" to="/login">
              Ir a iniciar sesión
            </Link>
          </div>
        ) : (
          <form className="form" onSubmit={onSubmit} noValidate>
            {formError && <Notice kind="error">{formError}</Notice>}
            <Field id="password" label="Contraseña nueva" error={errors.password} hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`}>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : "password-hint"}
              />
            </Field>
            <Field id="confirm" label="Repite la contraseña" error={errors.confirm}>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={Boolean(errors.confirm)}
                aria-describedby={errors.confirm ? "confirm-error" : undefined}
              />
            </Field>
            <div className="actions">
              <button type="submit" className="button" disabled={submitting}>
                {submitting ? "Activando…" : "Activar cuenta"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
