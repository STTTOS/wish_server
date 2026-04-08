-- AlterTable
ALTER TABLE `PlayerMatchRecord` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `Room` ADD COLUMN `gameStatus` ENUM('waiting', 'entering', 'in_hand', 'between_hands') NOT NULL DEFAULT 'waiting';
