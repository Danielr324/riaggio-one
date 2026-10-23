import { resolve } from "node:path";

// Toda la configuración sensible llega por variables de entorno.
// Ver .env.example para la lista completa y valores de ejemplo sin secretos.
export const config = {
  env: process.env.NODE_ENV === "production" ? "production" : "development",
  port: Number.parseInt(process.env.PORT ?? "5000", 10),
  databasePath: resolve(process.env.DATABASE_PATH ?? "data/riaggio.db"),
  sessionTtlHours: Number.parseInt(process.env.SESSION_TTL_HOURS ?? "8", 10),
  invitationTtlHours: Number.parseInt(process.env.INVITATION_TTL_HOURS ?? "72", 10),
} as const;
