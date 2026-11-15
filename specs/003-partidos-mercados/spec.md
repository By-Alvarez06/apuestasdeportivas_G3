# Feature Specification: Partidos, mercados y reportes

**Feature Branch**: `feature/spec-3`
**Created**: 2026-11-14
**Status**: Terminada
**Input**: Catálogo `specs/README.md`, fase F3 de `PLAN.md` y decisiones confirmadas por el equipo.

## Alcance confirmado

- Cartelera y detalle de partidos con estados y mercados de fútbol.
- Mercados: resultado 1X2, doble oportunidad, total de goles (más/menos) y ambos equipos
  marcan.
- Sincronización de partidos y, cuando el plan del proveedor lo permita, cuotas de API-Football.
- Gestión manual por `OPERATOR` y `ADMIN`, con auditoría.
- Dashboard operacional de partidos, cuotas y actividad, con CSV y PDF para los mismos filtros.
- El equipo confirmó un límite de 100 solicitudes diarias para la configuración local. Sin un
  límite positivo explícito, la sincronización externa no realiza peticiones.
- En el entorno local se verificó acceso a cuotas de Pinnacle (bookmaker ID 4), configurado para
  la sincronización.

## Actores y permisos

| Acción | BETTOR (público) | OPERATOR | ADMIN |
|---|---:|---:|---:|
| Consultar partidos y mercados publicados | Sí | Sí | Sí |
| Crear y editar competiciones, partidos y mercados | No | Sí | Sí |
| Suspender/reabrir mercados y editar cuotas manuales | No | Sí | Sí |
| Aplicar transiciones no terminales permitidas al partido | No | Sí | Sí |
| Finalizar/cancelar o corregir/reabrir un partido terminal | No | No | Sí, con motivo |
| Consultar dashboard y exportar reportes | No | Sí | Sí |
| Cambiar presupuesto, clave o configuración del proveedor | No | No | Solo entorno/operación, nunca UI |

Cada acción de gestión registra actor, objetivo, cambio, fecha, IP y agente de usuario en el
`AuditLog` append-only existente. Una cuota manual y una cuota externa quedan identificadas por
fuente; no se presenta una cuota externa no disponible como si fuera manual ni se sustituye en
silencio una cuota manual con datos del proveedor.

## Estados y reglas de transición

Estados del modelo: `SCHEDULED`, `LIVE`, `FINISHED`, `SUSPENDED`, `POSTPONED` y `CANCELLED`;
sus valores en la API son `scheduled`, `live`, `finished`, `suspended`, `postponed` y `cancelled`,
en línea con `MatchStatus` del paquete compartido.

Transiciones ordinarias:

| Estado actual | Siguiente estado permitido |
|---|---|
| SCHEDULED | LIVE, SUSPENDED, POSTPONED, CANCELLED |
| LIVE | SUSPENDED, POSTPONED, FINISHED, CANCELLED |
| SUSPENDED | LIVE, POSTPONED, FINISHED, CANCELLED |
| POSTPONED | SCHEDULED, CANCELLED |
| FINISHED | Ninguno |
| CANCELLED | Ninguno |

`FINISHED` requiere marcador final no negativo. Entrar a `FINISHED` o `CANCELLED`, así como corregir
o reabrir un partido terminado/cancelado, es exclusivo de `ADMIN`, exige motivo y queda auditado.
Una transición rechazada no modifica ni el estado ni el marcador. Un partido aplazado que se
reprograme conserva su identidad y mercados; los mercados no se abren automáticamente. La
liquidación de apuestas pertenece a spec 4 y no se implementa en esta feature.

Los mercados admiten `OPEN`, `SUSPENDED` y `CLOSED`. Solo `OPEN` publica cuotas apostables. Una
suspensión/cierre de partido suspende sus mercados inmediatamente; reanudar un partido no los
reabre por sí mismo.

Tipos y selecciones estables:

| Mercado | Parámetro | Selecciones |
|---|---|---|
| Resultado 1X2 | Ninguno | `HOME`, `DRAW`, `AWAY` |
| Doble oportunidad | Ninguno | `HOME_OR_DRAW`, `HOME_OR_AWAY`, `DRAW_OR_AWAY` |
| Total de goles | Línea decimal positiva (p. ej., 2.5) | `OVER`, `UNDER` |
| Ambos equipos marcan | Ninguno | `YES`, `NO` |

