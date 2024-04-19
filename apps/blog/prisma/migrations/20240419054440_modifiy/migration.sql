/*
  Warnings:

  - The values [system] on the enum `Message_type` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `Message` MODIFY `type` ENUM('reply', 'like') NOT NULL;
