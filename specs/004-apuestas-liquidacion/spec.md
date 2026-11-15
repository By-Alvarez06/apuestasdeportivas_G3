# Feature Specification: Apuestas y liquidación

**Feature Branch**: `feature/spec-4`
**Created**: 2026-11-13
**Status**: Draft
**Input**: User description: "Spec 4 — Apuestas simples y combinadas (aceptación atómica, cuota congelada, límites); liquidación idempotente en tiempo real por WebSocket; suspensiones y aplazamientos (reembolso, cuota 1.00 en combinadas); promociones y cupones; detección de fraude. Depende de la spec 2 (billetera) y de la spec 3 (partidos y mercados); mientras no estén integradas, se trabaja contra interfaces simuladas."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Apuesta simple con saldo y cuota garantizados (Priority: P1)

Un apostador elige una selección de un mercado abierto (por ejemplo, "gana el local" a cuota 2.10),
indica el monto y confirma. El sistema acepta la apuesta solo si tiene saldo, si el mercado sigue
abierto y si la cuota es la que el apostador vio; desde ese momento la cuota queda congelada y el
monto descontado. El apostador ve la apuesta en su historial.

**Why this priority**: es el núcleo del producto y el punto donde más se concentra el riesgo de
fraude (doble gasto, cuota alterada, apuesta tardía). Sin esto no hay nada que liquidar.

**Independent Test**: con una billetera de saldo conocido y un mercado abierto simulado, colocar
apuestas válidas e inválidas (sin saldo, cuota cambiada, partido iniciado, fuera de límites) y
comprobar que solo las válidas se aceptan y que el saldo baja exactamente el monto aceptado.

**Acceptance Scenarios**:

1. **Given** un apostador con 50.00 USD de saldo real y un mercado abierto con cuota 2.10, **When**
   confirma una apuesta de 10.00 USD a cuota 2.10, **Then** la apuesta queda aceptada con cuota
   congelada 2.10, ganancia potencial 21.00 USD, y su saldo real pasa a 40.00 USD.
2. **Given** un apostador con 5.00 USD de saldo, **When** intenta apostar 10.00 USD, **Then** la
   apuesta se rechaza por saldo insuficiente y no se crea ninguna apuesta ni movimiento.
3. **Given** que la cuota cambió de 2.10 a 1.95 entre que el apostador la vio y confirmó, **When**
   confirma a 2.10, **Then** la apuesta no se acepta y el sistema le muestra la cuota nueva para que
   la reconfirme.
4. **Given** un partido cuya hora de inicio ya pasó según el reloj del servidor, **When** un
   apostador intenta una apuesta pre-partido sobre él, **Then** se rechaza aunque su pantalla siga
   mostrando el mercado abierto.
5. **Given** una billetera con 100.00 USD, **When** el mismo apostador envía al mismo tiempo 20
   apuestas de 10.00 USD, **Then** se aceptan exactamente 10, se rechazan 10 y el saldo final es
   0.00 USD.
6. **Given** un apostador que envía dos veces la misma solicitud de apuesta (mismo identificador de
   solicitud), **When** el sistema procesa ambas, **Then** existe una sola apuesta y un solo
   descuento.
7. **Given** límites de 0.50 USD mínimo y 500.00 USD máximo por apuesta, **When** el apostador
   intenta apostar 0.10 USD o 600.00 USD, **Then** se rechaza indicando el límite aplicable.
8. **Given** una apuesta aceptada, **When** cualquier usuario (incluido un administrador) intenta
   modificar su monto, cuota o selección, o eliminarla, **Then** el sistema lo impide.

---

### User Story 2 - Liquidación automática en tiempo real (Priority: P1)

Cuando un partido termina y se conoce el resultado, todas sus apuestas se liquidan solas: las
ganadoras acreditan la ganancia en la billetera y las perdedoras se cierran. El apostador ve el
cambio de estado de su apuesta y su nuevo saldo en pantalla, sin recargar.

