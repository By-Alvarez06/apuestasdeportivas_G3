# Sistema web de apuestas deportivas

## 1. Contexto y objetivo

Construir una plataforma web de apuestas deportivas **responsiva**, **fácil de usar** y con **resultados en tiempo real**, alimentada por **API-Football**.

**Proyecto académico**: no se opera con dinero real. Todos los pagos se ejecutan en el entorno de pruebas (*sandbox*) de la pasarela, y no aplican licencias ni requisitos regulatorios de operación comercial.

**La seguridad y la prevención de fraude son el criterio prioritario**: ante cualquier conflicto entre rendimiento, comodidad o seguridad, prevalece la seguridad.

## 2. Roles

| Rol | Puede hacer |
|-----|-------------|
| **Apostador** | Registrarse, verificar identidad, depositar, apostar (simple y combinada), ver su historial, retirar ganancias, usar cupones. |
| **Operador** | Gestionar partidos, mercados y cuotas; gestionar aplazamientos/suspensiones; gestionar promociones y cupones. |
| **Administrador** | Todo lo anterior + gestión de usuarios y roles, aprobación de retiros sospechosos, reportes y auditoría. |

## 3. Requisitos funcionales

### 3.1 Cuentas y billetera
- Registro con verificación de correo, mayoría de edad y **2FA** obligatorio para retiros.
- Billetera con saldo real y saldo de bonificación separados.
- **No se puede apostar sin saldo suficiente**: el saldo se valida y se descuenta en la misma transacción que crea la apuesta.
- Todo movimiento de dinero se registra en un **libro contable de doble entrada (ledger) inmutable**; el saldo se deriva del ledger, nunca se edita directamente.

### 3.2 Pasarela de pagos (Payphone, modo sandbox)
- **Depósitos** y **retiros** exclusivamente a través de **Payphone**.
- La acreditación de un depósito solo ocurre cuando el **backend confirma la transacción directamente con la API de Payphone** (servidor a servidor); el regreso del navegador desde la pasarela nunca acredita saldo por sí solo.
- Validar que el monto, la moneda y la referencia confirmados por Payphone coincidan con la intención de pago registrada.
- Si Payphone no permite pagos salientes (retiros) en sandbox, el retiro se implementa como solicitud registrada en el ledger, aprobada por el administrador y marcada como pagada con una referencia simulada.
- Retiros solo al mismo método/titular usado para depositar; retiros sobre un umbral requieren revisión manual.
- Operaciones idempotentes (clave de idempotencia) para evitar dobles cobros o dobles acreditaciones.

### 3.3 Partidos y mercados
- CRUD de partidos (equipos, competición, fecha/hora, estado).
- Estados del partido: `programado → en_vivo → finalizado`, además de `suspendido`, `aplazado` y `cancelado`.
- Mercados por partido con cuotas configurables por el operador o importadas de API-Football. El catálogo de deportes y mercados no se define en este alcance: el sistema se diseña genérico y usa lo que ofrezca API-Football.
- Sincronización automática de partidos y resultados desde **API-Football**:
  - un único servicio del backend consulta la API y publica los cambios internamente (Redis); los clientes nunca llaman a API-Football directamente;
  - la frecuencia de consulta se ajusta a la cuota de peticiones del plan contratado (el plan gratuito tiene un límite diario bajo): consulta frecuente solo para partidos en vivo, y espaciada para el resto;
  - la API key vive solo en el backend.

### 3.4 Apuestas
- **Apuesta simple** y **apuesta combinada (múltiple/parlay)**.
- La cuota queda **congelada al momento de aceptar** la apuesta; si cambió, el usuario debe reconfirmar.
- No se aceptan apuestas pre-partido después del inicio. Las apuestas en vivo, si se habilitan, tienen un retardo de aceptación configurable para evitar ventaja por latencia.
- Límites configurables de monto mínimo/máximo por apuesta, por usuario y de ganancia máxima.
- Una apuesta aceptada no puede ser modificada ni eliminada por nadie; solo anulada por regla de negocio y con registro de auditoría.

### 3.5 Liquidación en tiempo real
- Al recibir el resultado final de un partido, **las apuestas se liquidan automáticamente en el instante** y el saldo del ganador se acredita.
- El usuario ve el resultado de su apuesta en tiempo real (WebSocket/SSE), sin recargar.
- La liquidación es **idempotente**: reprocesar el mismo resultado no paga dos veces.
- Si la API corrige un resultado, se permite la re-liquidación controlada con registro de auditoría.

### 3.6 Partidos suspendidos y aplazados
- Si un partido suspendido se reanuda dentro del plazo configurable (p. ej. 48 h), las apuestas se mantienen.
- Si no se reanuda en el plazo o se cancela, las apuestas se **anulan y se reembolsa** el monto apostado.
- En combinadas, una selección anulada se toma con cuota 1.00 y el resto de la combinada sigue vigente.
- Los mercados ya resueltos antes de la suspensión (p. ej. "primer gol") se liquidan con normalidad.

