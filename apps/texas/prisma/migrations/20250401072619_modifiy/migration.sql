/*
  Warnings:

  - You are about to drop the column `playerId` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `stageEndTimes` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `stageStartTimes` on the `Match` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Match` DROP COLUMN `playerId`,
    DROP COLUMN `stageEndTimes`,
    DROP COLUMN `stageStartTimes`,
    MODIFY `totalBetAmount` DOUBLE NULL,
    MODIFY `endStage` ENUM('pre_flop', 'flop', 'turn', 'river') NULL,
    MODIFY `commonPokes` JSON NULL,
    MODIFY `maximumType` ENUM('z', 'y', 'x', 'w', 'v', 'u', 't', 's', 'r', 'q') NULL,
    MODIFY `maximumPokes` JSON NULL;

-- CreateTable
CREATE TABLE `MatchStageTimeRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stage` ENUM('pre_flop', 'flop', 'turn', 'river') NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `matchId` INTEGER NOT NULL,

    UNIQUE INDEX `MatchStageTimeRecord_matchId_stage_key`(`matchId`, `stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MatchStageTimeRecord` ADD CONSTRAINT `MatchStageTimeRecord_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