**Why this priority**: junto con la US1 forma el ciclo mínimo completo (apostar → cobrar). El
tiempo real es un requisito explícito (≤ 5 s) y la idempotencia es no negociable.

**Independent Test**: con apuestas aceptadas sobre un partido simulado, publicar su resultado final
y comprobar estados, saldos y notificaciones; publicar el mismo resultado otra vez y comprobar que
los saldos no cambian.

**Acceptance Scenarios**:

1. **Given** una apuesta de 10.00 USD a cuota 2.10 sobre "gana el local", **When** el partido
   termina con victoria local, **Then** la apuesta pasa a ganada y se acreditan 21.00 USD al saldo
   del que salió el monto apostado.
2. **Given** la misma apuesta, **When** el partido termina en empate, **Then** la apuesta pasa a
   perdida y no hay movimiento de dinero.
3. **Given** un apostador con la sesión abierta, **When** su apuesta se liquida, **Then** ve el nuevo
   estado y su saldo actualizado en menos de 5 segundos desde que se publicó el resultado, sin
   recargar la página.
4. **Given** un resultado ya procesado, **When** el mismo resultado llega de nuevo (una o varias
   veces), **Then** ninguna apuesta se paga dos veces y los saldos no cambian.
5. **Given** que el servicio estuvo caído cuando llegó un resultado, **When** se recupera, **Then**
   procesa el resultado pendiente y liquida las apuestas; ningún resultado se pierde.
6. **Given** un apostador sin sesión abierta, **When** su apuesta se liquida, **Then** la ve
   liquidada en su historial la próxima vez que entra.

---

### User Story 3 - Apuesta combinada (Priority: P2)

Un apostador junta varias selecciones de partidos distintos en un solo boleto. La cuota total es el
producto de las cuotas; la combinada gana solo si ganan todas sus selecciones.

**Why this priority**: amplía el producto con el tipo de apuesta más usado tras la simple, sobre las
mismas garantías de la US1 y la US2.

**Independent Test**: armar combinadas con 2 y más selecciones simuladas, aceptarlas y liquidarlas
con distintas combinaciones de resultados (todas ganan, una pierde, una anulada).

**Acceptance Scenarios**:

1. **Given** tres selecciones de partidos distintos con cuotas 1.50, 2.00 y 1.80, **When** el
   apostador confirma una combinada de 10.00 USD, **Then** se acepta con cuota total congelada 5.40 y
   ganancia potencial 54.00 USD, en un solo descuento.
2. **Given** dos selecciones del mismo partido, **When** el apostador intenta combinarlas, **Then**
   el sistema lo impide e indica que las selecciones deben ser de partidos distintos.
3. **Given** una combinada aceptada, **When** una de sus selecciones pierde, **Then** la combinada se
   liquida como perdida sin esperar al resto de partidos.
4. **Given** una combinada aceptada, **When** todas sus selecciones ganan, **Then** se liquida como
   ganada y se acredita monto × cuota total congelada.
5. **Given** que la cuota de una sola de las selecciones cambió antes de confirmar, **When** el
   apostador confirma, **Then** la combinada completa no se acepta y se le pide reconfirmar con las
   cuotas nuevas.

---

### User Story 4 - Partidos suspendidos, aplazados, cancelados y resultados corregidos (Priority: P2)

Si un partido se suspende o aplaza, sus apuestas quedan en espera. Si se reanuda dentro del plazo
configurado, siguen vigentes; si no, o si se cancela, se anulan y se reembolsa lo apostado. Si la
fuente de resultados corrige un resultado ya liquidado, la re-liquidación se hace de forma
controlada y auditada.

**Why this priority**: son reglas obligatorias del proyecto y un foco de disputas y fraude, pero
dependen de que la apuesta y la liquidación (US1–US3) ya existan.

