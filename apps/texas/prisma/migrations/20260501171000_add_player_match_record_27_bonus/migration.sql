-- AlterTable
ALTER TABLE `PlayerMatchRecord`
    ADD COLUMN `sevenTwoBonusPaid` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `sevenTwoBonusReceived` INTEGER NOT NULL DEFAULT 0;
