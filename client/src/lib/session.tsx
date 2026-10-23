import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";

export type Permission =
  | "dashboard.read"
  | "employees.read"
  | "employees.write"
  | "tasks.read"
  | "tasks.write"
  | "users.manage"
  | "audit.read";

export interface Session {
  user: { id: string; email: string };
  employee: { id: string; fullName: string; jobTitle: string; departmentId: string; departmentName: string } | null;
  assignments: Array<{ role: string; scope: "company" | "department"; departmentId: string | null }>;
  permissions: Permission[];
  // "all" si el permiso aplica a toda la empresa; si no, los departamentos concretos.
  departmentScopes: Partial<Record<Permission, "all" | string[]>>;
}

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
  // Departamentos donde el usuario puede actuar con ese permiso, o null si no puede.
  departmentsFor: (permission: Permission) => "all" | string[] | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Session>("/auth/me")
      .then(setSession)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError && error.status === 401)) console.error(error);
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await api<Session>("/auth/login", { body: { email, password } });
    setSession(next);
  }, []);

  const logout = useCallback(async () => {
    await api<void>("/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const permissions = new Set(session?.permissions ?? []);
    return {
      session,
      loading,
      login,
      logout,
      can: (permission) => permissions.has(permission),
      departmentsFor: (permission) => session?.departmentScopes[permission] ?? null,
    };
  }, [session, loading, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession debe usarse dentro de SessionProvider.");
  return context;
}