**Independent Test**: simular partidos que se suspenden y se reanudan dentro y fuera de plazo, uno
cancelado, y un resultado corregido; comprobar estados, reembolsos, cuota 1.00 en combinadas y
registros de auditoría.

**Acceptance Scenarios**:

1. **Given** una apuesta simple sobre un partido suspendido, **When** el partido se reanuda dentro
   del plazo (48 h por defecto), **Then** la apuesta sigue vigente y se liquida con el resultado
   final.
2. **Given** una apuesta simple sobre un partido aplazado, **When** pasa el plazo sin que se juegue,
   **Then** la apuesta se anula y se reembolsa el monto apostado al mismo saldo del que salió.
3. **Given** una apuesta sobre un partido cancelado, **When** se registra la cancelación, **Then** la
   apuesta se anula y se reembolsa de inmediato, sin esperar el plazo.
4. **Given** una combinada de 3 selecciones (cuotas 1.50, 2.00, 1.80) en la que un partido se anula,
   **When** los otros dos ganan, **Then** la combinada gana con cuota total 1.50 × 1.00 × 1.80 = 2.70.
5. **Given** una combinada en la que todas las selecciones quedan anuladas, **When** se liquida,
   **Then** se reembolsa el monto apostado.
6. **Given** un mercado resuelto antes de la suspensión (por ejemplo, "primer gol"), **When** el
   partido se suspende y luego se anula, **Then** ese mercado se liquida con su resultado y solo se
   anulan los mercados no resueltos.
7. **Given** un resultado ya liquidado, **When** la fuente publica una corrección, **Then** el
   sistema revierte la liquidación anterior con movimientos compensatorios y liquida con el
   resultado nuevo, una sola vez, dejando constancia en la auditoría del resultado anterior, el nuevo
   y el efecto en cada apuesta.
8. **Given** una apuesta anulada o reembolsada, **When** el evento de anulación llega de nuevo,
   **Then** no se reembolsa dos veces.

---

### User Story 5 - Promociones y cupones (Priority: P3)

Un operador crea cupones (bono de depósito, apuesta gratis o aumento de cuota) con vigencia, cupo
total y límite por usuario. Un apostador canjea un código y recibe el beneficio. El saldo de bono
solo se convierte en saldo real retirable tras cumplir el requisito de rollover.

**Why this priority**: aporta valor comercial pero no es necesario para el ciclo básico de apostar y
cobrar; es, además, un vector de abuso que exige las garantías anteriores.

**Independent Test**: crear un cupón de cada tipo, canjearlos con un apostador, intentar reutilizarlos
desde el mismo usuario, dispositivo o método de pago, y verificar la conversión del bono tras
cumplir el rollover.

**Acceptance Scenarios**:

1. **Given** un operador, **When** crea un cupón con código, tipo, valor, vigencia, cupo total y
   límite por usuario, **Then** el cupón queda disponible solo dentro de su vigencia y la acción se
   audita.
2. **Given** un cupón de bono de depósito del 50 % hasta 20.00 USD, **When** el apostador lo canjea
   y luego se le acredita un depósito de 30.00 USD, **Then** recibe 15.00 USD en saldo de bono con
   un rollover pendiente.
3. **Given** un cupón de apuesta gratis de 5.00 USD, **When** el apostador la usa en una apuesta a
   cuota 3.00 que gana, **Then** recibe 10.00 USD de ganancia (sin devolución del monto gratuito) y
   no se le descuenta saldo al apostar.
4. **Given** un cupón de aumento de cuota del 10 %, **When** el apostador lo aplica a una apuesta a
   cuota 2.00, **Then** la apuesta se acepta con cuota congelada 2.20, sin superar el aumento máximo
   del cupón.
5. **Given** un cupón ya canjeado por un usuario, **When** el mismo usuario, otra cuenta desde el
   mismo dispositivo o con el mismo método de pago intenta canjearlo, **Then** el canje se rechaza y
   el intento queda registrado.
