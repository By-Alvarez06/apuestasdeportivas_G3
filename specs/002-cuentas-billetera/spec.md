# Feature Specification: Cuentas y billetera

**Feature Branch**: `feature/spec-2`
**Created**: 2026-11-12
**Status**: Draft
**Input**: User description: "Spec 2 — Cuentas y billetera: registro, login, 2FA, roles (RBAC), bloqueo por intentos fallidos, auditoría; ledger de doble entrada con saldo real y de bono; depósitos con Payphone sandbox (confirmación servidor a servidor); retiros con 2FA, mismo titular y revisión manual."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registro e inicio de sesión seguro (Priority: P1)

Una persona crea su cuenta de apostador con correo, contraseña y fecha de nacimiento, confirma su
correo y luego inicia sesión. Si alguien intenta adivinar su contraseña, la cuenta se protege sola.

**Why this priority**: sin identidad no existe billetera ni apuesta; todo lo demás del sistema
depende de saber quién es el usuario y qué rol tiene.

**Independent Test**: registrar una cuenta, verificar el correo, iniciar y cerrar sesión, y
comprobar que tras varios intentos fallidos la cuenta queda bloqueada temporalmente.

**Acceptance Scenarios**:

1. **Given** una persona mayor de edad sin cuenta, **When** se registra con un correo válido y una
   contraseña que cumple la política, **Then** la cuenta se crea con rol apostador, en estado
   "correo sin verificar", y recibe un enlace de verificación.
2. **Given** una persona que declara una fecha de nacimiento de menor de 18 años, **When** intenta
   registrarse, **Then** el registro se rechaza y no se crea ninguna cuenta.
3. **Given** un correo ya registrado, **When** alguien intenta registrarse con él, **Then** el
   sistema responde igual que en un registro exitoso (sin revelar que el correo existe) y avisa al
   dueño del correo por correo.
4. **Given** una cuenta verificada, **When** el usuario inicia sesión con credenciales correctas,
   **Then** obtiene una sesión de corta duración que se renueva sola mientras está activo.
5. **Given** una cuenta, **When** se registran 5 intentos de inicio de sesión fallidos en 15
   minutos, **Then** la cuenta se bloquea 15 minutos, el intento queda auditado y el usuario es
   notificado.
6. **Given** un usuario con sesión iniciada, **When** cierra sesión, **Then** su sesión y su
   renovación dejan de ser válidas de inmediato.

---

### User Story 2 - Billetera con saldo trazable (Priority: P1)

Cada apostador tiene una billetera con saldo real y saldo de bonificación separados. Puede ver su
saldo y el historial de movimientos, y cada movimiento cuadra con un asiento contable.

**Why this priority**: es la base de dinero que necesitan depósitos, retiros y apuestas (spec 4);
debe estar bien antes de que entre o salga dinero.

**Independent Test**: crear una cuenta, aplicar movimientos de prueba (crédito, débito) y comprobar
que el saldo mostrado coincide siempre con la suma de sus movimientos, incluso con operaciones
simultáneas.

**Acceptance Scenarios**:

1. **Given** una cuenta recién verificada, **When** el usuario abre su billetera, **Then** ve saldo
   real 0.00 USD y saldo de bono 0.00 USD.
2. **Given** una billetera con saldo real de 10.00 USD, **When** se solicita un débito de 15.00 USD,
   **Then** la operación se rechaza por saldo insuficiente y el saldo no cambia.
3. **Given** una billetera con 100.00 USD, **When** llegan al mismo tiempo 20 débitos de 10.00 USD,
   **Then** se aceptan exactamente 10, se rechazan los otros 10 y el saldo final es 0.00 USD.
4. **Given** una operación con clave de idempotencia ya procesada, **When** se repite con la misma
   clave, **Then** devuelve el mismo resultado y no genera un segundo movimiento.
5. **Given** un movimiento ya registrado, **When** alguien (incluido un administrador) intenta
   modificarlo o borrarlo, **Then** el sistema no lo permite; la única corrección posible es un
   movimiento compensatorio auditado.

