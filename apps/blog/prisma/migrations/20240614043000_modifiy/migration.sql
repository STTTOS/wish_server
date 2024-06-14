-- AlterTable
ALTER TABLE `Message` MODIFY `type` ENUM('system', 'reply', 'like', 'comment') NOT NULL;
