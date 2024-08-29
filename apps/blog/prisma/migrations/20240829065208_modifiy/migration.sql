/*
  Warnings:

  - You are about to drop the column `body` on the `Article` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Article` DROP COLUMN `body`;

-- AlterTable
ALTER TABLE `Comment` ADD COLUMN `body` JSON NULL;
