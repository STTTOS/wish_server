/*
  Warnings:

  - You are about to drop the column `roomCode` on the `Room` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[code]` on the table `Room` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `code` to the `Room` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `Room_roomCode_key` ON `Room`;

-- AlterTable
ALTER TABLE `Room` DROP COLUMN `roomCode`,
    ADD COLUMN `code` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Room_code_key` ON `Room`(`code`);
