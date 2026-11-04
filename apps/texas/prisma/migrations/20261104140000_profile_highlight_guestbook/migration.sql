-- CreateTable
CREATE TABLE `profile_highlight` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `slotIndex` INTEGER NOT NULL,
    `imageUrl` VARCHAR(512) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `profile_highlight_userId_idx`(`userId`),
    UNIQUE INDEX `profile_highlight_userId_slotIndex_key`(`userId`, `slotIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profile_guestbook_message` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wallUserId` INTEGER NOT NULL,
    `authorUserId` INTEGER NOT NULL,
    `content` VARCHAR(48) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `profile_guestbook_message_wallUserId_createdAt_idx`(`wallUserId`, `createdAt`),
    INDEX `profile_guestbook_message_authorUserId_wallUserId_createdAt_idx`(`authorUserId`, `wallUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `profile_highlight` ADD CONSTRAINT `profile_highlight_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profile_guestbook_message` ADD CONSTRAINT `profile_guestbook_message_wallUserId_fkey` FOREIGN KEY (`wallUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profile_guestbook_message` ADD CONSTRAINT `profile_guestbook_message_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