---

### User Story 3 - Depositar con la pasarela de pagos (Priority: P2)

El apostador deposita dinero de prueba con la pasarela de pagos en modo sandbox. El saldo se
acredita solo cuando el sistema confirma el pago directamente con la pasarela.

**Why this priority**: sin depósitos no hay saldo para apostar; depende de la billetera (US2).

**Independent Test**: iniciar un depósito, completarlo en el sandbox de la pasarela y comprobar que
el saldo sube una sola vez, aunque la confirmación llegue repetida.

**Acceptance Scenarios**:

1. **Given** un apostador con correo verificado, **When** solicita depositar 20.00 USD, **Then** se
   registra una intención de pago con monto, moneda y referencia únicos, y se le dirige a la
   pasarela.
2. **Given** un pago completado en la pasarela, **When** el sistema lo confirma con la pasarela y el
   monto, la moneda y la referencia coinciden con la intención, **Then** se acreditan 20.00 USD al
   saldo real.
3. **Given** un usuario que vuelve de la pasarela al sitio, **When** el sistema todavía no ha
   confirmado el pago con la pasarela, **Then** el depósito aparece como "pendiente" y no se acredita
   nada.
4. **Given** una confirmación cuyo monto o referencia no coincide con la intención, **When** se
   procesa, **Then** no se acredita nada, el depósito queda "en revisión" y se genera un registro de
   auditoría.
5. **Given** un depósito ya acreditado, **When** la confirmación se recibe otra vez, **Then** el
   saldo no cambia.
6. **Given** un pago rechazado o abandonado en la pasarela, **When** el sistema lo consulta, **Then**
   el depósito queda "fallido" o "expirado" sin efecto en el saldo.

---

### User Story 4 - Retirar ganancias con 2FA (Priority: P3)

El apostador retira saldo real al mismo titular con el que depositó. Para retirar necesita la
verificación en dos pasos activa, y los retiros grandes los revisa un administrador.

**Why this priority**: cierra el ciclo del dinero, pero el sistema es usable sin retiros; depende de
US1 (2FA), US2 y US3 (titular del depósito).

**Independent Test**: activar 2FA, solicitar un retiro bajo el umbral y uno sobre el umbral, y
comprobar que el primero se procesa y el segundo espera aprobación; sin 2FA, ambos se rechazan.

**Acceptance Scenarios**:

1. **Given** un apostador sin 2FA activa, **When** intenta retirar, **Then** se le pide activar 2FA y
   el retiro no se crea.
2. **Given** un apostador sin 2FA, **When** la activa por primera vez, **Then** recibe
   códigos de recuperación de un solo uso.
3. **Given** un apostador con 2FA y 50.00 USD de saldo real, **When** solicita retirar 30.00 USD con
   un código 2FA válido, **Then** los 30.00 USD quedan retenidos (no disponibles para apostar) y el
   retiro queda "en proceso".
4. **Given** un retiro, **When** el destino no corresponde al titular de los depósitos previos,
   **Then** el retiro se rechaza y queda auditado.
5. **Given** un retiro por encima del umbral de revisión, **When** se solicita, **Then** queda
   "pendiente de aprobación" hasta que un administrador lo apruebe o rechace; si lo rechaza, el monto
   retenido vuelve al saldo real.
6. **Given** un apostador, **When** intenta retirar saldo de bono, **Then** el sistema no lo permite.

---

### User Story 5 - Roles y auditoría para la administración (Priority: P3)

Un administrador gestiona roles de usuario y consulta el registro de auditoría de acciones
sensibles. Cada función del sistema solo está disponible para los roles autorizados.

**Why this priority**: operadores y administradores necesitan sus permisos para las specs 3 y 4,
pero el flujo del apostador funciona sin esta pantalla.

**Independent Test**: con un administrador, cambiar el rol de un usuario y ver el cambio en la
auditoría; con un apostador, intentar acceder a funciones de administración y recibir acceso
denegado.

