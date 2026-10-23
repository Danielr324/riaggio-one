import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export type Row = Record<string, unknown>;
export type Params = Array<string | number | null>;

// Envoltorio mínimo sobre node:sqlite. Toda consulta usa parámetros; nunca se
// concatena entrada del usuario en el SQL.
export class Database {
  constructor(private readonly db: DatabaseSync) {}

  all<T = Row>(sql: string, params: Params = []): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined;
  }

  // Devuelve el número de filas afectadas.
  run(sql: string, params: Params = []): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  // Solo para migraciones: sentencias sin parámetros de origen externo.
  exec(sql: string): void {
    this.db.exec(sql);
  }

  // Ejecuta fn dentro de una transacción; revierte si lanza error.
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") raw.exec("PRAGMA journal_mode = WAL;");
  const database = new Database(raw);
  applyMigrations(database);
  return database;
}

function applyMigrations(database: Database): void {
  database.run(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(database.all<{ name: string }>("SELECT name FROM schema_migrations").map((r) => r.name));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    database.transaction(() => {
      database.exec(sql);
      database.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", [file, new Date().toISOString()]);
    });
  }
}
