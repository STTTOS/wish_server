-- DropForeignKey
ALTER TABLE `discipline_action_snapshot` DROP FOREIGN KEY `decision_skill_snapshot_matchId_fkey`;

-- DropForeignKey
ALTER TABLE `discipline_action_snapshot` DROP FOREIGN KEY `decision_skill_snapshot_userId_fkey`;

-- DropForeignKey
ALTER TABLE `discipline_applied_hand` DROP FOREIGN KEY `decision_skill_applied_hand_matchId_fkey`;

-- AlterTable
ALTER TABLE `discipline_action_snapshot` MODIFY `schemaVersion` INTEGER NOT NULL DEFAULT 2;

-- AddForeignKey
ALTER TABLE `discipline_action_snapshot` ADD CONSTRAINT `discipline_action_snapshot_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discipline_action_snapshot` ADD CONSTRAINT `discipline_action_snapshot_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `discipline_applied_hand` ADD CONSTRAINT `discipline_applied_hand_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
