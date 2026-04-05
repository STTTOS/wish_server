-- AlterTable
ALTER TABLE `PlayerMatchRecord` ADD COLUMN `balanceAfterHand` INTEGER NULL;

-- CreateTable
CREATE TABLE `RoomChipTopUp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roomId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `balanceBefore` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `roomInitialChipsSnapshot` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `RoomChipTopUp_roomId_userId_createdAt_idx` ON `RoomChipTopUp`(`roomId`, `userId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `RoomChipTopUp` ADD CONSTRAINT `RoomChipTopUp_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoomChipTopUp` ADD CONSTRAINT `RoomChipTopUp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