Cada selección tiene una única cuota decimal mayor que `1.000` vigente por fuente. Para total de
goles la línea identifica mercados distintos; los otros tipos no aceptan línea.

## Contrato HTTP

| Método | Ruta | Acceso | Propósito |
|---|---|---|---|
| GET | `/matches` | Público | Cartelera paginada; filtros `from`, `to`, `competitionId`, `status`, `page`, `pageSize` |
| GET | `/matches/competitions` | Público | Competiciones publicadas disponibles para filtrar la cartelera |
| GET | `/matches/:id` | Público | Partido y mercados abiertos; cuota manual preferida |
| GET/POST | `/operator/competitions` | OPERATOR/ADMIN | Listar y crear competiciones |
| GET/POST | `/operator/matches` | OPERATOR/ADMIN | Cartelera operativa y creación manual |
| GET/PATCH | `/operator/matches/:id` | OPERATOR/ADMIN | Detalle completo y edición de partido |
| PATCH | `/operator/matches/:id/status` | OPERATOR/ADMIN | Aplicar transición validada; terminal solo ADMIN con motivo |
| POST | `/operator/matches/:id/markets` | OPERATOR/ADMIN | Crear mercado con todas sus selecciones y cuotas manuales |
| PATCH | `/operator/markets/:id/status` | OPERATOR/ADMIN | Abrir, suspender o cerrar un mercado |
| PATCH | `/operator/markets/:id/odds` | OPERATOR/ADMIN | Crear o cambiar cuota manual de una selección |

Fechas ISO-8601 se interpretan como instantes y se almacenan en UTC. Las cuotas viajan como strings
decimales de tres posiciones para evitar redondeos binarios. La cartelera pública excluye partidos
cancelados incluso si se pide explícitamente ese estado.

## Historias de usuario

### US1 — Consultar cartelera y mercados (P1)

Como visitante/apostador, quiero listar partidos próximos y en vivo, abrir su detalle y comparar
mercados y cuotas publicadas para consultar la oferta actual.

**Aceptación**

1. La cartelera pagina/filtra por fecha, competición y estado sin incluir partidos cancelados por
   defecto.
2. El detalle muestra equipos, competición, inicio, estado, marcador disponible y mercados
   abiertos con sus selecciones y cuotas.
3. Las cuotas decimales mayores que `1.000` se identifican con fuente y fecha de actualización;
   una cuota suspendida/cerrada no se presenta como disponible.
4. Una persona no autenticada puede consultar únicamente datos publicados; no puede invocar
   operaciones de gestión.

### US2 — Gestionar partidos, mercados y cuotas (P1)

Como operador, quiero mantener la cartelera y ajustar manualmente estados, mercados y cuotas para
corregir información operativa sin perder trazabilidad.

**Aceptación**

1. `OPERATOR` y `ADMIN` pueden crear/editar competiciones y partidos, gestionar los cuatro tipos
   de mercado elegidos, y crear/editar/suspender/cerrar selecciones y cuotas manuales.
2. Cada transición valida la tabla de estados; finalizar, cancelar y corregir estados terminales
   requiere `ADMIN` y motivo.
3. Las cuotas manuales decimales mayores que `1.000` se validan en el servidor; cada cambio conserva historial con
   valor anterior/nuevo, actor y hora, y genera una auditoría.
4. Apostadores reciben `403` y usuarios sin sesión `401` al intentar gestionar datos.
5. Las operaciones que compiten con una sincronización no pierden la modificación más reciente ni
   sobrescriben silenciosamente una cuota manual.

### US3 — Sincronizar partidos y cuotas externas (P1)

Como equipo operador, quiero importar partidos del día y refrescar los partidos en vivo con una
frecuencia que se adapte al presupuesto diario de API-Football.

**Aceptación**

1. API-Football se consume solo desde el backend; la clave nunca se envía al navegador ni aparece
   en logs o errores de usuario.
2. `API_FOOTBALL_DAILY_BUDGET` debe estar definido como entero positivo antes de cualquier
   petición. Ausente, inválido o cero significa **cero peticiones** y un estado operativo explícito.
3. Antes de cada petición, el worker reserva atómicamente una unidad para el día UTC. Peticiones
   exitosas, fallidas y con timeout cuentan contra el límite. Dos workers concurrentes nunca lo
   superan; no se reintenta automáticamente una petición que pudo haber sido enviada.
