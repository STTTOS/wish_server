-- DropForeignKey
ALTER TABLE `MatchStageTimeRecord` DROP FOREIGN KEY `MatchStageTimeRecord_matchId_fkey`;

-- DropForeignKey
ALTER TABLE `Record` DROP FOREIGN KEY `Record_matchId_fkey`;

-- DropForeignKey
ALTER TABLE `Win` DROP FOREIGN KEY `Win_matchId_fkey`;

-- AddForeignKey
ALTER TABLE `MatchStageTimeRecord` ADD CONSTRAINT `MatchStageTimeRecord_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Record` ADD CONSTRAINT `Record_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Win` ADD CONSTRAINT `Win_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
