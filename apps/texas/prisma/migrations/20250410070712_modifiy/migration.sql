/*
  Warnings:

  - You are about to drop the `_MatchToUser` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `_MatchToUser` DROP FOREIGN KEY `_MatchToUser_A_fkey`;

-- DropForeignKey
ALTER TABLE `_MatchToUser` DROP FOREIGN KEY `_MatchToUser_B_fkey`;

-- DropTable
DROP TABLE `_MatchToUser`;
