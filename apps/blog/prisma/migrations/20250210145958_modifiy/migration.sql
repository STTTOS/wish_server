-- AlterTable
ALTER TABLE `Message` MODIFY `type` ENUM('system', 'reply', 'like', 'comment', 'moment', 'momentReply') NOT NULL;

-- CreateTable
CREATE TABLE `GeneralComment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('article', 'moment') NOT NULL,
    `moduleId` INTEGER NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `parentCommentId` INTEGER NULL,
    `replyToUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GeneralComment_type_moduleId_idx`(`type`, `moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GeneralComment` ADD CONSTRAINT `GeneralComment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralComment` ADD CONSTRAINT `GeneralComment_parentCommentId_fkey` FOREIGN KEY (`parentCommentId`) REFERENCES `GeneralComment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneralComment` ADD CONSTRAINT `GeneralComment_replyToUserId_fkey` FOREIGN KEY (`replyToUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
