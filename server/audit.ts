import type { Database } from "./db.js";

// Registra una operación sensible. El detalle nunca debe contener contraseñas,
// tokens ni datos salariales en claro.
export function audit(
  db: Database,
  actorUserId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
): void {
  db.run(
    "INSERT INTO audit_log (actor_user_id, action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [actorUserId, action, entity, entityId, JSON.stringify(detail), new Date().toISOString()],
  );
}
