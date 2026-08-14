-- CreateTable
CREATE TABLE `PollLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ts` BIGINT NOT NULL,
    `lastTs` BIGINT NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `message` VARCHAR(512) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PollLog_lastTs_idx`(`lastTs`),
    INDEX `PollLog_kind_lastTs_idx`(`kind`, `lastTs`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
