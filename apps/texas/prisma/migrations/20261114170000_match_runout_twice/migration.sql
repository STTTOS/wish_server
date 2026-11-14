-- AlterTable
ALTER TABLE `Match` ADD COLUMN `commonPokesRun2` JSON NULL,
    ADD COLUMN `runCount` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `settlementRuns` JSON NULL;
