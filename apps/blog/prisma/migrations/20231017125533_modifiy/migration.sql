/*
  Warnings:

  - Made the column `private` on table `Article` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `Article` MODIFY `private` BOOLEAN NOT NULL DEFAULT false;