4. Al agotarse el presupuesto, se detienen consultas y reintentos, se conserva lo ya importado y
   se informa el siguiente reinicio del presupuesto UTC.
5. El planificador prioriza fixtures en vivo; ajusta el intervalo efectivo según volumen de
   partidos y presupuesto restante. Los intervalos son configurables, tienen valores conservadores
   documentados y no pueden eludir el presupuesto.
6. La importación es idempotente por identificador de fixture del proveedor. Datos repetidos no
   duplican competiciones, equipos, partidos, mercados ni historial de cuotas.
7. El proveedor es fuente de resultados/fixtures. Mercados externos se actualizan únicamente cuando
   el endpoint está habilitado por el plan y existe cuota disponible. Un error de permisos del
   proveedor se muestra explícitamente, no crea cuotas ficticias y no detiene la gestión manual.
8. La sincronización respeta cambios manuales: una cuota manual tiene prioridad y queda intacta;
   la versión externa se conserva separada para que el operador pueda inspeccionarla.

### US4 — Consultar y exportar reportes operativos (P2)

Como operador o administrador, quiero filtrar el dashboard por periodo, competición y estado y
exportar exactamente esos resultados a CSV o PDF.

**Aceptación**

1. Dashboard de solo lectura con partidos por estado/periodo, próximos y en vivo, mercados por
   estado, cambios recientes de cuotas y actividad auditada de operadores.
2. Los mismos filtros y zona horaria documentada se aplican al dashboard, CSV y PDF.
3. CSV tiene encabezados estables, UTF-8 y filas escapadas correctamente; PDF contiene periodo,
   filtros, fecha de generación y tablas legibles.
4. Solo `OPERATOR` y `ADMIN` pueden acceder; el servicio Python consulta PostgreSQL mediante una
   conexión de solo lectura y nunca escribe datos del negocio.
5. Límite de periodo y tamaño de exportación evita consultas/exportaciones sin acotar; una
   solicitud inválida devuelve error explícito.

## Requisitos funcionales

- **FR-001**: modelar competición, equipo, partido, mercado, selección/cuota e historial de cambios.
- **FR-002**: validar transiciones de estado y marcador en el servidor.
- **FR-003**: exponer cartelera/detalle de solo lectura y CRUD protegido para `OPERATOR`/`ADMIN`.
- **FR-004**: auditar cambios manuales, correcciones de estado y cuotas con metadatos de petición.
- **FR-005**: consumir API-Football mediante un worker BullMQ persistente en Redis.
- **FR-006**: aplicar un presupuesto diario UTC persistente, atómico y fail-closed antes de cada
  petición al proveedor.
- **FR-007**: sincronizar fixtures idempotentemente, con intervalos adaptativos configurables y
  prioridad a partidos en vivo.
- **FR-008**: sincronizar cuotas externas cuando el plan ofrezca acceso, sin sobrescribir precios
  manuales ni simular datos ausentes.
- **FR-009**: mostrar la cartelera, detalle y gestión de operador en la web, con estados/errores
  accesibles y controles compatibles con teclado y móvil.
- **FR-010**: generar dashboard, CSV y PDF desde el servicio Python de reportes de solo lectura.
- **FR-011**: proteger reportes para `OPERATOR`/`ADMIN` y no exponer credenciales entre servicios
  o al navegador.
- **FR-012**: las pruebas no llaman al proveedor real ni incluyen credenciales; usan respuestas
  simuladas y límites bajos deterministas.

## Supuestos y dependencias explícitas

- Redis y PostgreSQL locales se levantan con Docker Compose.
- La clave compartida anteriormente debe reemplazarse antes de habilitar tráfico real; la nueva
  clave se configura fuera del repositorio.
- El presupuesto diario lo debe proporcionar el equipo según el plan contratado. No se asigna
  aquí un valor predeterminado que pueda consumir una cuota desconocida.
- El acceso a cuotas de API-Football depende del plan; el modo manual sigue disponible si no se
  ofrece ese endpoint.
- La spec 4 consumirá los identificadores, estados y mercados publicados, pero sus apuestas,
  cierre por inicio, liquidación, reembolso y tiempo real quedan fuera de esta entrega.

## Fuera de alcance

- Crear/aceptar/liquidar apuestas, billetera, pagos y promociones.
- WebSockets y garantía de resultado en menos de cinco segundos.
- Alta disponibilidad multi-región o modificar cuotas/límites del proveedor.
- Reportes financieros de apuestas aún no implementadas.
