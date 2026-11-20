-- CreateTable
CREATE TABLE `GoldUser` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GoldUser_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoldAuthSession` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `platform` VARCHAR(16) NOT NULL,
    `deviceId` VARCHAR(64) NOT NULL,
    `accessToken` VARCHAR(128) NOT NULL,
    `expiresAt` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GoldAuthSession_accessToken_key`(`accessToken`),
    UNIQUE INDEX `GoldAuthSession_userId_platform_key`(`userId`, `platform`),
    INDEX `GoldAuthSession_accessToken_idx`(`accessToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GoldAuthSession` ADD CONSTRAINT `GoldAuthSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `GoldUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;