import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { requireAuth } from "./auth.js";
import type { Database } from "./db.js";
import { HttpError } from "./errors.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { catalogsRouter, employeesRouter } from "./routes/employees.js";
import { tasksRouter } from "./routes/tasks.js";

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
}

// Construye la aplicación Express. No abre puertos: eso lo hace index.ts.
export function createApp(db: Database): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "64kb" }));

  // Rutas públicas de autenticación. El resto de /api exige sesión.
  app.use("/api/auth", authRouter(db));
  app.use("/api", requireAuth(db));
  app.use("/api/dashboard", dashboardRouter(db));
  app.use("/api/employees", employeesRouter(db));
  app.use("/api/tasks", tasksRouter(db));
  app.use("/api/admin", adminRouter(db));
  app.use("/api", catalogsRouter(db));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Recurso no encontrado." });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Revisa los datos del formulario.",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "El cuerpo de la petición no es JSON válido." });
      return;
    }
    // No se registra el cuerpo de la petición ni datos personales: solo el tipo de error.
    console.error("[error]", error instanceof Error ? error.name : "Unknown", error instanceof Error ? error.stack?.split("\n")[1]?.trim() : "");
    res.status(500).json({ error: "Ha ocurrido un error interno. Inténtalo de nuevo." });
  });

  return app;
}
