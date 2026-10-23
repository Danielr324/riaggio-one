import { randomBytes, randomUUID } from "node:crypto";
import { audit } from "./audit.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";
import { seedDemo } from "./seed.js";
import { hashToken, newToken } from "./security.js";

// Comandos de administración local. Se ejecutan en el servidor, nunca desde la web.
const [command, ...args] = process.argv.slice(2);
const db = openDatabase(config.databasePath);

async function seedDemoCommand(): Promise<void> {
  if (config.env === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("El seed de demostración está bloqueado en producción. Define ALLOW_DEMO_SEED=1 solo si es intencionado.");
  }
  const password = process.env.RIAGGIO_DEMO_PASSWORD ?? randomBytes(12).toString("base64url");
  if (password.length < 12) throw new Error("RIAGGIO_DEMO_PASSWORD debe tener al menos 12 caracteres.");
  const result = await seedDemo(db, password);
  console.log("Datos de DEMOSTRACIÓN creados (ficticios).");
  for (const account of result.accounts) console.log(`  ${account.email}  roles: ${account.roles}`);
  if (!process.env.RIAGGIO_DEMO_PASSWORD) console.log(`Contraseña generada para todas las cuentas demo: ${password}`);
}

// Crea la primera cuenta de administración con una invitación de un solo uso.
// Solo funciona si todavía no existe ningún administrador del sistema.
function bootstrapAdminCommand(): void {
  const email = args[0]?.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Uso: bootstrap-admin <correo>");
  const hasAdmin = db.get("SELECT 1 AS found FROM user_roles WHERE role = 'system_admin' AND scope = 'company'");
  if (hasAdmin) throw new Error("Ya existe un administrador del sistema. Gestiona las cuentas desde Administración.");
  if (db.get("SELECT id FROM users WHERE email = ?", [email])) throw new Error("Ya existe una cuenta con ese correo.");

  const token = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + config.invitationTtlHours * 3_600_000).toISOString();
  const userId = randomUUID();
  db.transaction(() => {
    const timestamp = new Date(now).toISOString();
    db.run("INSERT INTO users (id, email, password_hash, employee_id, status, created_at, updated_at) VALUES (?, ?, NULL, NULL, 'invited', ?, ?)", [
      userId,
      email,
      timestamp,
      timestamp,
    ]);
    db.run("INSERT INTO user_roles (id, user_id, role, scope, department_id) VALUES (?, ?, 'system_admin', 'company', NULL)", [randomUUID(), userId]);
    db.run("INSERT INTO invitations (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", [
      hashToken(token),
      userId,
      timestamp,
      expiresAt,
    ]);
    audit(db, null, "user.bootstrap_admin_created", "user", userId);
  });
  console.log(`Administrador creado para ${email}.`);
  console.log(`Activa la cuenta antes de ${expiresAt} en /activar#${token}`);
  console.log("Este enlace solo se muestra una vez.");
}

async function main(): Promise<void> {
  switch (command) {
    case "seed-demo":
      await seedDemoCommand();
      break;
    case "bootstrap-admin":
      bootstrapAdminCommand();
      break;
    default:
      console.log("Comandos: seed-demo | bootstrap-admin <correo>");
      process.exitCode = 1;
  }
  db.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  db.close();
  process.exit(1);
});
