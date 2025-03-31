/*
  Warnings:

  - You are about to alter the column `endStage` on the `Match` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(2))` to `Enum(EnumId(3))`.
  - The values [preFlop] on the enum `Record_stage` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `Match` MODIFY `endStage` ENUM('pre_flop', 'flop', 'turn', 'river') NOT NULL DEFAULT 'pre_flop';

-- AlterTable
ALTER TABLE `Record` MODIFY `stage` ENUM('pre_flop', 'flop', 'turn', 'river') NOT NULL;
