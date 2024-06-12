/*
  Warnings:

  - You are about to drop the column `articleId` on the `Message` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `Message` DROP FOREIGN KEY `Message_articleId_fkey`;

-- AlterTable
ALTER TABLE `Message` DROP COLUMN `articleId`;
