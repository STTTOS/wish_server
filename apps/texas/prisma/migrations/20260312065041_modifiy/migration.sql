/*
  Warnings:

  - You are about to drop the column `uuid` on the `Room` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[roomCode]` on the table `Room` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `roomId` to the `Match` table without a default value. This is not possible if the table is not empty.
  - Added the required column `roomCode` to the `Room` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `Room_uuid_key` ON `Room`;

-- AlterTable
ALTER TABLE `Match` ADD COLUMN `roomId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `PlayerMatchRecord` ADD COLUMN `isAllIn` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `isFold` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Room` DROP COLUMN `uuid`,
    ADD COLUMN `roomCode` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Room_roomCode_key` ON `Room`(`roomCode`);

-- AddForeignKey
ALTER TABLE `Match` ADD CONSTRAINT `Match_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
