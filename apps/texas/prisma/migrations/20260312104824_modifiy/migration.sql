-- AlterTable
ALTER TABLE `PlayerMatchRecord` MODIFY `wager` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `totalBetAmount` INTEGER NOT NULL DEFAULT 0;
