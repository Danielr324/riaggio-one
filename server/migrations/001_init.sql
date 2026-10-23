-- Riaggio One · esquema inicial
-- Convenciones: ids UUID en texto, fechas ISO 8601 en UTC, estados con CHECK.

CREATE TABLE departments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE work_centers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  timezone    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE employees (
  id                TEXT PRIMARY KEY,
  employee_code     TEXT NOT NULL UNIQUE,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  job_title         TEXT NOT NULL,
  department_id     TEXT NOT NULL REFERENCES departments(id),
  work_center_id    TEXT REFERENCES work_centers(id),
  manager_id        TEXT REFERENCES employees(id),
  corporate_email   TEXT,
  phone             TEXT,
  employment_status TEXT NOT NULL CHECK (employment_status IN ('active', 'on_leave', 'terminated')),
  hire_date         TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_employees_department ON employees(department_id);

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT,
  employee_id    TEXT UNIQUE REFERENCES employees(id),
  status         TEXT NOT NULL CHECK (status IN ('invited', 'active', 'disabled')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Asignaciones de rol con ámbito. Un usuario puede acumular varias.
CREATE TABLE user_roles (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN (
                   'system_admin', 'direction', 'hr', 'department_manager',
                   'operations', 'purchasing', 'inventory', 'employee')),
  scope          TEXT NOT NULL CHECK (scope IN ('company', 'department')),
  department_id TEXT REFERENCES departments(id),
  CHECK ((scope = 'company' AND department_id IS NULL)
      OR (scope = 'department' AND department_id IS NOT NULL)),
  UNIQUE (user_id, role, scope, department_id)
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invitations (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  description         TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority            TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  department_id       TEXT NOT NULL REFERENCES departments(id),
  assignee_id         TEXT REFERENCES employees(id),
  created_by_user_id  TEXT NOT NULL REFERENCES users(id),
  due_date            TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_tasks_department ON tasks(department_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);

CREATE TABLE task_events (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_id  TEXT NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

-- Registro append-only de operaciones sensibles. La aplicación no expone
-- rutas para modificarlo o borrarlo.
CREATE TABLE audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id  TEXT REFERENCES users(id),
  action         TEXT NOT NULL,
  entity         TEXT NOT NULL,
  entity_id      TEXT,
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es de solo inserción'); END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log es de solo inserción'); END;
