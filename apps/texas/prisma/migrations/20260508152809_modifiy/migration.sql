-- CreateTable
CREATE TABLE `user_daily_fortune` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `fortuneOn` VARCHAR(10) NOT NULL,
    `tierKey` ENUM('daJi', 'shangJi', 'zhongJi', 'xiaoJi', 'ping') NOT NULL,
    `luckyPoke` VARCHAR(4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_daily_fortune_userId_idx`(`userId`),
    UNIQUE INDEX `user_daily_fortune_userId_fortuneOn_key`(`userId`, `fortuneOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_daily_fortune` ADD CONSTRAINT `user_daily_fortune_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
