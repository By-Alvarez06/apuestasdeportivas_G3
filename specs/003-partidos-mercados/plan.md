# Plan de implementación — Spec 3

## Enfoque

Entregar verticalmente el dominio de partidos y mercados, la operación manual, la sincronización
con presupuesto estricto, la cartelera y los reportes. La especificación es la fuente de verdad
para permisos y comportamiento; la clave de API-Football no se usa en pruebas ni se registra.

## Constitution Check

- **Seguridad**: endpoints de gestión deniegan por defecto y limitan a `OPERATOR`/`ADMIN`;
  reportes también protegidos; secretos solo en backend/entorno; cada cambio sensible auditado.
- **Integridad**: cambios de cuota guardan historial; mercado suspendido/cerrado no se publica
  como apostable; no se implementan apuestas o saldos en esta spec.
- **Servidor autoritativo**: transiciones, permisos, cuotas y filtros se validan en NestJS/Python,
  nunca se confía en el cliente.
- **Pruebas primero**: pruebas de máquina de estados, autorización, presupuesto concurrente,
  idempotencia de proveedor, no sobrescritura manual, exportaciones y acceso de solo lectura.
- **Tiempo real confiable**: sincronización en cola persistente BullMQ/Redis; jobs repetibles
  idempotentes, prioridad a partidos vivos y detención por presupuesto.
- **Simplicidad**: se mantienen las tres aplicaciones existentes. El servicio de reportes no
  escribe en tablas de negocio.
- **Accesibilidad**: pantallas mobile-first, navegación por teclado, estados y errores anunciados.

## Arquitectura y persistencia

1. NestJS agrega el módulo de partidos; Prisma guarda competiciones, equipos, partidos, mercados,
   selecciones, fuente de cuota, historial y contador diario del proveedor.
2. Una reserva condicional atómica en PostgreSQL se ejecuta **antes** de cada petición
   API-Football. El presupuesto usa día UTC; una petición reservada no se devuelve tras timeout.
3. BullMQ agenda sincronizaciones persistentes en Redis. El planificador calcula el siguiente
   intervalo usando fixtures vivos y presupuesto restante; la configuración es explícita y
   se detiene si no hay presupuesto.
4. NestJS es dueño de la autorización y de la auditoría. El servicio FastAPI recibe solicitudes
   autenticadas desde el backend, usa credencial PostgreSQL de solo lectura y devuelve solo datos
   de reportes.
5. Next.js usa endpoints NestJS para cartelera, administración y proxy autenticado de reportes;
   el navegador no conoce la clave API-Football ni secretos entre servicios.

## Secuencia de commits

1. `docs(spec-3): define matches markets and reports scope` — especificación, plan, tareas y
   catálogo.
2. `feat(api): validate match state transitions` — reglas y pruebas unitarias de estados y
   marcador.
3. `feat(api): add match and market management` — modelos, migraciones, endpoints, auditoría y
   pruebas de integración.
4. `test(api): cover football budget and sync behavior` — pruebas de presupuesto, concurrencia,
   adaptabilidad e idempotencia con proveedor simulado.
5. `feat(api): sync fixtures with budgeted worker` — cliente y worker BullMQ con límites
   fail-closed.
6. `feat(web): show matches and market odds` — cartelera y detalle públicos y accesibles.
7. `feat(web): manage matches and markets as operator` — interfaz protegida de gestión manual.
8. `test(reports): verify filters exports and read-only access` — pruebas de filtros, permisos,
   CSV y PDF.
9. `feat(reports): add operational dashboard and exports` — consultas Python y dashboard de
   exportación, integrados mediante API autenticada.
10. `docs(spec-3): document setup and complete acceptance checklist` — configuración local,
    límites conocidos y catálogo terminado si todos los criterios pasan.

Los commits se crean solo después de validar la unidad que contienen. Un fallo de entorno (por
ejemplo, navegador Playwright ausente o plan externo sin acceso a cuotas) se informa y no se
presenta como una prueba aprobada.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Plan API-Football o límite diario desconocido | Presupuesto obligatorio y fail-closed; reportar configuración pendiente |
| Dos workers exceden el límite diario | Reserva atómica en base de datos y prueba concurrente |
| Respuesta del proveedor duplica/reescribe datos | Claves externas únicas, upsert idempotente, procedencia de precios |
| Operación manual concurrente con sincronización | Prioridad por fuente, transacciones y restricciones |
| Reportes exponen datos o permiten escritura | Autorización en API, DB reader de solo lectura y pruebas de denegación |
| Secretos agregados a Git por error | Solo `.env` ignorado/secret manager; verificar staged diff y commits |
