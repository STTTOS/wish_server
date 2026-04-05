-- 若 `RoomChipTopUp` 已有数据，需先为每行填好 `afterMatchId` 再执行；空表可直接跑。
ALTER TABLE `RoomChipTopUp` ADD COLUMN `afterMatchId` INTEGER NOT NULL;

ALTER TABLE `RoomChipTopUp` ADD CONSTRAINT `RoomChipTopUp_afterMatchId_fkey` FOREIGN KEY (`afterMatchId`) REFERENCES `Match`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX `RoomChipTopUp_roomId_userId_afterMatchId_key` ON `RoomChipTopUp`(`roomId`, `userId`, `afterMatchId`);