6. **Given** un cupón con cupo total de 100 canjes, **When** llegan al mismo tiempo 150 solicitudes
   de canje de usuarios distintos, **Then** se aceptan exactamente 100.
7. **Given** un bono de 15.00 USD con rollover 5× (75.00 USD apostados a cuota mínima 1.50),
   **When** el apostador completa ese volumen con apuestas liquidadas, **Then** el saldo de bono
   restante pasa a saldo real retirable.
8. **Given** un cupón vencido o agotado, **When** alguien intenta canjearlo, **Then** se rechaza con
   un mensaje que explica el motivo.

---

### User Story 6 - Detección de fraude y alertas (Priority: P3)

El sistema evalúa reglas de fraude sobre apuestas, cupones y movimientos, y genera alertas que el
administrador revisa. El administrador puede descartar la alerta o actuar sobre la cuenta.

**Why this priority**: la seguridad es el criterio prioritario, pero las reglas de detección
necesitan que apuestas y cupones ya generen actividad que evaluar.

**Independent Test**: generar con datos simulados cada patrón sospechoso (cuentas múltiples por
dispositivo/IP/método de pago, apuestas anómalas, retiro inmediato tras depósito) y comprobar que
aparece la alerta correcta, y que la actividad normal no genera alertas.

**Acceptance Scenarios**:

1. **Given** tres cuentas que usan el mismo dispositivo o el mismo método de pago, **When** la
   tercera canjea un cupón o apuesta, **Then** se genera una alerta de "cuentas múltiples" que
   enlaza las cuentas relacionadas.
2. **Given** un apostador cuyo monto apostado en un partido supera varias veces su promedio
   histórico, o que apuesta repetidamente justo antes de cambios bruscos de cuota, **When** se
   evalúan las reglas, **Then** se genera una alerta de "apuesta anómala".
3. **Given** un apostador que deposita y solicita retirar sin apostar en medio, **When** se registra
   el retiro, **Then** se genera una alerta de "retiro tras depósito sin actividad".
4. **Given** una alerta abierta, **When** un administrador la revisa, **Then** puede descartarla o
   marcarla como confirmada con un motivo, y en ese caso suspender la cuenta; toda decisión se
   audita.
5. **Given** una cuenta con alerta de severidad alta abierta, **When** intenta canjear un cupón,
   **Then** el canje queda bloqueado hasta que un administrador resuelva la alerta.
6. **Given** un apostador o un operador, **When** intenta ver o gestionar alertas de fraude,
   **Then** el acceso se deniega.

---

### Edge Cases

- El apostador confirma justo en el instante del inicio del partido: decide el reloj del servidor;
  si la solicitud se procesa a la hora de inicio o después, se rechaza.
- Un mercado se suspende temporalmente (por ejemplo, durante un penal) mientras hay apuestas en
  curso: las solicitudes no aceptadas se rechazan; las ya aceptadas no cambian.
- Apuesta en vivo: la aceptación se retiene el retardo configurado y se vuelve a comprobar que el
  mercado sigue abierto y la cuota igual; si no, se rechaza sin descontar saldo.
- Ganancia potencial por encima del máximo permitido: la apuesta se rechaza indicando el monto
  máximo apostable a esa cuota.
- Se alcanza el límite diario de monto apostado del usuario: las nuevas apuestas se rechazan hasta
  el día siguiente.
- La billetera no responde durante la aceptación: la apuesta no se crea ni se descuenta nada.
- Llega un resultado de un partido sin apuestas: se registra sin efectos.
- Llega una corrección de resultado después de que el apostador retiró la ganancia: la reversión no
  deja saldo negativo; la diferencia queda como saldo adeudado que bloquea apuestas y retiros hasta
  saldarse, y se genera una alerta para el administrador.
- El partido suspendido se reanuda después del plazo: las apuestas ya están anuladas y no se
  reactivan.
