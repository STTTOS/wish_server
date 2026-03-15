/*
  Warnings:

  - You are about to drop the column `maximumType` on the `Match` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Match` DROP COLUMN `maximumType`,
    ADD COLUMN `maximumPresentation` ENUM('z', 'y', 'x', 'w', 'v', 'u', 't', 's', 'r', 'q') NULL;
