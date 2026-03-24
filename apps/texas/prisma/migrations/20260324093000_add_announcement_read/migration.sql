-- Record per-user announcement read status
CREATE TABLE `AnnouncementRead` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `announcementId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `AnnouncementRead_announcementId_userId_key`(`announcementId`, `userId`),
  INDEX `AnnouncementRead_userId_readAt_idx`(`userId`, `readAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AnnouncementRead`
  ADD CONSTRAINT `AnnouncementRead_announcementId_fkey`
  FOREIGN KEY (`announcementId`) REFERENCES `Announcement`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AnnouncementRead`
  ADD CONSTRAINT `AnnouncementRead_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
