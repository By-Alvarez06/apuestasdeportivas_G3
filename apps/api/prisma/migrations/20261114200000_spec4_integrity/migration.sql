-- Garantías de la spec 4 que no dependen del código (constitución II, FR-010, FR-015, FR-030).
-- Ver specs/004-apuestas-liquidacion/data-model.md.

-- ── Valores válidos ─────────────────────────────────────────────────────────

ALTER TABLE "Bet" ADD CONSTRAINT "Bet_stake_positive" CHECK ("stake" > 0);
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_potentialPayout_positive" CHECK ("potentialPayout" > 0);
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_payout_nonnegative" CHECK ("payout" >= 0);
ALTER TABLE "BetSelection" ADD CONSTRAINT "BetSelection_odds_min" CHECK ("odds" >= 101);
ALTER TABLE "BetSettlement" ADD CONSTRAINT "BetSettlement_amounts_nonnegative"
  CHECK ("payout" >= 0 AND "reversedAmount" >= 0 AND "version" > 0);
ALTER TABLE "BetDebt" ADD CONSTRAINT "BetDebt_amounts_valid"
  CHECK ("amount" > 0 AND "collected" >= 0 AND "collected" <= "amount");
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_values_valid"
  CHECK ("value" > 0 AND "totalLimit" > 0 AND "perUserLimit" > 0 AND "redeemed" >= 0
         AND "redeemed" <= "totalLimit" AND "endsAt" > "startsAt");
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_amounts_valid"
  CHECK ("amount" > 0 AND "wagerRequired" >= 0 AND "wagerProgress" >= 0);
ALTER TABLE "FreeBet" ADD CONSTRAINT "FreeBet_amount_positive" CHECK ("amount" > 0);

-- ── Unicidad parcial ────────────────────────────────────────────────────────

-- Un solo bono activo por usuario (research R10).
CREATE UNIQUE INDEX "Bonus_one_active_per_user" ON "Bonus" ("userId") WHERE "status" = 'ACTIVE';

-- Una sola alerta abierta por regla y sujeto (research R11).
CREATE UNIQUE INDEX "FraudAlert_one_open_per_subject" ON "FraudAlert" ("rule", "subjectKey")
  WHERE "status" = 'OPEN';

-- Una sola deuda abierta por apuesta.
CREATE UNIQUE INDEX "BetDebt_one_open_per_bet" ON "BetDebt" ("betId") WHERE "closedAt" IS NULL;

-- ── Sin borrados ────────────────────────────────────────────────────────────
-- forbid_mutation() viene de la migración ledger_immutability de la spec 2.

CREATE TRIGGER "Bet_no_delete" BEFORE DELETE ON "Bet"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "BetSelection_no_delete" BEFORE DELETE ON "BetSelection"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "CouponRedemption_no_delete" BEFORE DELETE ON "CouponRedemption"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "Bonus_no_delete" BEFORE DELETE ON "Bonus"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "FreeBet_no_delete" BEFORE DELETE ON "FreeBet"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "BetDebt_no_delete" BEFORE DELETE ON "BetDebt"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "FraudAlert_no_delete" BEFORE DELETE ON "FraudAlert"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Liquidaciones: de solo agregar (cada re-liquidación es una versión nueva).
CREATE TRIGGER "BetSettlement_append_only" BEFORE UPDATE OR DELETE ON "BetSettlement"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Columnas inmutables ─────────────────────────────────────────────────────

-- Una apuesta aceptada no cambia de dueño, monto, origen, tipo ni cuota (FR-010); solo su estado.
CREATE FUNCTION bet_immutable_columns() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."requestKey" IS DISTINCT FROM OLD."requestKey"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."stake" IS DISTINCT FROM OLD."stake"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."totalOddsX" IS DISTINCT FROM OLD."totalOddsX"
     OR NEW."potentialPayout" IS DISTINCT FROM OLD."potentialPayout"
     OR NEW."couponRedemptionId" IS DISTINCT FROM OLD."couponRedemptionId"
     OR NEW."freeBetId" IS DISTINCT FROM OLD."freeBetId"
     OR NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt" THEN
    RAISE EXCEPTION 'Bet: los datos de una apuesta aceptada no se modifican';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Bet_immutable_columns" BEFORE UPDATE ON "Bet"
  FOR EACH ROW EXECUTE FUNCTION bet_immutable_columns();

CREATE FUNCTION bet_selection_immutable_columns() RETURNS trigger AS $$
BEGIN
  IF NEW."betId" IS DISTINCT FROM OLD."betId"
     OR NEW."selectionId" IS DISTINCT FROM OLD."selectionId"
     OR NEW."marketId" IS DISTINCT FROM OLD."marketId"
     OR NEW."matchId" IS DISTINCT FROM OLD."matchId"
     OR NEW."odds" IS DISTINCT FROM OLD."odds"
     OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt" THEN
    RAISE EXCEPTION 'BetSelection: la selección y su cuota congelada no se modifican';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BetSelection_immutable_columns" BEFORE UPDATE ON "BetSelection"
  FOR EACH ROW EXECUTE FUNCTION bet_selection_immutable_columns();

-- Eventos de resultado: solo se marca que se procesaron.
CREATE FUNCTION match_event_only_processed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MatchEvent es de solo agregar: DELETE no permitido';
  END IF;
  IF NEW."sourceEventId" IS DISTINCT FROM OLD."sourceEventId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."matchId" IS DISTINCT FROM OLD."matchId"
     OR NEW."marketId" IS DISTINCT FROM OLD."marketId"
     OR NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt" THEN
    RAISE EXCEPTION 'MatchEvent: solo processedAt puede cambiar';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MatchEvent_only_processed" BEFORE UPDATE OR DELETE ON "MatchEvent"
  FOR EACH ROW EXECUTE FUNCTION match_event_only_processed();