**Acceptance Scenarios**:

1. **Given** un administrador, **When** asigna el rol operador a un usuario, **Then** el cambio se
   aplica y queda en la auditoría con quién, qué, cuándo, IP y dispositivo.
2. **Given** un apostador u operador, **When** intenta una acción de administración, **Then** recibe
   acceso denegado y el intento queda auditado.
3. **Given** un administrador, **When** intenta quitarse a sí mismo el rol de administrador siendo
   el único, **Then** el sistema lo impide.
4. **Given** un administrador, **When** consulta la auditoría, **Then** puede filtrar por usuario,
   tipo de acción y rango de fechas, pero no puede editar ni borrar registros.

---

### Edge Cases

- Dos solicitudes simultáneas de retiro que juntas superan el saldo: solo se acepta la que cabe.
- La pasarela no responde al confirmar un depósito: el depósito queda pendiente y se reintenta la
  confirmación; nunca se acredita sin confirmación.
- Intención de pago que nunca se completa: expira a las 24 horas.
- Enlace de verificación de correo usado dos veces o caducado (más de 24 horas): se rechaza y se
  ofrece reenviarlo.
- Sesión renovada con un token de renovación ya usado (posible robo): se cierran todas las sesiones
  del usuario y se audita.
- Usuario pierde el dispositivo de 2FA: puede usar un código de recuperación; cada código sirve una
  sola vez.
- Retiro solicitado poco después de un depósito sin actividad de apuestas: se marca para revisión
  manual aunque esté bajo el umbral.
- Cuenta bloqueada o suspendida por un administrador: no puede iniciar sesión, depositar ni retirar;
  su saldo se conserva.
- Montos con más de 2 decimales o negativos: se rechazan.

## Requirements *(mandatory)*

### Functional Requirements

**Identidad y acceso**

- **FR-001**: El sistema DEBE permitir registrarse con correo, contraseña y fecha de nacimiento, y
  rechazar a menores de 18 años.
- **FR-002**: El sistema DEBE exigir contraseñas de al menos 10 caracteres que no estén en listas de
  contraseñas filtradas, y guardarlas solo con un hash resistente a ataques de fuerza bruta.
- **FR-003**: El sistema DEBE exigir verificación de correo antes de depositar, retirar o apostar.
- **FR-004**: El sistema DEBE usar sesiones de corta duración (15 minutos) con renovación rotativa
  (7 días); un token de renovación solo sirve una vez.
- **FR-005**: El sistema DEBE bloquear la cuenta 15 minutos tras 5 intentos fallidos en 15 minutos,
  limitar la frecuencia de intentos por IP y pedir una verificación anti-bots en registro e inicio de
  sesión.
- **FR-006**: Los mensajes de error de registro, inicio de sesión y recuperación NO DEBEN revelar si
  un correo está registrado.
- **FR-007**: El sistema DEBE permitir activar verificación en dos pasos con códigos temporales de
  aplicación autenticadora, entregar 10 códigos de recuperación de un solo uso y exigirla para
  retirar.
- **FR-008**: El sistema DEBE permitir recuperar la contraseña mediante un enlace de un solo uso
  enviado al correo, que caduca en 1 hora y cierra todas las sesiones al usarse.
- **FR-009**: El sistema DEBE tener los roles apostador, operador y administrador; toda función DEBE
  denegar el acceso por defecto y permitirlo solo a los roles autorizados.
- **FR-010**: Solo un administrador DEBE poder cambiar roles o suspender cuentas, y el sistema DEBE
  impedir que quede sin ningún administrador.

**Auditoría**

- **FR-011**: El sistema DEBE registrar en una auditoría de solo agregar cada acción sensible:
  registro, inicio de sesión (exitoso y fallido), bloqueo, cambio de contraseña, activación de 2FA,
  cambio de rol, depósito, retiro, aprobación o rechazo, y corrección contable; con quién, qué,
  cuándo, IP y dispositivo.