### 3.7 Promociones y cupones
- Crear cupones con código, tipo (bono de depósito, apuesta gratis, aumento de cuota), vigencia, cupo total y límite por usuario.
- Requisitos de rollover antes de que un bono se pueda retirar.
- Controles anti-abuso: un cupón por usuario/dispositivo/método de pago, detección de cuentas múltiples.

### 3.8 Reportes y dashboard (servicio en Python)
- Los reportes los genera un **servicio independiente en Python** (FastAPI + pandas), que lee la base de datos con un usuario de **solo lectura** y nunca modifica datos de apuestas ni de dinero.
- El dashboard se muestra en el frontend Next.js consumiendo ese servicio; el acceso exige rol de administrador (el token se valida igual que en el backend NestJS).
- Dashboard dinámico con filtros por fecha, deporte, competición y usuario.
- Métricas: volumen apostado, GGR (ingreso bruto), ganancias pagadas, depósitos/retiros, usuarios activos, uso de cupones, alertas de fraude.
- Exportación a CSV/PDF.

## 4. Seguridad y antifraude (criterio prioritario)

- Toda la lógica de dinero, cuotas y liquidación se ejecuta **solo en el backend**; el frontend no es confiable.
- Transacciones de base de datos con bloqueo de fila sobre la billetera para evitar condiciones de carrera (doble gasto).
- Autenticación con tokens de corta duración + refresh rotativo; contraseñas con Argon2/bcrypt.
- Control de acceso por roles (RBAC) en cada endpoint.
- Rate limiting, protección contra fuerza bruta y CAPTCHA en registro/login.
- Validación de firma en todos los webhooks (pasarela y API deportiva).
- Registro de auditoría inmutable de toda acción sensible (quién, qué, cuándo, IP, dispositivo).
- Reglas de detección: múltiples cuentas por dispositivo/IP/método de pago, patrones de apuestas anómalas, retiros inmediatos tras depósito sin actividad.
- Cumplimiento OWASP Top 10, secretos solo en variables de entorno, HTTPS obligatorio.

## 5. Requisitos no funcionales

- **Tiempo real**: el resultado de un partido debe reflejarse en las apuestas del usuario en ≤ 5 s desde que la API lo publica.
- **Responsivo**: diseño mobile-first, usable desde 360 px de ancho.
- **Accesibilidad**: WCAG 2.1 AA.
- **Disponibilidad**: tolerancia a caídas de la API deportiva (reintentos, cola de eventos, sin pérdida de resultados).

## 6. Stack tecnológico

| Capa | Tecnología | Despliegue |
|------|-----------|------------|
| Frontend | Next.js (TypeScript) | **Vercel** |
| Backend / API principal | **NestJS (TypeScript)** | **Render** |
| Servicio de reportes | **Python (FastAPI + pandas)** | **Render** |
| Base de datos | PostgreSQL | **Render** |
| Caché / pub-sub / colas | Redis (Render Key Value) | **Render** |
| Tiempo real | WebSocket (gateway de NestJS) | Render |
| Resultados deportivos | **API-Football** | Externo |
| Pasarela de pagos | **Payphone** (sandbox) | Externo |

- Estructura de monorepo: `apps/web` (Next.js), `apps/api` (NestJS), `apps/reports` (Python).

- **Prohibido**: Java y Rust.

## 7. DevOps y flujo de trabajo

- **Git Flow**: ramas `main`, `develop`, `feature/*`, `release/*`, `hotfix/*`. Ningún push directo a `main` ni `develop`; todo entra por Pull Request con revisión.
- **Commits atómicos y reversibles**: un cambio lógico por commit, con Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`…), y cada commit debe compilar y pasar las pruebas.
- **Pipeline CI/CD** (GitHub Actions):
  1. Lint y verificación de tipos.
  2. Pruebas unitarias y de integración con cobertura (Jest para TypeScript, pytest para Python).
  3. Análisis estático con **SonarQube** y *quality gate* bloqueante.
  4. Despliegue automático: `develop` → entorno de staging; `main` → producción (Vercel + Render).
- **Grafana**: dashboard para el equipo con trazabilidad del proceso de desarrollo (commits, PRs, tiempo de revisión, despliegues, fallos del pipeline, métricas DORA), conectado al repositorio y al CI.

## 8. Fuera de alcance (por ahora)

- Definición del catálogo de deportes y mercados.
- Dinero real, licencias de operación y cumplimiento regulatorio (proyecto académico).
- Casino, juegos de azar no deportivos y apuestas entre usuarios.
- Aplicaciones móviles nativas.
