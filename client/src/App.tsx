import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EmptyState, Loading } from "./components/ui";
import { useSession } from "./lib/session";
import { Activate } from "./pages/Activate";
import { Admin } from "./pages/Admin";
import { Dashboard } from "./pages/Dashboard";
import { Directory } from "./pages/Directory";
import { Login } from "./pages/Login";
import { Tasks } from "./pages/Tasks";

function RequireSession({ children }: { children: JSX.Element }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) {
    return (
      <div className="auth">
        <div style={{ width: "min(420px, 100%)" }}>
          <Loading label="Comprobando tu sesión…" rows={2} />
        </div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function App() {
  const { session } = useSession();
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/activar" element={<Activate />} />
      <Route
        element={
          <RequireSession>
            <Layout />
          </RequireSession>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="empleados" element={<Directory />} />
        <Route path="empleados/:employeeId" element={<Directory />} />
        <Route path="tareas" element={<Tasks />} />
        <Route path="administracion" element={<Admin />} />
      </Route>
      <Route
        path="*"
        element={
          <div className="auth">
            <div className="panel" style={{ width: "min(480px, 100%)" }}>
              <EmptyState title="Página no encontrada">
                <p>La dirección no existe. Vuelve al inicio desde el menú.</p>
              </EmptyState>
            </div>
          </div>
        }
      />
    </Routes>
  );
}
