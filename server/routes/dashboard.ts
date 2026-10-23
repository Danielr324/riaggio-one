import { Router } from "express";
import { actorOf } from "../auth.js";
import type { Database } from "../db.js";
import { route } from "../errors.js";
import { hasPermission } from "../permissions.js";
import { employeeVisibility, taskVisibility } from "../visibility.js";

const OPEN_STATUS_SQL = "t.status NOT IN ('completed', 'cancelled')";

// Indicadores calculados desde la base de datos y limitados al ámbito del usuario.
// Un indicador que el usuario no puede consultar se devuelve como null, no como 0.
export function dashboardRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/",
    route((_req, res) => {
      const actor = actorOf(res);
      const tasks = taskVisibility(actor, "t");
      const today = new Date().toISOString().slice(0, 10);

      const byStatus = db.all<{ status: string; total: number }>(
        `SELECT t.status, COUNT(*) AS total FROM tasks t WHERE (${tasks.sql}) GROUP BY t.status`,
        tasks.params,
      );
      const overdue = db.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM tasks t
          WHERE (${tasks.sql}) AND ${OPEN_STATUS_SQL} AND t.due_date IS NOT NULL AND t.due_date < ?`,
        [...tasks.params, today],
      );
      const mine = actor.employeeId
        ? db.get<{ total: number }>(
            `SELECT COUNT(*) AS total FROM tasks t WHERE t.assignee_id = ? AND ${OPEN_STATUS_SQL}`,
            [actor.employeeId],
          )
        : { total: 0 };

      let visibleEmployees: number | null = null;
      if (hasPermission(actor, "employees.read")) {
        const scope = employeeVisibility(actor, "e");
        visibleEmployees =
          db.get<{ total: number }>(
            `SELECT COUNT(*) AS total FROM employees e WHERE (${scope.sql}) AND e.employment_status = 'active'`,
            scope.params,
          )?.total ?? 0;
      }

      const counts: Record<string, number> = {
        pending: 0,
        in_progress: 0,
        blocked: 0,
        completed: 0,
        cancelled: 0,
      };
      for (const row of byStatus) counts[row.status] = Number(row.total);

      res.json({
        tasksByStatus: counts,
        overdueTasks: Number(overdue?.total ?? 0),
        myOpenTasks: Number(mine?.total ?? 0),
        activeEmployees: visibleEmployees,
        today,
      });
    }),
  );

  return router;
}
