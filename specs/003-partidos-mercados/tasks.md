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
- [x] T011 Preparar credencial PostgreSQL de reportes con permisos de solo lectura y validar que
  no puede modificar tablas.
- [x] T012 Implementar endpoints Python protegidos y consultas acotadas para dashboard y actividad.
- [x] T013 Implementar CSV UTF-8 y PDF con los mismos filtros, encabezados, límites y zona horaria.
- [x] T014 Integrar dashboard y exportaciones en la web mediante proxy autenticado NestJS.
- [x] T015 Ejecutar pruebas dirigidas, lint, tipos, build y pruebas integradas disponibles; corregir
  regresiones relacionadas.
- [x] T016 Verificar catálogo, estado de spec, mensajes Conventional Commits y ausencia de secretos
  en cambios/staging.

## Validación y pendientes de entorno

- Pasan las 73 pruebas unitarias de API y las e2e de Spec 3: partidos (10), presupuesto (3),
  sincronización (7, incluida concurrencia de cuotas) y acceso a reportes (1). También pasan las 7
  pruebas Python, Ruff, lint, typecheck, build de API y build de producción web.
- La suite e2e API completa ejecutó 17 suites: 16 pasaron y falló una prueba ajena a Spec 3 en
  `admin.e2e-spec.ts` (esperaba 409 y recibió 403 al retirar simultáneamente el rol de dos
  administradores). No se modificó esa funcionalidad fuera de alcance.
- T011 se verificó en la base local: el rol `apuestas_reports` puede consultar y la prueba confirma
  que no puede modificar tablas.
- El límite aprobado por el equipo es de 100 solicitudes diarias. Se verificó el endpoint de cuotas
  de Pinnacle (ID 4), se importaron 817 partidos y quedaron 180 selecciones externas persistidas.
  La última lectura del contador local fue 11/100; después se observó 98 % de uso en el panel del
  proveedor. El entorno local vuelve a usar `API_FOOTBALL_DAILY_BUDGET=100` y la clave
  configurada en `.env` para reanudar la sincronización.
- Dashboard, CSV UTF-8 y PDF se comprobaron contra esos datos reales: las tres respuestas dieron
  HTTP 200 y las exportaciones tuvieron el formato esperado.
- Se levantaron web, API y reportes; sus comprobaciones de salud respondieron HTTP 200, la API
  devolvió partidos y las páginas pública, de operador y de reportes respondieron HTTP 200.
- Tras vaciar el presupuesto y reiniciar, web, API y reportes siguen respondiendo HTTP 200; el
  worker de API-Football queda desactivado por la protección fail-closed.
- El entorno e2e fuerza credenciales de proveedor vacías y una clave TOTP temporal de pruebas para
  no heredar secretos ni placeholders del `.env` local.
