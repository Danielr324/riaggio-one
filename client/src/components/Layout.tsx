import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";

// Módulos que aún no tienen implementación. Se muestran desactivados para que nadie
// los confunda con funciones operativas.
const PENDING_MODULES = [
  "Horarios y turnos",
  "Asistencia",
  "Ausencias y vacaciones",
  "Nómina",
  "Inventarios",
  "Compras y proveedores",
  "Documentos",
  "Comunicaciones",
  "Reportes",
];

export function Layout() {
  const { session, can, logout } = useSession();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#contenido">
        Ir al contenido
      </a>
      <aside className="sidebar" aria-label="Navegación principal">
        <NavLink to="/" className="brand" end>
          Riaggio One
        </NavLink>
        <nav className="nav" aria-label="Módulos">
          <NavLink to="/">Inicio</NavLink>
          {can("employees.read") && <NavLink to="/empleados">Empleados</NavLink>}
          {can("tasks.read") || session?.employee ? <NavLink to="/tareas">Tareas</NavLink> : null}
          {can("users.manage") && <NavLink to="/administracion">Administración</NavLink>}
        </nav>
        <div className="pending-section">
        <div className="nav-group-title" aria-hidden="true">
          Pendientes de implementar
        </div>
        <ul className="pending-list" aria-label="Módulos pendientes de implementar">
          {PENDING_MODULES.map((name) => (
            <li key={name}>
              <span className="pending" aria-disabled="true">
                {name} <span className="badge">Pendiente</span>
              </span>
            </li>
          ))}
        </ul>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <span>{session?.user.email}</span>
          <button type="button" className="button secondary small" onClick={handleLogout} disabled={signingOut}>
            {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </div>
        <main id="contenido" className="page" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
