-- CreateTable
CREATE TABLE `Announcement` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `type` ENUM('activity', 'update', 'maintenance') NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `summary` VARCHAR(300) NOT NULL,
  `content` TEXT NOT NULL,
  `actionText` VARCHAR(40) NULL,
  `actionUrl` VARCHAR(500) NULL,
  `priority` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('published', 'disabled') NOT NULL,
  `publishAt` DATETIME(3) NOT NULL,
  `expireAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deletedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddIndex
CREATE INDEX `Announcement_status_priority_publishAt_idx` ON `Announcement`(`status`, `priority`, `publishAt`);