- Un cupón de apuesta gratis se usa en una apuesta que luego se anula: se devuelve la apuesta gratis
  (si el cupón sigue vigente), no dinero.
- Una apuesta pagada con saldo de bono gana: la ganancia va a saldo de bono y cuenta para el rollover
  solo si la cuota cumple el mínimo.
- El apostador tiene varias pestañas abiertas: todas reciben la actualización de su apuesta.

## Requirements *(mandatory)*

### Functional Requirements

**Aceptación de apuestas**

- **FR-001**: El sistema DEBE permitir apuestas simples (una selección) y combinadas (de 2 a 10
  selecciones de partidos distintos; máximo configurable).
- **FR-002**: El sistema DEBE validar el saldo, descontar el monto y registrar la apuesta como una
  única operación indivisible; si cualquier paso falla, no queda apuesta ni descuento.
- **FR-003**: El apostador DEBE elegir si la apuesta se paga con saldo real o con saldo de bono; una
  apuesta se paga de un solo saldo.
- **FR-004**: La solicitud de apuesta DEBE incluir la cuota que el apostador vio; si alguna cuota
  vigente difiere, la apuesta DEBE rechazarse y devolver las cuotas nuevas para reconfirmar.
- **FR-005**: La cuota (y la cuota total en combinadas) DEBE quedar congelada al aceptar la apuesta y
  usarse en la liquidación aunque el mercado cambie después.
- **FR-006**: El sistema DEBE rechazar apuestas pre-partido cuando, según el reloj del servidor, el
  partido ya empezó, y apuestas sobre mercados no abiertos.
- **FR-007**: Las apuestas en vivo, en mercados que el operador habilite para ello, DEBEN retenerse
  durante un retardo configurable (5 s por defecto) y revalidar mercado y cuota antes de aceptarse.
- **FR-008**: El sistema DEBE aplicar límites configurables: monto mínimo y máximo por apuesta,
  monto máximo apostado por usuario por día y ganancia potencial máxima por apuesta.
- **FR-009**: Toda solicitud de apuesta DEBE llevar un identificador único; repetirla DEBE devolver
  la misma apuesta sin un segundo descuento.
- **FR-010**: Una apuesta aceptada NO DEBE poder modificarse ni eliminarse por nadie; solo puede
  anularse por las reglas de esta spec, con auditoría.
- **FR-011**: El apostador DEBE poder ver su historial de apuestas paginado y filtrable por estado y
  fecha, con selecciones, cuotas congeladas, monto, ganancia potencial y resultado.
- **FR-012**: Ningún valor calculado en el cliente (cuota, ganancia, saldo) DEBE aceptarse: el
  sistema recalcula todo con sus propios datos.

**Liquidación**

- **FR-013**: Al recibir el resultado de un mercado o el final de un partido, el sistema DEBE
  liquidar automáticamente las apuestas afectadas: ganada, perdida o anulada.
- **FR-014**: Una apuesta ganada DEBE acreditar monto × cuota congelada al mismo saldo (real o bono)
  del que salió el monto; una apuesta anulada DEBE reembolsar el monto al mismo saldo.
- **FR-015**: La liquidación, los reembolsos y la re-liquidación DEBEN ser idempotentes: procesar el
  mismo evento cualquier número de veces produce un solo efecto.
- **FR-016**: Los eventos de resultado DEBEN conservarse hasta procesarse, de modo que una caída del
  servicio no pierda ningún resultado.
- **FR-017**: El sistema DEBE notificar al apostador en tiempo real, sin recargar, el cambio de estado
  de sus apuestas y su nuevo saldo, en ≤ 5 s desde que se publica el resultado; cada apostador solo
  recibe notificaciones de sus propias apuestas.
- **FR-018**: Una combinada DEBE liquidarse como perdida en cuanto pierde una selección, y como
  ganada o reembolsada cuando todas sus selecciones están resueltas.
