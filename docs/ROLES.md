# Roles, permisos y ámbitos

Fuente de verdad en código: `server/permissions.ts`. Las consultas de datos aplican el mismo
criterio en SQL (`server/visibility.ts`); la interfaz solo oculta acciones, nunca decide el acceso.

## Principios

- **Denegado por defecto.** Sin sesión válida, todo `/api` responde 401.
- **Permiso + ámbito.** Un rol concede permisos y cada asignación tiene un ámbito:
  `company` (toda la empresa) o `department` (un departamento concreto).
- **Regla «propio».** Cualquier empleado vinculado a una cuenta ve su ficha y las tareas que creó
  o tiene asignadas, sin necesidad de un rol adicional.
- **Acumulación.** Una persona puede tener varios roles; sus permisos se suman.
- **Administración técnica separada.** El administrador del sistema gestiona cuentas y auditoría,
  pero no recibe acceso al directorio de empleados ni a datos personales o de nómina.

## Matriz de permisos por rol

| Rol | Panel | Empleados (leer) | Empleados (escribir) | Tareas (leer) | Tareas (escribir) | Cuentas | Auditoría |
|---|---|---|---|---|---|---|---|
| Administrador del sistema | ✔ | — | — | — | — | ✔ (empresa) | ✔ (empresa) |
| Dirección | ✔ | ✔ | — | ✔ | — | — | — |
| Recursos Humanos | ✔ | ✔ | ✔ | — | — | — | — |
| Responsable de departamento | ✔ | ✔ en su departamento | — | ✔ | ✔ en su departamento | — | — |
| Operaciones | ✔ | — | — | ✔ | ✔ | — | — |
| Compras | ✔ | — | — | — | — | — | — |
| Inventario | ✔ | — | — | — | — | — | — |
| Empleado | ✔ | Solo su ficha | — | Solo las suyas | Cambiar estado de las asignadas | — | — |

Las altas y cambios de ficha son de Recursos Humanos. Si la dirección quiere que los responsables de
departamento también puedan editar fichas de su equipo, es una decisión de negocio pendiente de confirmar.

Compras e Inventario solo tienen acceso al panel: sus módulos aún no están implementados.

## Reglas de ámbito verificadas por pruebas

- Un empleado no puede consultar por identificador la ficha de otro (respuesta 404).
- Un responsable de departamento solo ve los empleados de su departamento y no puede crear tareas
  en otros departamentos (403).
- La persona asignada puede cambiar el estado de su tarea, pero no el título ni la asignación (403).
- Un administrador técnico recibe una lista de empleados vacía, sin error.
- Un indicador que el usuario no puede consultar se devuelve como `null`, no como cero.
- No es posible quitarse a uno mismo el rol de administrador del sistema.

## Alta de cuentas

No hay correo configurado. El administrador crea la invitación y comparte el enlace por un canal
seguro. El enlace se muestra una sola vez y caduca según `INVITATION_TTL_HOURS`.
La primera cuenta de administración se crea con `npm run bootstrap-admin -- <correo>` en el servidor.
