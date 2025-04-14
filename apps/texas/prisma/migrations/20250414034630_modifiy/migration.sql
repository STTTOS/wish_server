/*
  Warnings:

  - Made the column `uuid` on table `Room` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `Room` MODIFY `uuid` VARCHAR(191) NOT NULL;
