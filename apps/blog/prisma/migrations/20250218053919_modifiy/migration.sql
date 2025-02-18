-- AlterTable
ALTER TABLE `Timeline` ADD COLUMN `order` ENUM('desc', 'asc') NULL DEFAULT 'desc';
