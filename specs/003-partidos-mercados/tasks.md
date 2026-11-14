# Tareas — Spec 3

- [x] T001 Confirmar contratos, alcance, estados, permisos, mercados, presupuesto y reportes en la
  especificación.
- [x] T002 Escribir pruebas unitarias de transiciones de partido y validación de marcador.
- [x] T003 Escribir pruebas API de autorización por rol, gestión manual, auditoría e historial de
  cuotas.
- [x] T004 Diseñar entidades e índices Prisma para competiciones, equipos, partidos, mercados,
  selecciones, cuotas y presupuesto diario.
- [x] T005 Implementar migración y módulo NestJS con cartelera/detalle, filtros y operaciones de
  operador.
- [x] T006 Escribir pruebas de reserva concurrente, presupuesto agotado, timeout, idempotencia,
  prioridad de cuotas manuales y respuestas del proveedor.
- [x] T007 Implementar cliente API-Football con timeout, validación de respuesta, errores
  explícitos y redacción de secretos.
- [x] T008 Implementar worker BullMQ persistente, frecuencia adaptativa y presupuesto UTC
  fail-closed.
- [x] T009 Crear cartelera y detalle de partidos accesibles, adaptables a móvil y con mercados.
- [x] T010 Crear interfaces de operador para competiciones, partidos, transiciones, mercados y
  cuotas manuales con confirmación/motivos.
- [ ] T011 Preparar credencial PostgreSQL de reportes con permisos de solo lectura y validar que
  no puede modificar tablas.
- [x] T012 Implementar endpoints Python protegidos y consultas acotadas para dashboard y actividad.
- [x] T013 Implementar CSV UTF-8 y PDF con los mismos filtros, encabezados, límites y zona horaria.
- [x] T014 Integrar dashboard y exportaciones en la web mediante proxy autenticado NestJS.
- [ ] T015 Ejecutar pruebas dirigidas, lint, tipos, build y pruebas integradas disponibles; corregir
  regresiones relacionadas.
- [x] T016 Verificar catálogo, estado de spec, mensajes Conventional Commits y ausencia de secretos
  en cambios/staging.

## Validación y pendientes de entorno

- Pasan las pruebas unitarias API, las e2e dirigidas de partidos, presupuesto, sincronización y
  acceso a reportes, las pruebas Python, lint, tipos y build de producción web.
- La ejecución conjunta de toda la suite e2e API terminó con un cierre nativo de Node en Windows
  (código `-1073740791`) después de dos suites; las suites relacionadas con spec 3 pasan por
  separado.
- T011 queda pendiente hasta ejecutar `read-only-role.sql` en el entorno acordado y definir
  `REPORTS_READONLY_TEST_URL`; se incluye una prueba que verifica el rechazo de escrituras cuando
  se proporciona esa credencial.
- API-Football no realizará llamadas reales hasta definir el presupuesto diario positivo y, para
  cuotas, el identificador de casa habilitado en el plan contratado.
