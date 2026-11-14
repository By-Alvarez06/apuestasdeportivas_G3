CREATE UNIQUE INDEX "Market_matchId_type_no_line_key"
  ON "Market" ("matchId", "type")
  WHERE "line" IS NULL;

ALTER TABLE "Market"
  ADD CONSTRAINT "Market_type_line_check"
  CHECK (
    ("type" = 'total_goals' AND "line" IS NOT NULL AND "line" > 0)
    OR ("type" <> 'total_goals' AND "line" IS NULL)
  );

ALTER TABLE "Selection"
  ADD CONSTRAINT "Selection_odds_above_one_check"
  CHECK ("odds" > 1);

ALTER TABLE "Match"
  ADD CONSTRAINT "Match_nonnegative_score_check"
  CHECK (
    ("homeScore" IS NULL AND "awayScore" IS NULL)
    OR ("homeScore" >= 0 AND "awayScore" >= 0)
  );

CREATE FUNCTION forbid_odds_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El historial de cuotas es inmutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OddsHistory_immutable"
  BEFORE UPDATE OR DELETE ON "OddsHistory"
  FOR EACH ROW EXECUTE FUNCTION forbid_odds_history_mutation();