- **FR-019**: Ante una corrección de resultado, el sistema DEBE revertir la liquidación previa con
  movimientos compensatorios y re-liquidar una sola vez, registrando en la auditoría el resultado
  anterior, el nuevo y el efecto en cada apuesta.
- **FR-020**: Si la reversión de una ganancia supera el saldo disponible, el sistema NO DEBE dejar
  saldo negativo: la diferencia queda registrada como saldo adeudado, que bloquea nuevas apuestas y
  retiros hasta saldarse con créditos posteriores, y genera una alerta.

**Suspensiones, aplazamientos y cancelaciones**

- **FR-021**: Las apuestas de un partido suspendido o aplazado DEBEN quedar en espera; si se reanuda
  dentro del plazo configurable (48 h por defecto desde la hora de inicio programada), DEBEN
  mantenerse.
- **FR-022**: Si el partido no se reanuda dentro del plazo, o se cancela, las selecciones sobre
  mercados no resueltos DEBEN anularse y las apuestas simples reembolsarse.
- **FR-023**: En una combinada, una selección anulada DEBE tomarse con cuota 1.00 y el resto de la
  combinada seguir vigente; si todas quedan anuladas, se reembolsa el monto.
- **FR-024**: Los mercados resueltos antes de la suspensión DEBEN liquidarse con normalidad.
- **FR-025**: El operador DEBE poder consultar las apuestas en espera por partido y ver cuándo vence
  su plazo.

**Promociones y cupones**

- **FR-026**: El operador DEBE poder crear, pausar y consultar cupones con código único, tipo (bono
  de depósito, apuesta gratis, aumento de cuota), valor, vigencia, cupo total y límite por usuario;
  un cupón con canjes no se puede editar, solo pausar.
- **FR-027**: Bono de depósito: un porcentaje del siguiente depósito acreditado, hasta un máximo,
  abonado al saldo de bono con un requisito de rollover.
- **FR-028**: Apuesta gratis: permite una apuesta de un monto fijo sin descontar saldo; si gana, se
  acredita solo la ganancia neta (monto × cuota − monto) al saldo de bono.
- **FR-029**: Aumento de cuota: aumenta en un porcentaje la cuota de una apuesta, con un tope de
  aumento; la cuota aumentada es la que se congela.
- **FR-030**: El cupo total y el límite por usuario DEBEN respetarse incluso con canjes simultáneos.
- **FR-031**: Un cupón DEBE poder canjearse una sola vez por usuario, por dispositivo y por método de
  pago; los intentos rechazados DEBEN registrarse.
- **FR-032**: El saldo de bono DEBE convertirse en saldo real solo al cumplir el rollover del bono
  (por defecto 5× el bono en apuestas liquidadas pagadas con saldo de bono, a cuota ≥ 1.50, dentro de
  30 días); vencido el plazo, el bono restante caduca.
- **FR-033**: Todo canje, conversión y caducidad de bono DEBE registrarse en el libro contable y en
  la auditoría.

**Detección de fraude**

- **FR-034**: El sistema DEBE detectar y generar alertas por: cuentas múltiples (mismo dispositivo,
  IP o método de pago), apuestas anómalas (monto muy superior al histórico del usuario, apuestas
  repetidas antes de cambios bruscos de cuota, coincidencia de apuestas entre cuentas relacionadas)
  y retiro tras depósito sin actividad.
- **FR-035**: Cada alerta DEBE tener tipo, severidad, cuentas implicadas, evidencia y estado
  (abierta, descartada, confirmada).
- **FR-036**: Solo un administrador DEBE poder consultar y resolver alertas; toda resolución exige
  motivo y queda auditada.
- **FR-037**: Mientras una cuenta tenga una alerta de severidad alta abierta, NO DEBE poder canjear
  cupones; el resto de acciones sigue según las reglas de la spec 2.
