-- AlterTable
ALTER TABLE `Announcement` MODIFY `type` ENUM('activity', 'update', 'maintenance', 'notice') NOT NULL;
