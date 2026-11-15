-- CreateEnum
CREATE TYPE "BetType" AS ENUM ('SINGLE', 'COMBO');

-- CreateEnum
CREATE TYPE "StakeSource" AS ENUM ('REAL', 'BONUS', 'FREE_BET');

-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'VOID');

-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'VOID');

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('MARKET_RESULTED', 'MATCH_STATUS_CHANGED', 'RESULT_CORRECTED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('SUSPENDED', 'POSTPONED');

-- CreateEnum
CREATE TYPE "HoldResolution" AS ENUM ('RESUMED', 'VOIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('DEPOSIT_BONUS', 'FREE_BET', 'ODDS_BOOST');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('AWAITING_DEPOSIT', 'GRANTED', 'AVAILABLE', 'USED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BonusStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FraudRule" AS ENUM ('MULTI_ACCOUNT', 'ANOMALOUS_STAKE', 'ODDS_DROP_PATTERN', 'MIRROR_BETS', 'WITHDRAWAL_NO_ACTIVITY', 'RESETTLEMENT_DEBT');

-- CreateEnum
CREATE TYPE "FraudSeverity" AS ENUM ('MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'DISMISSED', 'CONFIRMED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerTransactionType" ADD VALUE 'BET_REFUND';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'BET_REVERSAL';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'DEBT_COLLECTION';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'BONUS_CONVERSION';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'BONUS_EXPIRY';

-- CreateTable
CREATE TABLE "Bet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestKey" TEXT NOT NULL,
    "type" "BetType" NOT NULL,
    "stake" INTEGER NOT NULL,
    "source" "StakeSource" NOT NULL,
    "totalOddsX" TEXT NOT NULL,
    "potentialPayout" INTEGER NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'OPEN',
    "settledVersion" INTEGER NOT NULL DEFAULT 0,
    "payout" INTEGER NOT NULL DEFAULT 0,
    "couponRedemptionId" UUID,
    "freeBetId" UUID,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT,
    "ip" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetSelection" (
    "id" UUID NOT NULL,
    "betId" UUID NOT NULL,
    "selectionId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "odds" INTEGER NOT NULL,
    "status" "SelectionStatus" NOT NULL DEFAULT 'PENDING',
    "resultVersion" INTEGER NOT NULL DEFAULT 0,
    "matchLabel" TEXT NOT NULL,
    "marketLabel" TEXT NOT NULL,
    "selectionLabel" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" UUID NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "type" "MatchEventType" NOT NULL,
    "matchId" TEXT NOT NULL,
    "marketId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetSettlement" (
    "id" UUID NOT NULL,
    "betId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "outcome" "BetStatus" NOT NULL,
    "payout" INTEGER NOT NULL,
    "reversedAmount" INTEGER NOT NULL DEFAULT 0,
    "matchEventId" UUID NOT NULL,
    "ledgerTransactionIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchHold" (
    "matchId" TEXT NOT NULL,
    "status" "HoldStatus" NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolution" "HoldResolution",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchHold_pkey" PRIMARY KEY ("matchId")
);

-- CreateTable
CREATE TABLE "BetDebt" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "betId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "collected" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "BetDebt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BettingSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BettingSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL,
    "cap" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "totalLimit" INTEGER NOT NULL,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "payerKey" TEXT,
    "status" "RedemptionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bonus" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "redemptionId" UUID,
    "amount" INTEGER NOT NULL,
    "wagerRequired" INTEGER NOT NULL,
    "wagerProgress" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "BonusStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Bonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreeBet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "redemptionId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreeBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAlert" (
    "id" UUID NOT NULL,
    "rule" "FraudRule" NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "userIds" UUID[],
    "evidence" JSONB NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bet_freeBetId_key" ON "Bet"("freeBetId");

-- CreateIndex
CREATE INDEX "Bet_userId_acceptedAt_idx" ON "Bet"("userId", "acceptedAt");

-- CreateIndex
CREATE INDEX "Bet_status_idx" ON "Bet"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_userId_requestKey_key" ON "Bet"("userId", "requestKey");

-- CreateIndex
CREATE INDEX "BetSelection_selectionId_idx" ON "BetSelection"("selectionId");

-- CreateIndex
CREATE INDEX "BetSelection_marketId_idx" ON "BetSelection"("marketId");

-- CreateIndex
CREATE INDEX "BetSelection_matchId_idx" ON "BetSelection"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "BetSelection_betId_matchId_key" ON "BetSelection"("betId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchEvent_sourceEventId_key" ON "MatchEvent"("sourceEventId");

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_idx" ON "MatchEvent"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "BetSettlement_betId_version_key" ON "BetSettlement"("betId", "version");

-- CreateIndex
CREATE INDEX "MatchHold_resolvedAt_deadline_idx" ON "MatchHold"("resolvedAt", "deadline");

-- CreateIndex
CREATE INDEX "BetDebt_userId_closedAt_idx" ON "BetDebt"("userId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_userId_key" ON "CouponRedemption"("couponId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_deviceId_key" ON "CouponRedemption"("couponId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_payerKey_key" ON "CouponRedemption"("couponId", "payerKey");

-- CreateIndex
CREATE UNIQUE INDEX "Bonus_redemptionId_key" ON "Bonus"("redemptionId");

-- CreateIndex
CREATE INDEX "Bonus_status_expiresAt_idx" ON "Bonus"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FreeBet_redemptionId_key" ON "FreeBet"("redemptionId");

-- CreateIndex
CREATE INDEX "FreeBet_userId_usedAt_idx" ON "FreeBet"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "FraudAlert_status_createdAt_idx" ON "FraudAlert"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetSelection" ADD CONSTRAINT "BetSelection_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetSettlement" ADD CONSTRAINT "BetSettlement_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetSettlement" ADD CONSTRAINT "BetSettlement_matchEventId_fkey" FOREIGN KEY ("matchEventId") REFERENCES "MatchEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetDebt" ADD CONSTRAINT "BetDebt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetDebt" ADD CONSTRAINT "BetDebt_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bonus" ADD CONSTRAINT "Bonus_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "CouponRedemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreeBet" ADD CONSTRAINT "FreeBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreeBet" ADD CONSTRAINT "FreeBet_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "CouponRedemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
