-- AlterTable
ALTER TABLE `Announcement`
  ADD COLUMN `minClientVersion` VARCHAR(16) NULL,
  ADD COLUMN `maxClientVersion` VARCHAR(16) NULL;
