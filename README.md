# Riaggio One

Intranet corporativa de Grupo Riaggio. Aplicación Node.js + TypeScript con React, Express y SQLite.

## Estado

Implementado y verificado con pruebas de integración y de navegador:

- Acceso: inicio y cierre de sesión, sesiones en cookie `HttpOnly`, límite de intentos, activación de cuentas por invitación.
- Panel con indicadores calculados desde la base de datos y limitados al ámbito del usuario.
- Directorio de empleados con búsqueda, filtros, alta y edición (según permisos).
- Tareas: creación, asignación, estados, historial de cambios y filtros.
- Administración de cuentas, roles con ámbito y registro de auditoría de solo inserción.

Pendiente (aparece desactivado en el menú): horarios, asistencia, ausencias y vacaciones, nómina,
inventarios, compras, documentos, comunicaciones y reportes. Ver `docs/ROLES.md` para roles y permisos.

## Requisitos

- Node.js 22.13 o superior (usa el módulo integrado `node:sqlite`).

## Instalación y ejecución

```bash
npm install
cp .env.example .env          # ajusta valores; nunca subas .env
npm run seed:demo             # datos FICTICIOS de demostración (solo desarrollo)
npm run dev                   # http://127.0.0.1:5000
```

Primera cuenta de administración en un entorno real (sin datos de demostración):

```bash
npm run bootstrap-admin -- correo@empresa.example
```

Imprime un enlace de activación que solo se muestra una vez.

## Producción

```bash
npm run build
NODE_ENV=production DATABASE_PATH=/ruta/segura/riaggio.db npm start
```

Antes de producción: colocar la aplicación detrás de HTTPS en un proxy inverso. Si hay proxy, el
límite de intentos de inicio de sesión usa la IP que ve Express; configurar `trust proxy` antes de desplegar.

## Pruebas

```bash
npm run typecheck
npm test                      # 22 pruebas de integración de API con base en memoria
```

## Variables de entorno

Ver `.env.example`. Ningún valor de ejemplo es un secreto.

## Datos de demostración

Todos los datos de `npm run seed:demo` son ficticios, usan el dominio reservado `.invalid` y no deben
cargarse en producción. El seed se bloquea en `NODE_ENV=production` salvo `ALLOW_DEMO_SEED=1`.

## Limitaciones conocidas

- Sin servicio de correo: las invitaciones se comparten manualmente.
- Sin recuperación de contraseña ni cambio de contraseña en el perfil.
- La jerarquía de responsables no detecta ciclos.
- SQLite en un solo proceso; la capa de datos está aislada en `server/db.ts` para migrar a PostgreSQL.
