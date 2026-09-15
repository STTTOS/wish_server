-- AlterTable
ALTER TABLE `RoadSign` MODIFY `type` ENUM('existing', 'planned', 'pending') NOT NULL;
