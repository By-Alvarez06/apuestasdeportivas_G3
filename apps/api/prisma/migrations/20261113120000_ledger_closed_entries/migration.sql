-- Un asiento confirmado queda cerrado: solo se le pueden añadir líneas en la misma transacción de base de
-- datos que lo creó. Sin esto, dos líneas compensadas (suma 0) cambiarían saldos de un asiento histórico.
CREATE FUNCTION forbid_posting_on_closed_transaction() RETURNS trigger AS $$
BEGIN
  IF (SELECT xmin FROM "LedgerTransaction" WHERE id = NEW."transactionId") <> pg_current_xact_id()::xid THEN
    RAISE EXCEPTION 'El asiento % ya está cerrado: registra una corrección nueva', NEW."transactionId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerPosting_closed_transaction"
  BEFORE INSERT ON "LedgerPosting"
  FOR EACH ROW EXECUTE FUNCTION forbid_posting_on_closed_transaction();