- **FR-012**: Nadie DEBE poder modificar ni borrar registros de auditoría; los administradores pueden
  consultarlos con filtros.

**Billetera y libro contable**

- **FR-013**: Cada apostador DEBE tener una billetera en USD con saldo real y saldo de bono separados.
- **FR-014**: Todo movimiento de dinero DEBE registrarse como asiento de doble entrada (débito y
  crédito por el mismo monto) en un libro contable inmutable; el saldo DEBE calcularse a partir del
  libro y nunca editarse directamente.
- **FR-015**: Las correcciones DEBEN hacerse con asientos compensatorios, solo por un administrador,
  con motivo obligatorio y auditados.
- **FR-016**: Toda operación que reduzca saldo DEBE validar el saldo disponible y registrar el
  movimiento de forma atómica, de modo que operaciones simultáneas nunca dejen saldo negativo.
- **FR-017**: Toda operación de dinero DEBE aceptar una clave de idempotencia; repetirla DEBE
  devolver el mismo resultado sin un segundo efecto.
- **FR-018**: La billetera DEBE ofrecer a otras funcionalidades (apuestas, liquidación, cupones de la
  spec 4) operaciones de débito, crédito, retención y liberación con referencia al origen, sobre
  saldo real o de bono.
- **FR-019**: El apostador DEBE poder ver su saldo real, de bono, retenido y su historial de
  movimientos paginado y filtrable por tipo y fecha.
- **FR-020**: Los montos DEBEN manejarse con exactitud de 2 decimales, sin errores de redondeo.

**Depósitos**

- **FR-021**: El sistema DEBE permitir depósitos entre 1.00 y 1 000.00 USD (límites configurables)
  mediante la pasarela de pagos en modo sandbox.
- **FR-022**: Cada depósito DEBE empezar con una intención de pago registrada con monto, moneda y
  referencia única.
- **FR-023**: El saldo DEBE acreditarse solo cuando el sistema confirma el pago directamente con la
  pasarela y verifica que monto, moneda y referencia coinciden con la intención; el regreso del
  navegador nunca acredita saldo.
- **FR-024**: Las notificaciones entrantes de la pasarela DEBEN verificarse (firma o consulta a la
  pasarela) antes de producir cualquier efecto.
- **FR-025**: Un depósito DEBE tener los estados pendiente, acreditado, fallido, expirado y en
  revisión; una confirmación con datos que no coinciden lo deja en revisión.

**Retiros**

- **FR-026**: El sistema DEBE permitir retirar solo saldo real, con 2FA activa y un código válido en
  el momento de la solicitud.
- **FR-027**: El destino del retiro DEBE corresponder al mismo titular y método usados en los
  depósitos del usuario.
- **FR-028**: Al solicitar un retiro, el monto DEBE quedar retenido; si el retiro se rechaza o
  falla, DEBE liberarse al saldo real.
- **FR-029**: Los retiros por encima de 200.00 USD (umbral configurable), o solicitados dentro de las
  24 horas posteriores a un depósito sin apuestas intermedias, DEBEN quedar pendientes de aprobación
  de un administrador.
- **FR-030**: Si la pasarela no admite pagos salientes en sandbox, el retiro aprobado DEBE marcarse
  como pagado con una referencia simulada, registrada en el libro contable.

### Key Entities

- **Usuario**: persona con correo, fecha de nacimiento, estado (sin verificar, activo, bloqueado,
  suspendido), rol y configuración de 2FA.
- **Sesión**: acceso iniciado por un usuario desde un dispositivo; tiene token de renovación
  rotativo y puede revocarse.
- **Registro de auditoría**: hecho inmutable con actor, acción, objetivo, fecha, IP y dispositivo.
- **Billetera**: pertenece a un apostador; agrupa sus cuentas contables de saldo real, bono y
  retenido.
- **Cuenta contable**: cuenta del libro (saldo real del usuario, bono del usuario, retenido, casa,
  pasarela); su saldo es la suma de sus asientos.
