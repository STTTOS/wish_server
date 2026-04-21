ALTER TABLE `Room`
  ADD COLUMN `activeCode` VARCHAR(191) NULL;

UPDATE `Room`
SET `activeCode` = `code`
WHERE `deletedAt` IS NULL;

CREATE UNIQUE INDEX `Room_activeCode_key` ON `Room`(`activeCode`);

DROP INDEX `Room_code_key` ON `Room`;
