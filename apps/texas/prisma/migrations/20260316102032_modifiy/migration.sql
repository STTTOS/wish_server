/*
  Warnings:

  - You are about to drop the column `action` on the `BetRecord` table. All the data in the column will be lost.
  - Added the required column `actionType` to the `BetRecord` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `BetRecord` DROP COLUMN `action`,
    ADD COLUMN `actionType` ENUM('check', 'fold', 'bet', 'raise', 'allIn', 'call') NOT NULL;
