/*
  Warnings:

  - A unique constraint covering the columns `[userId,momentId]` on the table `MomentLike` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `MomentLike_userId_momentId_key` ON `MomentLike`(`userId`, `momentId`);
