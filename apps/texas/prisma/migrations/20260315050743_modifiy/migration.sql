/*
  Warnings:

  - You are about to drop the column `maximumPokes` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `maximumPresentation` on the `Match` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Match` DROP COLUMN `maximumPokes`,
    DROP COLUMN `maximumPresentation`,
    ADD COLUMN `maxPokes` JSON NULL,
    ADD COLUMN `maxPresentation` ENUM('z', 'y', 'x', 'w', 'v', 'u', 't', 's', 'r', 'q') NULL;