- **FR-038**: Los umbrales de las reglas DEBEN ser configurables.

**Configuración, auditoría y acceso**

- **FR-039**: Solo un operador o administrador DEBE poder cambiar límites, retardos, plazos y
  parámetros de promociones; los cambios se auditan con el valor anterior y el nuevo.
- **FR-040**: El sistema DEBE auditar: aceptación y rechazo de apuestas por motivos de seguridad,
  anulación, liquidación, re-liquidación, reembolso, canje de cupón, conversión de bono y gestión de
  alertas, con quién, qué, cuándo, IP y dispositivo.
- **FR-041**: Todo movimiento de dinero de esta spec DEBE hacerse a través de la billetera de la
  spec 2, con referencia a su origen (apuesta, cupón, bono) y clave de idempotencia.

### Key Entities

- **Apuesta**: pertenece a un apostador; tipo (simple o combinada), monto, saldo de origen (real o
  bono), cuota total congelada, ganancia potencial, cupón aplicado, estado (en espera, aceptada,
  ganada, perdida, anulada, reembolsada) y fecha de aceptación.
- **Selección de apuesta**: una selección de un mercado dentro de una apuesta, con su cuota congelada
  y su estado (pendiente, ganada, perdida, anulada).
- **Liquidación**: el resultado aplicado a una apuesta, con el evento de resultado que lo originó,
  el monto pagado y su versión (para re-liquidaciones).
- **Evento de resultado**: un resultado, cambio de estado de partido o corrección recibido de la
  fuente de partidos; se guarda hasta procesarse.
- **Límites de apuesta**: valores configurables de montos, ganancia máxima, retardo en vivo y plazo
  de suspensión.
- **Cupón**: código, tipo, valor, tope, vigencia, cupo total, límite por usuario, estado.
- **Canje de cupón**: un uso de un cupón por un usuario, con dispositivo y método de pago.
- **Bono**: saldo de bonificación otorgado, rollover requerido, avance, vencimiento y estado (activo,
  convertido, caducado).
- **Saldo adeudado**: diferencia pendiente de una re-liquidación que el apostador debe cubrir.
- **Alerta de fraude**: tipo, severidad, cuentas implicadas, evidencia, estado y resolución.
- **Partido, mercado y selección** (provistos por la spec 3): estado del partido, hora de inicio,
  estado del mercado, cuota vigente y resultado.
- **Billetera y libro contable** (provistos por la spec 2).

## Vectores de fraude y mitigación

| Vector | Mitigación |
|--------|------------|
| Doble gasto con apuestas simultáneas | Aceptación indivisible con validación de saldo (FR-002) |
| Doble envío de la misma apuesta | Identificador único de solicitud (FR-009) |
| Cuota alterada desde el cliente | Cuota recalculada en el servidor y reconfirmación si difiere (FR-004, FR-012) |
| Apostar conociendo el resultado (apuesta tardía) | Cierre por reloj del servidor (FR-006) y retardo en vivo (FR-007) |
| Modificar o borrar una apuesta aceptada | Inmutabilidad y anulación solo por regla auditada (FR-010) |
| Cobro doble de una ganancia o reembolso | Liquidación y reembolso idempotentes (FR-015) |
| Pérdida de resultados por caídas | Eventos conservados hasta procesarse (FR-016) |
| Ver apuestas ajenas en tiempo real | Notificaciones solo al dueño (FR-017) |
| Retirar una ganancia que luego se corrige | Saldo adeudado que bloquea retiros (FR-020) |
| Abuso de cupones (reutilización, multicuentas) | Un canje por usuario/dispositivo/método de pago (FR-031), cupos atómicos (FR-030), bloqueo con alerta alta (FR-037) |
| Retirar un bono sin jugarlo | Rollover antes de convertir a saldo real (FR-032) |
| Apuestas coordinadas entre cuentas o con información privilegiada | Reglas de apuestas anómalas y cuentas relacionadas (FR-034) |
| Lavado (depositar y retirar sin jugar) | Alerta de retiro tras depósito sin actividad (FR-034), además de la revisión manual de la spec 2 |
| Cambio malicioso de límites o promociones | Solo operador/administrador, auditado con valor anterior y nuevo (FR-039) |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un apostador coloca una apuesta simple, desde elegir la selección hasta ver la
  confirmación, en menos de 30 segundos.
