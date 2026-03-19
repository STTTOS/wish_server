-- Add user settings table for app-level preferences
CREATE TABLE `UserSettings` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` INTEGER NOT NULL,
  `showHistoryRecords` BOOLEAN NOT NULL DEFAULT true,
  `showRecordOverview` BOOLEAN NOT NULL DEFAULT true,
  `autoCallOnOffline` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `UserSettings_userId_key`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserSettings`
  ADD CONSTRAINT `UserSettings_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill settings for existing users
INSERT INTO `UserSettings` (`userId`)
SELECT `id`
FROM `User`
WHERE `id` NOT IN (SELECT `userId` FROM `UserSettings`);
