/*
  Warnings:

  - You are about to drop the column `maxPokes` on the `Match` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Match` DROP COLUMN `maxPokes`,
    ADD COLUMN `bestPokes` JSON NULL;
