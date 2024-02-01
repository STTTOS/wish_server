-- AlterTable
ALTER TABLE `EBook` MODIFY `category` ENUM('fiction', 'economics', 'philosophy', 'professional', 'non_fiction', 'other') NULL DEFAULT 'other';
