-- CreateTable
CREATE TABLE `style_stat_applied_hand` (
    `matchId` INTEGER NOT NULL,
    `statsVersion` INTEGER NOT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`matchId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `style_stat_applied_hand` ADD CONSTRAINT `style_stat_applied_hand_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
