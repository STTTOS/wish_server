/*
  Warnings:

  - You are about to drop the `PlayerHand` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Record` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Win` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `PlayerHand` DROP FOREIGN KEY `PlayerHand_matchId_fkey`;

-- DropForeignKey
ALTER TABLE `PlayerHand` DROP FOREIGN KEY `PlayerHand_playerId_fkey`;

-- DropForeignKey
ALTER TABLE `Record` DROP FOREIGN KEY `Record_matchId_fkey`;

-- DropForeignKey
ALTER TABLE `Record` DROP FOREIGN KEY `Record_playerId_fkey`;

-- DropForeignKey
ALTER TABLE `Win` DROP FOREIGN KEY `Win_matchId_fkey`;

-- DropForeignKey
ALTER TABLE `Win` DROP FOREIGN KEY `Win_playerId_fkey`;

-- DropTable
DROP TABLE `PlayerHand`;

-- DropTable
DROP TABLE `Record`;

-- DropTable
DROP TABLE `Win`;

-- CreateTable
CREATE TABLE `PlayerMatchRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matchId` INTEGER NOT NULL,
    `playerId` INTEGER NOT NULL,
    `hand` JSON NOT NULL,
    `role` VARCHAR(191) NULL,
    `wager` DOUBLE NULL,
    `presentation` ENUM('z', 'y', 'x', 'w', 'v', 'u', 't', 's', 'r', 'q') NOT NULL,
    `totalBetAmount` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BetRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `action` ENUM('check', 'fold', 'bet', 'raise', 'allIn', 'call') NOT NULL,
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `stage` ENUM('pre_flop', 'flop', 'turn', 'river') NOT NULL,
    `playerId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matchId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlayerMatchRecord` ADD CONSTRAINT `PlayerMatchRecord_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlayerMatchRecord` ADD CONSTRAINT `PlayerMatchRecord_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BetRecord` ADD CONSTRAINT `BetRecord_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BetRecord` ADD CONSTRAINT `BetRecord_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
