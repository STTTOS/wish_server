-- CreateTable
CREATE TABLE `player_honors_stat` (
    `userId` INTEGER NOT NULL,
    `hands` INTEGER NOT NULL DEFAULT 0,
    `royalFlushCount` INTEGER NOT NULL DEFAULT 0,
    `straightFlushCount` INTEGER NOT NULL DEFAULT 0,
    `fourOfKindCount` INTEGER NOT NULL DEFAULT 0,
    `lastMatchId` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `player_honors_stat` ADD CONSTRAINT `player_honors_stat_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
