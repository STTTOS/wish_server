-- AlterTable
ALTER TABLE `Message` MODIFY `type` ENUM('reply', 'like', 'comment') NOT NULL;
