-- AlterTable
ALTER TABLE `RoadSign` ADD COLUMN `rectifyStatus` ENUM('none', 'todo', 'done') NOT NULL DEFAULT 'none',
    ADD COLUMN `rectifyPhotos` JSON NOT NULL DEFAULT ('[]');

-- CreateIndex
CREATE INDEX `RoadSign_rectifyStatus_idx` ON `RoadSign`(`rectifyStatus`);
