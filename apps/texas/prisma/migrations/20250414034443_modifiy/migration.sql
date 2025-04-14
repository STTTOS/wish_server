/*
  Warnings:

  - A unique constraint covering the columns `[uuid]` on the table `Room` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `Room_uuid_key` ON `Room`(`uuid`);
