-- DropForeignKey
ALTER TABLE `PlayerHand` DROP FOREIGN KEY `PlayerHand_matchId_fkey`;

-- AddForeignKey
ALTER TABLE `PlayerHand` ADD CONSTRAINT `PlayerHand_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
