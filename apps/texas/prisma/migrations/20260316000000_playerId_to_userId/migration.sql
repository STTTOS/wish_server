-- Rename playerId to userId in PlayerMatchRecord and BetRecord (same semantic: user id)

-- PlayerMatchRecord
ALTER TABLE `PlayerMatchRecord` DROP FOREIGN KEY `PlayerMatchRecord_playerId_fkey`;
ALTER TABLE `PlayerMatchRecord` CHANGE COLUMN `playerId` `userId` INTEGER NOT NULL;
ALTER TABLE `PlayerMatchRecord` ADD CONSTRAINT `PlayerMatchRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- BetRecord
ALTER TABLE `BetRecord` DROP FOREIGN KEY `BetRecord_playerId_fkey`;
ALTER TABLE `BetRecord` CHANGE COLUMN `playerId` `userId` INTEGER NOT NULL;
ALTER TABLE `BetRecord` ADD CONSTRAINT `BetRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
