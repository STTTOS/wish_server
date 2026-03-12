/*
  Warnings:

  - Made the column `role` on table `PlayerMatchRecord` required. This step will fail if there are existing NULL values in that column.
  - Made the column `wager` on table `PlayerMatchRecord` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `PlayerMatchRecord` MODIFY `role` VARCHAR(191) NOT NULL,
    MODIFY `wager` DOUBLE NOT NULL;

-- AlterTable
ALTER TABLE `Room` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `UserRoomStat` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `roomId` INTEGER NOT NULL,
    `matchCount` INTEGER NOT NULL DEFAULT 0,
    `lastMatchAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `totalWager` DOUBLE NOT NULL DEFAULT 0,
    `totalBetAmount` DOUBLE NOT NULL DEFAULT 0,

    UNIQUE INDEX `UserRoomStat_userId_roomId_key`(`userId`, `roomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserRoomStat` ADD CONSTRAINT `UserRoomStat_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRoomStat` ADD CONSTRAINT `UserRoomStat_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
