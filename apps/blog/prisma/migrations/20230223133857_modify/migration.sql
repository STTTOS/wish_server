/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `Article` ADD COLUMN `coAuthorIds` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `isContributor` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `password` VARCHAR(191) NULL,
    ADD COLUMN `role` ENUM('admin', 'user') NULL DEFAULT 'user',
    ADD COLUMN `username` VARCHAR(191) NULL,
    MODIFY `name` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_username_key` ON `User`(`username`);
