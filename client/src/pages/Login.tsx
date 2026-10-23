import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { errorMessage } from "../lib/api";
import { useSession } from "../lib/session";

export function Login() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("Escribe tu correo y tu contraseña.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth">
      <div className="panel">
        <header className="auth-header">
          <span className="brand">Riaggio One</span>
          <p>Intranet de Grupo Riaggio. Inicia sesión con tu cuenta corporativa.</p>
        </header>
        <form className="form" onSubmit={onSubmit} noValidate>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error !== null && !email.trim()}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error !== null && !password}
              required
            />
          </div>
          <div className="actions">
            <button type="submit" className="button" disabled={submitting}>
              {submitting ? "Entrando…" : "Entrar"}
            </button>
          </div>
          <p className="hint">
            ¿No tienes acceso? Pide una invitación a Administración. La recuperación de contraseña aún no está disponible.
          </p>
        </form>
      </div>
    </div>
  );
}
