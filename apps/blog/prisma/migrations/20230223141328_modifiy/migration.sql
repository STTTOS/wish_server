/*
  Warnings:

  - You are about to alter the column `category` on the `EBook` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum("EBook_category")`.

*/
-- AlterTable
ALTER TABLE `EBook` MODIFY `category` ENUM('fiction', 'economics', 'philosophy', 'professional', 'non_fiction', 'other') NOT NULL;
