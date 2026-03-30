-- Add activeOwnerId as DB hard constraint for active room ownership.
ALTER TABLE `Room` ADD COLUMN `activeOwnerId` INTEGER NULL;

-- Backfill active rooms only.
UPDATE `Room`
SET `activeOwnerId` = `ownerId`
WHERE `deletedAt` IS NULL;

-- Enforce one active room per owner.
CREATE UNIQUE INDEX `Room_activeOwnerId_key` ON `Room`(`activeOwnerId`);