- **Asiento contable**: movimiento inmutable que debita una cuenta y acredita otra por el mismo
  monto, con tipo, referencia al origen y clave de idempotencia.
- **Intención de pago / Depósito**: monto, moneda, referencia única, titular del pago y estado.
- **Retiro**: monto, destino, titular, estado (en proceso, pendiente de aprobación, aprobado,
  pagado, rechazado), y quién lo aprobó.

## Vectores de fraude y mitigación

| Vector | Mitigación |
|--------|------------|
| Fuerza bruta o relleno de credenciales | Bloqueo por intentos (FR-005), límite por IP, verificación anti-bots, mensajes neutros (FR-006) |
| Robo de sesión | Sesión corta, renovación rotativa de un solo uso y cierre total si se reutiliza (FR-004) |
| Doble gasto por concurrencia | Validación y débito atómicos (FR-016) |
| Doble acreditación de un depósito | Idempotencia (FR-017) y confirmación única por referencia (FR-023) |
| Depósito falso desde el navegador | Solo la confirmación servidor a servidor acredita (FR-023, FR-024) |
| Monto alterado en la pasarela | Verificación de monto, moneda y referencia contra la intención (FR-023) |
| Retiro a cuenta de un tercero | Mismo titular y método (FR-027), 2FA obligatoria (FR-026) |
| Lavado (depositar y retirar sin jugar) | Revisión manual de retiros tras depósito sin actividad (FR-029) |
| Retiro de bono | Solo saldo real es retirable (FR-026) |
| Saldo inventado o editado | Saldo derivado del libro inmutable; correcciones solo compensatorias y auditadas (FR-014, FR-015) |
| Escalada de privilegios | Acceso denegado por defecto, cambios de rol solo por administrador y auditados (FR-009, FR-010) |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona completa el registro, la verificación de correo y el primer inicio de
  sesión en menos de 3 minutos.
- **SC-002**: En una prueba de 100 operaciones simultáneas sobre la misma billetera, el saldo final
  coincide al centavo con el esperado y nunca es negativo.
- **SC-003**: Al repetir 10 veces la misma confirmación de depósito, el saldo aumenta exactamente una
  vez.
- **SC-004**: El 100 % de los depósitos acreditados tiene una confirmación de la pasarela cuyo monto,
  moneda y referencia coinciden con su intención.
- **SC-005**: El saldo de cualquier billetera puede reconstruirse desde su historial de movimientos
  con diferencia 0.00 USD.
- **SC-006**: El 100 % de los intentos de retiro sin 2FA, a otro titular o de saldo de bono se
  rechazan.
- **SC-007**: El 100 % de las funciones probadas con un rol no autorizado responden acceso denegado.
- **SC-008**: Un depósito confirmado aparece en el saldo del usuario en menos de 10 segundos desde
  la confirmación de la pasarela.
- **SC-009**: Toda acción sensible listada en FR-011 aparece en la auditoría con sus 5 datos (quién,
  qué, cuándo, IP, dispositivo).

## Assumptions

- Proyecto académico: no hay dinero real; la única moneda es USD y la pasarela se usa en sandbox.
- "Verificar identidad" se limita a verificación de correo y declaración de fecha de nacimiento; no
  hay verificación documental.
- Las cuentas de operador y administrador no se crean por registro público: el primer administrador
  se crea con un proceso de arranque y luego asigna roles.
- El envío de correos (verificación, recuperación, avisos) usa un proveedor de correo de prueba.
- Los umbrales (intentos de inicio de sesión, límites de depósito, umbral de revisión de retiros)
  son configurables; los valores de esta spec son los iniciales.
- El saldo de bono lo acreditan los cupones de la spec 4; esta spec solo provee la cuenta separada y
  las operaciones de billetera.
- Depende de la spec 1 (monorepo, base de datos y CI). Las specs 3 y 4 dependen de los roles y de la
  billetera definidos aquí.
- Fuera de alcance: inicio de sesión con redes sociales, verificación documental (KYC), múltiples
  monedas y aplicaciones móviles nativas.
