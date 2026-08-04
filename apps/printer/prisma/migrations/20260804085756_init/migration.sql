-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `shopCode` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    INDEX `User_shopCode_idx`(`shopCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrintFile` (
    `id` VARCHAR(191) NOT NULL,
    `shopCode` VARCHAR(64) NOT NULL,
    `originalName` VARCHAR(500) NOT NULL,
    `cosKey` VARCHAR(500) NOT NULL,
    `cosUrl` VARCHAR(1000) NOT NULL,
    `mime` VARCHAR(128) NULL,
    `size` INTEGER NOT NULL,
    `pageCount` INTEGER NULL,
    `status` ENUM('new', 'reviewed', 'printed', 'print_failed') NOT NULL DEFAULT 'new',
    `printOptions` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `PrintFile_shopCode_deletedAt_createdAt_idx`(`shopCode`, `deletedAt`, `createdAt`),
    INDEX `PrintFile_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
