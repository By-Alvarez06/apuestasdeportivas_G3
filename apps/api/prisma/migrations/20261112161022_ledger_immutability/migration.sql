-- Garantías del libro contable y la auditoría que no dependen del código (constitución II, FR-012, FR-014).

-- Cuentas del sistema (userId NULL) únicas por tipo; el @@unique de Prisma no lo cubre porque NULL ≠ NULL.
CREATE UNIQUE INDEX "LedgerAccount_system_type_key" ON "LedgerAccount" ("type") WHERE "userId" IS NULL;

-- Las cuentas USER_* siempre pertenecen a un usuario y las del sistema nunca.
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_owner_check" CHECK (
  ("type" IN ('USER_REAL', 'USER_BONUS', 'USER_HELD')) = ("userId" IS NOT NULL)
);

ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_amount_nonzero" CHECK ("amount" <> 0);

ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_amount_positive" CHECK ("amount" > 0);

-- Append-only: ninguna fila se edita ni se borra. Las correcciones son asientos compensatorios.
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  -- ERRCODE por defecto (P0001): con restrict_violation Prisma lo reporta como error de FK y oculta el mensaje.
  RAISE EXCEPTION '% es de solo agregar: % no permitido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER "LedgerTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER "LedgerPosting_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerPosting"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Doble entrada: al confirmar la transacción de base de datos, las líneas de cada asiento suman 0.
CREATE FUNCTION check_ledger_transaction_balanced() RETURNS trigger AS $$
DECLARE
  total bigint;
BEGIN
  SELECT COALESCE(SUM("amount"), 0) INTO total
    FROM "LedgerPosting" WHERE "transactionId" = NEW."transactionId";
  IF total <> 0 THEN
    RAISE EXCEPTION 'Asiento % descuadrado: suma %', NEW."transactionId", total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "LedgerPosting_balanced"
  AFTER INSERT ON "LedgerPosting"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_ledger_transaction_balanced();
