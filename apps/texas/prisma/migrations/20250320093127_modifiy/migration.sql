/*
  Warnings:

  - You are about to drop the column `matchId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `User` DROP FOREIGN KEY `User_matchId_fkey`;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `matchId`;

-- CreateTable
CREATE TABLE `_MatchToUser` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_MatchToUser_AB_unique`(`A`, `B`),
    INDEX `_MatchToUser_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_MatchToUser` ADD CONSTRAINT `_MatchToUser_A_fkey` FOREIGN KEY (`A`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_MatchToUser` ADD CONSTRAINT `_MatchToUser_B_fkey` FOREIGN KEY (`B`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