- **SC-002**: En una prueba de 100 apuestas simultáneas sobre la misma billetera, el saldo final
  coincide al centavo con el esperado y nunca es negativo.
- **SC-003**: El 100 % de los intentos de apostar sin saldo, tras el inicio del partido, fuera de
  límites o con una cuota distinta a la vigente se rechazan sin mover dinero.
- **SC-004**: El 95 % de los apostadores conectados ve el resultado de su apuesta en ≤ 5 segundos
  desde que se publica el resultado.
- **SC-005**: Al reprocesar 10 veces el mismo resultado, anulación o corrección, los saldos de todas
  las billeteras quedan idénticos a procesarlo una vez.
- **SC-006**: El 100 % de las apuestas de un partido aplazado fuera de plazo o cancelado se
  reembolsa, y las combinadas afectadas usan cuota 1.00 en la selección anulada.
- **SC-007**: Ningún resultado publicado durante una caída simulada del servicio queda sin liquidar
  tras su recuperación.
- **SC-008**: El 100 % de los intentos de reutilizar un cupón desde el mismo usuario, dispositivo o
  método de pago se rechaza, y el cupo total nunca se supera con canjes simultáneos.
- **SC-009**: Cada patrón de fraude simulado de FR-034 genera su alerta, y un conjunto de actividad
  normal de referencia no genera ninguna.
- **SC-010**: La suma de los movimientos de cada apuesta (descuento, pago, reembolso, reversión)
  cuadra con su estado final con diferencia 0.00 USD.

## Assumptions

- Proyecto académico: sin dinero real; la única moneda es USD.
- **Dependencia de la spec 2**: la billetera, el libro contable, los roles, las sesiones (con IP y
  dispositivo) y la auditoría vienen de la spec 2, ya integrada en `develop`. Esta spec usa su
  billetera real a través de su contrato publicado (débito, crédito, retención y liberación idempotentes sobre saldo real o de
  bono).
- **Dependencia de la spec 3**: partidos, mercados, selecciones, cuotas, estados del partido y
  eventos de resultado vienen de la spec 3, que aún no existe. Esta spec define el contrato mínimo
  que necesita de ella y trabaja contra un sustituto que lo simula; la spec 3 deberá cumplirlo o
  acordar cambios.
- La spec 2 debe notificar a esta spec cuando acredita un depósito (para los bonos de depósito) y
  cuando se solicita un retiro (para la alerta de retiro sin actividad).
- Valores iniciales configurables: apuesta mínima 0.50 USD, máxima 500.00 USD, ganancia máxima
  10 000.00 USD por apuesta, 2 000.00 USD apostados por usuario por día, retardo en vivo 5 s, plazo
  de suspensión 48 h, combinadas de 2 a 10 selecciones, rollover 5× a cuota ≥ 1.50 en 30 días.
- Cualquier cambio de cuota exige reconfirmación (no hay aceptación automática de cuotas mejores).
- Las alertas de fraude no suspenden cuentas automáticamente: lo decide un administrador. La única
  acción automática es bloquear canjes de cupones con alerta alta abierta.
- El dashboard de reportes (volumen, GGR, cupones, alertas) es de la spec 3; esta spec solo genera
  los datos.
- Fuera de alcance: cash out (cobro anticipado), apuestas de sistema, apuestas entre usuarios,
  creación de apuestas por parte de operadores en nombre de usuarios y aceptación automática de
  cambios de cuota.
